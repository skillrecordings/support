/**
 * Learning Curves Analytics
 *
 * Track correction rates over time per pipeline stage.
 * Visualize how the agent learns from human feedback.
 *
 * Data source: Hivemind support memories with outcome tracking
 */

import type { SupportStage } from '@skillrecordings/memory/support-schemas'
import { Index } from '@upstash/vector'

// ============================================================================
// Types
// ============================================================================

/**
 * Metrics for a single pipeline stage over a time period
 */
export interface StageMetrics {
  /** Pipeline stage */
  stage: 'classify' | 'route' | 'gather' | 'draft' | 'validate'
  /** Time period: '2025-01-25' (daily) or '2025-W04' (weekly) */
  period: string
  /** Total decisions made in this period */
  totalDecisions: number
  /** Decisions that were corrected by humans */
  correctedDecisions: number
  /** Correction rate (corrected / total) */
  correctionRate: number
  /** Most common corrections in this period */
  topCorrections: Array<{ correction: string; count: number }>
}

/**
 * A correction that has occurred multiple times (indicates systemic issue)
 */
export interface RepeatCorrection {
  /** The correction text/pattern */
  correction: string
  /** Number of times this correction occurred */
  count: number
  /** Stage where the correction happens */
  stage: string
  /** First occurrence date */
  firstSeen: string
  /** Most recent occurrence date */
  lastSeen: string
}

/**
 * Overall learning curve summary
 */
export interface LearningCurveSummary {
  /** App identifier */
  appId: string
  /** Date range of analysis */
  dateRange: { start: string; end: string }
  /** Overall correction rate trend (positive = improving, negative = degrading) */
  trend: number
  /** Per-stage metrics over time */
  metrics: StageMetrics[]
  /** Stages with highest correction rates (need attention) */
  problemStages: Array<{ stage: string; avgCorrectionRate: number }>
}

/**
 * Options for querying learning curves
 */
export interface GetLearningCurveOptions {
  /** App identifier */
  appId: string
  /** Filter to specific stage */
  stage?: SupportStage
  /** Number of days to look back (default: 30) */
  days?: number
  /** Group by: 'day' or 'week' (default: 'day') */
  groupBy?: 'day' | 'week'
}

/**
 * Options for querying repeat corrections
 */
export interface GetRepeatCorrectionsOptions {
  /** App identifier */
  appId: string
  /** Minimum occurrence count to include (default: 2) */
  minCount?: number
  /** Limit results (default: 20) */
  limit?: number
}

// ============================================================================
// Vector Index Access
// ============================================================================

let _index: Index | null = null

function getVectorIndex(): Index {
  if (!_index) {
    const url = process.env.UPSTASH_VECTOR_REST_URL
    const token = process.env.UPSTASH_VECTOR_REST_TOKEN

    if (!url || !token) {
      throw new Error(
        'UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN required'
      )
    }

    _index = new Index({ url, token })
  }
  return _index
}

/**
 * Get collection namespace for an app
 */
function getCollection(appId: string): string {
  return `support:${appId}`
}

// ============================================================================
// Memory Scanning
// ============================================================================

/**
 * Memory metadata structure from support memories
 */
interface SupportMemoryMetadata {
  stage: SupportStage
  outcome: 'success' | 'corrected' | 'failed'
  correction?: string
  category?: string
  created_at: string
  collection: string
  app_slug?: string
  tags?: string[]
}

/**
 * Scan all support memories for an app within a date range.
 * Uses Upstash Vector's query with empty string to fetch all records.
 */
async function scanMemories(
  appId: string,
  startDate: Date,
  endDate: Date
): Promise<
  Array<{
    id: string
    metadata: SupportMemoryMetadata
  }>
> {
  const index = getVectorIndex()
  const collection = getCollection(appId)

  // Query all memories in the namespace
  // Uses empty data string to match all, with high topK for all records
  const queryResults = await index.query(
    {
      data: '', // Empty query to match all
      topK: 10000, // Practical limit for analytics
      includeMetadata: true,
    },
    { namespace: collection }
  )

  const results: Array<{ id: string; metadata: SupportMemoryMetadata }> = []

  for (const vector of queryResults) {
    const metadata = vector.metadata as SupportMemoryMetadata | undefined

    // Skip if no metadata or missing required fields
    if (!metadata?.created_at || !metadata?.stage) continue

    const createdAt = new Date(metadata.created_at)

    // Filter by date range
    if (createdAt >= startDate && createdAt <= endDate) {
      results.push({
        id: String(vector.id),
        metadata,
      })
    }
  }

  return results
}

