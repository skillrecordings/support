import { RouterCache } from '../router/cache'
import { routeMessage } from '../router/message-router'
import type { RouteType } from '../router/types'
import type {
  CategoryMetrics,
  CostMetrics,
  EvalDatapoint,
  EvalGates,
  EvalReport,
  LatencyMetrics,
} from './types'

export type {
  EvalDatapoint,
  EvalGates,
  EvalReport,
  CategoryMetrics,
} from './types'

/**
 * Default regression gates from Phase 8 spec.
 */
const DEFAULT_GATES: Required<EvalGates> = {
  minPrecision: 0.92,
  minRecall: 0.95,
  maxFpRate: 0.03,
  maxFnRate: 0.02,
}

/**
 * Evaluate routing performance against a labeled dataset.
 *
 * @param dataset - Array of labeled evaluation datapoints
 * @param gates - Optional regression gates (uses defaults from Phase 8 spec)
 * @returns EvalReport with metrics and gate status
 * @throws Error if any gate threshold is violated
 *
 * @example
 * ```typescript
 * const dataset = [
 *   { message: 'I want a refund', expectedCategory: 'refund', expectedRoute: 'rule' }
 * ]
 * const report = await evalRouting(dataset)
 * console.log(`Precision: ${report.precision}, Recall: ${report.recall}`)
 * ```
 */
export async function evalRouting(
  dataset: EvalDatapoint[],
  gates?: EvalGates
): Promise<EvalReport> {
  const mergedGates = { ...DEFAULT_GATES, ...gates }

  // Track metrics
  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  const categoryStats = new Map<
    string,
    { tp: number; fp: number; fn: number; tn: number }
  >()
  const latencies: number[] = []
  let totalTokens = 0

  // Create a mock cache and context for routing
  const cache = new RouterCache({
    decisionTtlMs: 300000,
    contextTtlMs: 300000,
  })

  for (const datapoint of dataset) {
    const startTime = Date.now()

    // Route the message
    const decision = await routeMessage(datapoint.message, {
      conversationId: `eval-${Math.random()}`,
      messageId: `eval-msg-${Math.random()}`,
      sender: '[EMAIL]',
      rules: [],
      cache,
    })

    const latency = Date.now() - startTime
    latencies.push(latency)

    // Estimate tokens (rough approximation: 1 token per 4 chars)
    totalTokens += Math.ceil(datapoint.message.length / 4)

    // Initialize category stats if needed
    if (!categoryStats.has(datapoint.expectedCategory)) {
      categoryStats.set(datapoint.expectedCategory, {
        tp: 0,
        fp: 0,
        fn: 0,
        tn: 0,
      })
    }
    const catStats = categoryStats.get(datapoint.expectedCategory)!

    // Classify outcome
    const outcome = classifyOutcome(decision, datapoint)

    // Update counters
    if (outcome === 'tp') {
      tp++
      catStats.tp++
    } else if (outcome === 'fp') {
      fp++
      catStats.fp++
    } else if (outcome === 'fn') {
      fn++
      catStats.fn++
    } else {
      tn++
      catStats.tn++
    }
  }

  // Calculate overall metrics
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const fpRate = fp + tn > 0 ? fp / (fp + tn) : 0
  const fnRate = fn + tp > 0 ? fn / (fn + tp) : 0

  // Calculate per-category breakdown
  const byCategory: Record<string, CategoryMetrics> = {}
  for (const [category, stats] of categoryStats.entries()) {
    const catPrecision =
      stats.tp + stats.fp > 0 ? stats.tp / (stats.tp + stats.fp) : 0
    const catRecall =
      stats.tp + stats.fn > 0 ? stats.tp / (stats.tp + stats.fn) : 0
    const catF1 =
      catPrecision + catRecall > 0
        ? (2 * catPrecision * catRecall) / (catPrecision + catRecall)
        : 0

    byCategory[category] = {
      tp: stats.tp,
      fp: stats.fp,
      fn: stats.fn,
      tn: stats.tn,
      precision: catPrecision,
      recall: catRecall,
      f1: catF1,
      count: stats.tp + stats.fp + stats.fn + stats.tn,
    }
  }

  // Calculate latency percentiles
  const sortedLatencies = latencies.sort((a, b) => a - b)
  const p50 = percentile(sortedLatencies, 50)
  const p95 = percentile(sortedLatencies, 95)
  const p99 = percentile(sortedLatencies, 99)

  // Estimate cost (rough approximation: $0.25 per 1M tokens for Haiku)
  const estimatedUsd = (totalTokens / 1_000_000) * 0.25

  const cost: CostMetrics = {
    tokens: totalTokens,
    estimatedUsd,
  }

  const latency: LatencyMetrics = {
    p50,
    p95,
    p99,
  }

  // Check gates
  let passed = true
  if (precision < mergedGates.minPrecision) {
    passed = false
    throw new Error(
      `Precision ${precision.toFixed(4)} below threshold ${mergedGates.minPrecision}`
    )
  }
  if (recall < mergedGates.minRecall) {
    passed = false
    throw new Error(
      `Recall ${recall.toFixed(4)} below threshold ${mergedGates.minRecall}`
    )
  }
  if (fpRate > mergedGates.maxFpRate) {
    passed = false
    throw new Error(
      `False positive rate ${fpRate.toFixed(4)} above threshold ${mergedGates.maxFpRate}`
    )
  }
  if (fnRate > mergedGates.maxFnRate) {
    passed = false
    throw new Error(
      `False negative rate ${fnRate.toFixed(4)} above threshold ${mergedGates.maxFnRate}`
    )
  }

  return {
    precision,
    recall,
    fpRate,
    fnRate,
    byCategory,
    cost,
    latency,
    passed,
  }
}

/**
 * Classify routing decision outcome for metrics.
 */
function classifyOutcome(
  decision: { route: RouteType; category: string },
  expected: { expectedRoute: RouteType; expectedCategory: string }
): 'tp' | 'fp' | 'fn' | 'tn' {
  const routeMatch = decision.route === expected.expectedRoute
  const categoryMatch = decision.category === expected.expectedCategory

  const isAutoResponse = ['rule', 'canned', 'classifier'].includes(
    decision.route
  )
  const shouldAutoRespond = ['rule', 'canned', 'classifier'].includes(
    expected.expectedRoute
  )

  if (routeMatch && categoryMatch) {
    return 'tp' // Perfect match
  } else if (isAutoResponse && !shouldAutoRespond) {
    return 'fp' // Auto-responded when shouldn't have
  } else if (!isAutoResponse && shouldAutoRespond) {
    return 'fn' // Didn't respond when should have
  } else if (!isAutoResponse && !shouldAutoRespond) {
    return 'tn' // Correctly no response
  } else {
    return 'fp' // Route mismatch but both are auto-response types
  }
}

/**
 * Calculate percentile from sorted array.
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.ceil((p / 100) * sortedValues.length) - 1
  return sortedValues[Math.max(0, index)] ?? 0
}