// ============================================================================
// Analytics Functions
// ============================================================================

/**
 * Get learning curve metrics for an app.
 *
 * Returns correction rates per stage over time, showing how
 * the agent's performance evolves as it learns from feedback.
 *
 * @example
 * ```typescript
 * const metrics = await getLearningCurve({
 *   appId: 'total-typescript',
 *   days: 30,
 *   groupBy: 'day'
 * })
 *
 * // Check if classify stage is improving
 * const classifyMetrics = metrics.filter(m => m.stage === 'classify')
 * const recentRate = classifyMetrics.at(-1)?.correctionRate ?? 0
 * const oldRate = classifyMetrics.at(0)?.correctionRate ?? 0
 * console.log(`Classify improvement: ${((oldRate - recentRate) * 100).toFixed(1)}%`)
 * ```
 */
export async function getLearningCurve(
  options: GetLearningCurveOptions
): Promise<StageMetrics[]> {
  const { appId, stage, days = 30, groupBy = 'day' } = options

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  // Scan all memories in date range
  const memories = await scanMemories(appId, startDate, endDate)

  // Filter by stage if specified
  const filtered = stage
    ? memories.filter((m) => m.metadata.stage === stage)
    : memories

  // Group by period and stage
  const groups = new Map<
    string,
    {
      stage: SupportStage
      period: string
      total: number
      corrected: number
      corrections: Map<string, number>
    }
  >()

  for (const memory of filtered) {
    const { stage: memStage, outcome, correction, created_at } = memory.metadata
    const period = formatPeriod(new Date(created_at), groupBy)
    const key = `${memStage}:${period}`

    if (!groups.has(key)) {
      groups.set(key, {
        stage: memStage,
        period,
        total: 0,
        corrected: 0,
        corrections: new Map(),
      })
    }

    const group = groups.get(key)!
    group.total++

    if (outcome === 'corrected') {
      group.corrected++
      if (correction) {
        const normalized = normalizeCorrection(correction)
        group.corrections.set(
          normalized,
          (group.corrections.get(normalized) ?? 0) + 1
        )
      }
    }
  }

  // Convert to output format
  const metrics: StageMetrics[] = []

  for (const group of groups.values()) {
    const topCorrections = Array.from(group.corrections.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([correction, count]) => ({ correction, count }))

    metrics.push({
      stage: group.stage,
      period: group.period,
      totalDecisions: group.total,
      correctedDecisions: group.corrected,
      correctionRate: group.total > 0 ? group.corrected / group.total : 0,
      topCorrections,
    })
  }

  // Sort by period then stage
  metrics.sort((a, b) => {
    const periodCompare = a.period.localeCompare(b.period)
    if (periodCompare !== 0) return periodCompare
    return a.stage.localeCompare(b.stage)
  })

  return metrics
}

/**
 * Get repeat corrections across all stages.
 *
 * Identifies corrections that occur multiple times, indicating
 * systemic issues that need prompt/pipeline fixes.
 *
 * @example
 * ```typescript
 * const repeats = await getRepeatCorrections({
 *   appId: 'total-typescript',
 *   minCount: 3
 * })
 *
 * // These are candidates for prompt updates
 * for (const repeat of repeats) {
 *   console.log(`${repeat.stage}: "${repeat.correction}" (${repeat.count}x)`)
 * }
 * ```
 */
export async function getRepeatCorrections(
  options: GetRepeatCorrectionsOptions
): Promise<RepeatCorrection[]> {
  const { appId, minCount = 2, limit = 20 } = options

  // Look back 90 days for pattern detection
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90)

  const memories = await scanMemories(appId, startDate, endDate)

  // Group corrections by normalized text + stage
  const correctionMap = new Map<
    string,
    {
      correction: string
      stage: string
      count: number
      dates: string[]
    }
  >()

  for (const memory of memories) {
    const { stage, outcome, correction, created_at } = memory.metadata

    if (outcome !== 'corrected' || !correction) continue

    const normalized = normalizeCorrection(correction)
    const key = `${stage}:${normalized}`

    if (!correctionMap.has(key)) {
      correctionMap.set(key, {
        correction: normalized,
        stage,
        count: 0,
        dates: [],
      })
    }

    const entry = correctionMap.get(key)!
    entry.count++
    entry.dates.push(created_at)
  }

  // Filter by minCount and sort
  const results: RepeatCorrection[] = []

  for (const entry of correctionMap.values()) {
    if (entry.count >= minCount) {
      entry.dates.sort()
      results.push({
        correction: entry.correction,
        count: entry.count,
        stage: entry.stage,
        firstSeen: entry.dates[0]!,
        lastSeen: entry.dates.at(-1)!,
      })
    }
  }

  // Sort by count descending
  results.sort((a, b) => b.count - a.count)

  return results.slice(0, limit)
}

/**
 * Get a summary of learning curves with trend analysis.
 *
 * @example
 * ```typescript
 * const summary = await getLearningCurveSummary('total-typescript', 30)
 *
 * if (summary.trend < 0) {
 *   console.log('⚠️ Agent performance is degrading')
 *   console.log('Problem stages:', summary.problemStages)
 * }
 * ```
 */
export async function getLearningCurveSummary(
  appId: string,
  days = 30
): Promise<LearningCurveSummary> {
  const metrics = await getLearningCurve({ appId, days, groupBy: 'week' })

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  // Calculate trend (comparing first half to second half)
  const midpoint = Math.floor(metrics.length / 2)
  const firstHalf = metrics.slice(0, midpoint)
  const secondHalf = metrics.slice(midpoint)

  const firstHalfRate = calculateAvgCorrectionRate(firstHalf)
  const secondHalfRate = calculateAvgCorrectionRate(secondHalf)

  // Positive trend = improvement (lower correction rate in second half)
  const trend = firstHalfRate - secondHalfRate

  // Find problem stages (above 20% correction rate)
  const stageRates = new Map<string, { total: number; corrected: number }>()

  for (const m of metrics) {
    if (!stageRates.has(m.stage)) {
      stageRates.set(m.stage, { total: 0, corrected: 0 })
    }
    const entry = stageRates.get(m.stage)!
    entry.total += m.totalDecisions
    entry.corrected += m.correctedDecisions
  }

  const problemStages = Array.from(stageRates.entries())
    .map(([stage, data]) => ({
      stage,
      avgCorrectionRate: data.total > 0 ? data.corrected / data.total : 0,
    }))
    .filter((s) => s.avgCorrectionRate > 0.2)
    .sort((a, b) => b.avgCorrectionRate - a.avgCorrectionRate)

  return {
    appId,
    dateRange: {
      start: startDate.toISOString().split('T')[0]!,
      end: endDate.toISOString().split('T')[0]!,
    },
    trend,
    metrics,
    problemStages,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a date into a period string
 */
function formatPeriod(date: Date, groupBy: 'day' | 'week'): string {
  if (groupBy === 'day') {
    return date.toISOString().split('T')[0]!
  }

  // ISO week number
  const year = date.getFullYear()
  const startOfYear = new Date(year, 0, 1)
  const days = Math.floor(
    (date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000)
  )
  const week = Math.ceil((days + startOfYear.getDay() + 1) / 7)

  return `${year}-W${week.toString().padStart(2, '0')}`
}

/**
 * Normalize correction text for grouping similar corrections
 */
function normalizeCorrection(correction: string): string {
  return correction.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 200) // Truncate for grouping
}

/**
 * Calculate average correction rate across metrics
 */
function calculateAvgCorrectionRate(metrics: StageMetrics[]): number {
  if (metrics.length === 0) return 0

  const totalDecisions = metrics.reduce((sum, m) => sum + m.totalDecisions, 0)
  const totalCorrected = metrics.reduce(
    (sum, m) => sum + m.correctedDecisions,
    0
  )

  return totalDecisions > 0 ? totalCorrected / totalDecisions : 0
}
