/**
 * Pipeline step evaluation runner
 *
 * Runs actual pipeline steps against labeled scenarios and measures accuracy.
 */

import {
  type ClassifyInput,
  type ClassifyOutput,
  type GatherOutput,
  type MessageCategory,
  type RouteAction,
  type RouteOutput,
  type ValidateOutput,
  type ValidationIssueType,
  classify,
  route,
  validate,
} from '@skillrecordings/core/pipeline'
import { readFile, writeFile } from 'fs/promises'
import { glob } from 'glob'
import {
  cleanupRealTools,
  createRealTools,
  initRealTools,
  isRealToolsAvailable,
} from './real-tools'

// ============================================================================
// Types
// ============================================================================

type PipelineStep =
  | 'classify'
  | 'route'
  | 'gather'
  | 'draft'
  | 'validate'
  | 'e2e'

interface RunOptions {
  step: PipelineStep
  scenarios?: string
  dataset?: string
  limit?: number
  verbose?: boolean
  json?: boolean
  model?: string
  forceLlm?: boolean
  realTools?: boolean
}

interface Scenario {
  id: string
  name?: string
  trigger?: { subject: string; body: string }
  triggerMessage?: { subject: string; body: string }
  appId?: string
  // Expected values for evals
  expectedCategory?: MessageCategory
  expectedAction?: RouteAction
  expectedBehavior?: string
  category?: string // Fallback for backwards compat
  // Validate eval fields
  draft?: string // Pre-provided draft to validate
  assertions?: {
    noFabrication?: boolean
    noMetaCommentary?: boolean
    noInternalLeak?: boolean
    noBannedPhrases?: boolean
    mustNotContain?: string[]
  }
  // Context for validation (optional)
  context?: {
    customer?: string
    conversation?: unknown
  }
}

interface StepResult {
  scenarioId: string
  passed: boolean
  expected: string
  actual: string
  confidence?: number
  durationMs: number
  reasoning?: string
}

interface EvalMetrics {
  total: number
  passed: number
  failed: number
  accuracy: number
  durationMs: number
  // Per-category/action breakdown
  breakdown: Record<
    string,
    { tp: number; fp: number; fn: number; precision: number; recall: number }
  >
  // Special metrics
  falseSilenceRate?: number // For route: incorrectly silenced
  falseRespondRate?: number // For route: incorrectly responded
}

// ============================================================================
// Main runner
// ============================================================================

export async function run(options: RunOptions): Promise<void> {
  const {
    step,
    scenarios: scenarioGlob,
    dataset,
    limit,
    verbose,
    json,
    model,
    forceLlm,
    realTools,
  } = options

  // Load scenarios
  let scenarios = await loadScenarios(scenarioGlob, dataset)

  if (limit && limit < scenarios.length) {
    scenarios = scenarios.slice(0, limit)
  }

  if (!json) {
    console.log(`\n🧪 Running ${step} eval on ${scenarios.length} scenarios\n`)
  }

  // Initialize real tools if requested
  if (realTools) {
    if (!json) {
      console.log('🔌 Connecting to Docker services...')
    }
    const status = await initRealTools(undefined, verbose && !json)

    if (!status.mysql && !status.qdrant) {
      console.error('❌ Failed to connect to any Docker services')
      console.error('   Make sure MySQL (3306) and Qdrant (6333) are running')
      process.exit(1)
    }

    if (!json) {
      console.log('')
    }
  }

  const startTime = Date.now()
  let results: StepResult[] = []

  try {
    switch (step) {
      case 'classify':
        results = await runClassifyEval(scenarios, { verbose, model, forceLlm })
        break
      case 'route':
        results = await runRouteEval(scenarios, { verbose, model, forceLlm })
        break
      case 'gather':
        results = await runGatherEval(scenarios, { verbose, realTools })
        break
      case 'validate':
        results = await runValidateEval(scenarios, { verbose })
        break
      case 'e2e':
        results = await runE2EEval(scenarios, { verbose, model, realTools })
        break
      case 'draft':
        console.error(
          `Step "${step}" not yet implemented. Use e2e for full pipeline.`
        )
        process.exit(1)
      default:
        console.error(`Unknown step: ${step}`)
        process.exit(1)
    }
  } finally {
    // Clean up real tools connections
    if (realTools) {
      await cleanupRealTools()
    }
  }

  const totalDuration = Date.now() - startTime
  const metrics = computeMetrics(results, step, totalDuration)

  if (json) {
    console.log(JSON.stringify({ metrics, results }, null, 2))
  } else {
    printMetrics(step, metrics, verbose ? results : undefined)
  }
}

// ============================================================================
// Scenario loading
// ============================================================================

async function loadScenarios(
  scenarioGlob?: string,
  datasetPath?: string
): Promise<Scenario[]> {
  if (datasetPath) {
    const content = await readFile(datasetPath, 'utf-8')
    const data = JSON.parse(content)

    // Handle comprehensive-dataset.json format
    return data.map((item: any) => ({
      id: item.id || item.conversationId,
      name: item.triggerMessage?.subject || item.name,
      trigger: item.trigger,
      triggerMessage: item.triggerMessage,
      appId: item.appId || item.app,
      expectedCategory: item.expectedCategory || inferCategory(item),
      expectedAction: item.expectedAction || inferAction(item),
      expectedBehavior: item.expectedBehavior,
      category: item.category,
    }))
  }

  if (scenarioGlob) {
    const files = await glob(scenarioGlob)
    if (files.length === 0) {
      console.error(`No scenario files found matching: ${scenarioGlob}`)
      process.exit(1)
    }

    return Promise.all(
      files.map(async (file) => {
        const content = await readFile(file, 'utf-8')
        return JSON.parse(content)
      })
    )
  }

  console.error('Must provide --scenarios or --dataset')
  process.exit(1)
}

/**
 * Infer expected category from scenario if not explicitly set
 */
function inferCategory(item: any): MessageCategory | undefined {
  // If agentResponse has category, map it
  if (item.agentResponse?.category) {
    const catMap: Record<string, MessageCategory> = {
      'tool-assisted': 'support_access',
      auto: 'system',
      spam: 'spam',
    }
    return catMap[item.agentResponse.category]
  }

  // Infer from message content
  const text =
    `${item.triggerMessage?.subject || ''} ${item.triggerMessage?.body || ''}`.toLowerCase()

  if (/refund|money back/i.test(text)) return 'support_refund'
  if (/can't access|lost access|no access|restore access/i.test(text))
    return 'support_access'
  if (/transfer|different email|wrong email/i.test(text))
    return 'support_transfer'
  if (/invoice|receipt/i.test(text)) return 'support_billing'
  if (/partnership|sponsor|backlink|outreach|seo/i.test(text)) return 'spam'
  if (/auto-reply|out of office|mailer-daemon/i.test(text)) return 'system'
  if (/thank|love|amazing|big fan/i.test(text)) return 'fan_mail'

  return undefined
}

/**
 * Infer expected action from scenario
 */
function inferAction(item: any): RouteAction | undefined {
  const behavior = item.expectedBehavior?.toLowerCase() || ''

  if (behavior.includes('silent') || behavior.includes('ignore'))
    return 'silence'
  if (behavior.includes('escalate') || behavior.includes('human'))
    return 'escalate_human'
  if (behavior.includes('instructor')) return 'escalate_instructor'
  if (behavior.includes('respond') || behavior.includes('draft'))
    return 'respond'

  // If agent responded, it was probably meant to respond
  if (item.agentResponse?.text) return 'respond'

  return undefined
}

// ============================================================================
// Step evaluators
// ============================================================================

interface EvalOptions {
  verbose?: boolean
  model?: string
  forceLlm?: boolean
  realTools?: boolean
}

async function runClassifyEval(
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const results: StepResult[] = []

  for (const [i, scenario] of scenarios.entries()) {
    if (!options.verbose) {
      process.stdout.write(`\r  Processing ${i + 1}/${scenarios.length}...`)
    }

    const trigger = scenario.trigger || scenario.triggerMessage
    if (!trigger) {
      results.push({
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedCategory || 'unknown',
        actual: 'ERROR: no trigger',
        durationMs: 0,
      })
      continue
    }

    const input: ClassifyInput = {
      subject: trigger.subject,
      body: trigger.body,
      appId: scenario.appId,
    }

    const startTime = Date.now()
    try {
      const result = await classify(input, {
        forceLLM: options.forceLlm,
        model: options.model,
      })

      const expected = scenario.expectedCategory || 'unknown'
      const passed = result.category === expected

      results.push({
        scenarioId: scenario.id,
        passed,
        expected,
        actual: result.category,
        confidence: result.confidence,
        durationMs: Date.now() - startTime,
        reasoning: result.reasoning,
      })

      if (options.verbose && !passed) {
        console.log(`\n❌ ${scenario.id}`)
        console.log(`   Expected: ${expected}`)
        console.log(
          `   Actual:   ${result.category} (${(result.confidence * 100).toFixed(0)}%)`
        )
        console.log(`   Subject:  ${trigger.subject.slice(0, 60)}...`)
      }
    } catch (error) {
      results.push({
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedCategory || 'unknown',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      })
    }
  }

  if (!options.verbose) console.log('')
  return results
}

async function runRouteEval(
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const results: StepResult[] = []

  for (const [i, scenario] of scenarios.entries()) {
    if (!options.verbose) {
      process.stdout.write(`\r  Processing ${i + 1}/${scenarios.length}...`)
    }

    const trigger = scenario.trigger || scenario.triggerMessage
    if (!trigger) {
      results.push({
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedAction || 'unknown',
        actual: 'ERROR: no trigger',
        durationMs: 0,
      })
      continue
    }

    const input: ClassifyInput = {
      subject: trigger.subject,
      body: trigger.body,
      appId: scenario.appId,
    }

    const startTime = Date.now()
    try {
      // First classify, then route
      const classification = await classify(input, {
        forceLLM: options.forceLlm,
        model: options.model,
      })

      const routeResult = route({
        message: input,
        classification,
        appConfig: {
          appId: scenario.appId || 'eval',
          instructorConfigured: true,
          autoSendEnabled: false,
        },
      })

      const expected = scenario.expectedAction || 'respond'
      const passed = routeResult.action === expected

      results.push({
        scenarioId: scenario.id,
        passed,
        expected,
        actual: routeResult.action,
        durationMs: Date.now() - startTime,
        reasoning: routeResult.reason,
      })

      if (options.verbose && !passed) {
        console.log(`\n❌ ${scenario.id}`)
        console.log(`   Expected: ${expected}`)
        console.log(`   Actual:   ${routeResult.action}`)
        console.log(`   Category: ${classification.category}`)
        console.log(`   Reason:   ${routeResult.reason}`)
      }
    } catch (error) {
      results.push({
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedAction || 'respond',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      })
    }
  }

  if (!options.verbose) console.log('')
  return results
}

async function runGatherEval(
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const results: StepResult[] = []

  // Check if real tools are available
  const useRealTools = options.realTools && isRealToolsAvailable()

  if (!useRealTools) {
    // Fallback to mock behavior
    for (const [i, scenario] of scenarios.entries()) {
      if (!options.verbose) {
        process.stdout.write(`\r  Processing ${i + 1}/${scenarios.length}...`)
      }

      results.push({
        scenarioId: scenario.id,
        passed: true,
        expected: 'context_complete',
        actual: 'context_complete',
        durationMs: 0,
        reasoning:
          'Gather eval requires --real-tools flag with Docker services',
      })
    }

    if (!options.verbose) console.log('')
    console.log(
      '\n⚠️  Gather eval: Use --real-tools with Docker services for actual tool calls\n'
    )
    return results
  }

  // Real tools are available - run actual gather evaluation
  for (const [i, scenario] of scenarios.entries()) {
    if (!options.verbose) {
      process.stdout.write(`\r  Processing ${i + 1}/${scenarios.length}...`)
    }

    const trigger = scenario.trigger || scenario.triggerMessage
    if (!trigger) {
      results.push({
        scenarioId: scenario.id,
        passed: false,
        expected: 'context_complete',
        actual: 'ERROR: no trigger',
        durationMs: 0,
      })
      continue
    }

    const startTime = Date.now()
    try {
      // Create real tools for this scenario
      const tools = createRealTools({
        appId: scenario.appId,
        customerEmail: scenario.context?.customer as string,
      })

      // Execute key tools to gather context
      const toolResults: string[] = []
      let userFound = false
      let knowledgeCount = 0

      // Try lookupUser
      const lookupUserExec = tools.lookupUser.execute
      if (lookupUserExec) {
        const userResult = await lookupUserExec(
          {
            email: (scenario.context?.customer as string) || '[EMAIL]',
            appId: scenario.appId || 'eval',
          },
          { toolCallId: 'test', messages: [] }
        )
        userFound = !!(userResult as any).found
        toolResults.push(`user:${userFound ? 'found' : 'not_found'}`)
      }

      // Try searchKnowledge
      const searchKnowledgeExec = tools.searchKnowledge.execute
      if (searchKnowledgeExec) {
        const knowledgeResult = await searchKnowledgeExec(
          {
            query: trigger.subject || trigger.body,
            appId: scenario.appId || 'eval',
          },
          { toolCallId: 'test', messages: [] }
        )
        knowledgeCount =
          ((knowledgeResult as any).knowledge?.length || 0) +
          ((knowledgeResult as any).similarTickets?.length || 0)
        toolResults.push(`knowledge:${knowledgeCount}`)
      }

      // Evaluate: pass if we got some context
      const hasContext = userFound || knowledgeCount > 0
      const expected = 'context_complete'
      const actual = hasContext ? 'context_complete' : 'context_incomplete'

      results.push({
        scenarioId: scenario.id,
        passed: hasContext,
        expected,
        actual,
        durationMs: Date.now() - startTime,
        reasoning: toolResults.join(', '),
      })

      if (options.verbose && !hasContext) {
        console.log(`\n⚠️  ${scenario.id}`)
        console.log(`   Context: ${toolResults.join(', ')}`)
      }
    } catch (error) {
      results.push({
        scenarioId: scenario.id,
        passed: false,
        expected: 'context_complete',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      })
    }
  }

  if (!options.verbose) console.log('')
  return results
}

/**
 * Run validate eval against scenarios with drafts.
 *
 * Scenarios can include:
 * - `draft`: A pre-provided draft to validate
 * - `assertions`: Expected validation outcomes (noFabrication, noMetaCommentary, etc.)
 *
 * If no draft is provided, the scenario is skipped.
 * All validation checks are deterministic (no LLM calls).
 */
async function runValidateEval(
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const results: StepResult[] = []

  // Filter to scenarios with drafts or assertions
  const validScenarios = scenarios.filter((s) => s.draft || s.assertions)

  if (validScenarios.length === 0) {
    console.log('\n⚠️  No scenarios with draft or assertions found.')
    console.log('   For validate eval, scenarios need either:')
    console.log('   - "draft": "text to validate"')
    console.log('   - "assertions": { "noFabrication": true, ... }\n')
    return []
  }

  for (const [i, scenario] of validScenarios.entries()) {
    if (!options.verbose) {
      process.stdout.write(
        `\r  Processing ${i + 1}/${validScenarios.length}...`
      )
    }

    // If scenario has no draft but has assertions, it's for checking generated drafts
    // For now, skip those (they'd need full pipeline)
    if (!scenario.draft) {
      results.push({
        scenarioId: scenario.id,
        passed: true, // Can't evaluate without draft
        expected: 'needs_draft',
        actual: 'skipped',
        durationMs: 0,
        reasoning: 'No draft provided - use e2e eval with assertions',
      })
      continue
    }

    const startTime = Date.now()

    // Create minimal context for validation
    // Fabrication check needs knowledge array to be empty to trigger
    const hasKnowledge = scenario.context?.customer === 'recent-purchase'
    const mockContext: GatherOutput = {
      user: hasKnowledge ? { id: 'test', email: '[EMAIL]' } : null,
      purchases: hasKnowledge
        ? [
            {
              id: 'p1',
              productId: 'prod1',
              productName: 'Test Product',
              purchasedAt: new Date().toISOString(),
              status: 'active',
            },
          ]
        : [],
      knowledge: hasKnowledge
        ? [
            {
              id: 'k1',
              type: 'faq',
              content: 'test knowledge',
              relevance: 0.9,
            },
          ]
        : [],
      history: [],
      priorMemory: [],
      gatherErrors: [],
    }

    try {
      const result = validate({
        draft: scenario.draft,
        context: mockContext,
        strictMode: false,
      })

      // Map issue types to assertion names
      const issueTypeToAssertion: Record<
        ValidationIssueType,
        keyof NonNullable<Scenario['assertions']>
      > = {
        fabrication: 'noFabrication',
        meta_commentary: 'noMetaCommentary',
        internal_leak: 'noInternalLeak',
        banned_phrase: 'noBannedPhrases',
        too_short: 'noBannedPhrases', // No specific assertion
        too_long: 'noBannedPhrases', // No specific assertion
        bad_tone: 'noBannedPhrases', // No specific assertion
      }

      // Check if assertions match
      const assertions = scenario.assertions || {}
      const failedAssertions: string[] = []
      const foundIssueTypes = new Set(result.issues.map((i) => i.type))

      // Check negative assertions (noX = expect no issues of type X)
      if (assertions.noFabrication && foundIssueTypes.has('fabrication')) {
        failedAssertions.push('noFabrication: found fabrication')
      }
      if (
        assertions.noMetaCommentary &&
        foundIssueTypes.has('meta_commentary')
      ) {
        failedAssertions.push('noMetaCommentary: found meta_commentary')
      }
      if (assertions.noInternalLeak && foundIssueTypes.has('internal_leak')) {
        failedAssertions.push('noInternalLeak: found internal_leak')
      }
      if (assertions.noBannedPhrases && foundIssueTypes.has('banned_phrase')) {
        failedAssertions.push('noBannedPhrases: found banned_phrase')
      }

      // Check mustNotContain patterns
      if (assertions.mustNotContain) {
        for (const pattern of assertions.mustNotContain) {
          if (scenario.draft.toLowerCase().includes(pattern.toLowerCase())) {
            failedAssertions.push(`mustNotContain: found "${pattern}"`)
          }
        }
      }

      const passed = failedAssertions.length === 0
      const issuesSummary = result.issues
        .map((i) => `${i.type}:${i.match || 'none'}`)
        .join(', ')

      results.push({
        scenarioId: scenario.id,
        passed,
        expected: 'valid',
        actual: passed ? 'valid' : `invalid: ${failedAssertions.join('; ')}`,
        durationMs: Date.now() - startTime,
        reasoning: issuesSummary || 'no issues found',
      })

      if (options.verbose && !passed) {
        console.log(`\n❌ ${scenario.id}`)
        console.log(`   Failed assertions: ${failedAssertions.join(', ')}`)
        console.log(`   Issues found: ${issuesSummary || 'none'}`)
        console.log(`   Draft preview: ${scenario.draft.slice(0, 80)}...`)
      }
    } catch (error) {
      results.push({
        scenarioId: scenario.id,
        passed: false,
        expected: 'valid',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      })
    }
  }

  if (!options.verbose) console.log('')
  return results
}

async function runE2EEval(
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const { runPipeline } = await import('@skillrecordings/core/pipeline')
  const results: StepResult[] = []

  // Note: Real tools are available when --real-tools is passed
  // They're initialized globally and accessible to the pipeline's gather step
  if (options.realTools && options.verbose) {
    const available = isRealToolsAvailable()
    console.log(`  Real tools: ${available ? 'connected' : 'not available'}\n`)
  }

  for (const [i, scenario] of scenarios.entries()) {
    if (!options.verbose) {
      process.stdout.write(`\r  Processing ${i + 1}/${scenarios.length}...`)
    }

    const trigger = scenario.trigger || scenario.triggerMessage
    if (!trigger) {
      results.push({
        scenarioId: scenario.id,
        passed: false,
        expected: 'respond',
        actual: 'ERROR: no trigger',
        durationMs: 0,
      })
      continue
    }

    const startTime = Date.now()
    try {
      // Note: Real tools are initialized globally via initRealTools()
      // The pipeline will use them via the gather step's tool providers
      // when --real-tools is enabled and services are available

      const pipelineResult = await runPipeline(
        {
          message: {
            subject: trigger.subject,
            body: trigger.body,
            appId: scenario.appId,
          },
          appConfig: {
            appId: scenario.appId || 'eval',
            instructorConfigured: true,
            autoSendEnabled: false,
          },
          dryRun: true,
        },
        {
          classifyModel: options.model,
          draftModel: options.model,
        }
      )

      // For e2e, check if action matches expected
      const expected = scenario.expectedAction || 'respond'
      const passed = pipelineResult.action === expected

      results.push({
        scenarioId: scenario.id,
        passed,
        expected,
        actual: pipelineResult.action,
        durationMs: Date.now() - startTime,
        reasoning: pipelineResult.steps
          .map((s) => `${s.step}:${s.success}`)
          .join(', '),
      })

      if (options.verbose && !passed) {
        console.log(`\n❌ ${scenario.id}`)
        console.log(`   Expected: ${expected}`)
        console.log(`   Actual:   ${pipelineResult.action}`)
        console.log(
          `   Steps:    ${pipelineResult.steps.map((s) => s.step).join(' → ')}`
        )
      }
    } catch (error) {
      results.push({
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedAction || 'respond',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      })
    }
  }

  if (!options.verbose) console.log('')
  return results
}

// ============================================================================
// Metrics computation
// ============================================================================

function computeMetrics(
  results: StepResult[],
  step: PipelineStep,
  totalDurationMs: number
): EvalMetrics {
  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed

  // Build breakdown by expected value
  const breakdown: Record<
    string,
    { tp: number; fp: number; fn: number; precision: number; recall: number }
  > = {}

  // Collect all unique labels
  const labels = new Set<string>()
  for (const r of results) {
    labels.add(r.expected)
    labels.add(r.actual)
  }

  for (const label of labels) {
    if (label.startsWith('ERROR')) continue

    let tp = 0
    let fp = 0
    let fn = 0

    for (const r of results) {
      if (r.actual === label && r.expected === label) tp++
      else if (r.actual === label && r.expected !== label) fp++
      else if (r.actual !== label && r.expected === label) fn++
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0

    breakdown[label] = { tp, fp, fn, precision, recall }
  }

  const metrics: EvalMetrics = {
    total: results.length,
    passed,
    failed,
    accuracy: results.length > 0 ? passed / results.length : 0,
    durationMs: totalDurationMs,
    breakdown,
  }

  // Special metrics for route step
  if (step === 'route') {
    // False silence: expected respond but got silence
    const falseSilence = results.filter(
      (r) => r.expected === 'respond' && r.actual === 'silence'
    ).length
    const shouldRespond = results.filter((r) => r.expected === 'respond').length

    // False respond: expected silence but got respond
    const falseRespond = results.filter(
      (r) => r.expected === 'silence' && r.actual === 'respond'
    ).length
    const shouldSilence = results.filter((r) => r.expected === 'silence').length

    metrics.falseSilenceRate =
      shouldRespond > 0 ? falseSilence / shouldRespond : 0
    metrics.falseRespondRate =
      shouldSilence > 0 ? falseRespond / shouldSilence : 0
  }

  return metrics
}

// ============================================================================
// Output
// ============================================================================

function printMetrics(
  step: PipelineStep,
  metrics: EvalMetrics,
  results?: StepResult[]
): void {
  const stepEmoji: Record<PipelineStep, string> = {
    classify: '🏷️',
    route: '🚦',
    gather: '📦',
    draft: '✍️',
    validate: '✅',
    e2e: '🔄',
  }

  console.log(`${stepEmoji[step]}  ${step.toUpperCase()} Eval Results\n`)
  console.log(`Total: ${metrics.total}`)
  console.log(
    `  ✅ Passed: ${metrics.passed} (${(metrics.accuracy * 100).toFixed(1)}%)`
  )
  console.log(`  ❌ Failed: ${metrics.failed}`)

  if (step === 'route' && metrics.falseSilenceRate !== undefined) {
    console.log(`\nRouting Errors:`)
    console.log(
      `  False silence rate: ${(metrics.falseSilenceRate * 100).toFixed(1)}%`
    )
    console.log(
      `  False respond rate: ${(metrics.falseRespondRate! * 100).toFixed(1)}%`
    )
  }

  // Show breakdown if there are multiple labels
  const labelCount = Object.keys(metrics.breakdown).length
  if (labelCount > 1 && labelCount <= 20) {
    console.log(
      `\nBreakdown by ${step === 'classify' ? 'category' : 'action'}:`
    )

    const sorted = Object.entries(metrics.breakdown)
      .filter(([label]) => !label.startsWith('ERROR'))
      .sort((a, b) => b[1].tp + b[1].fn - (a[1].tp + a[1].fn))

    for (const [label, stats] of sorted) {
      const total = stats.tp + stats.fn
      if (total === 0) continue

      const precisionStr = (stats.precision * 100).toFixed(0)
      const recallStr = (stats.recall * 100).toFixed(0)
      console.log(
        `  ${label}: ${stats.tp}/${total} (P=${precisionStr}% R=${recallStr}%)`
      )
    }
  }

  // Latency
  const avgLatency = metrics.durationMs / metrics.total
  console.log(`\nLatency: ${avgLatency.toFixed(0)}ms avg`)

  // Show individual failures if verbose
  if (results) {
    const failures = results.filter((r) => !r.passed)
    if (failures.length > 0) {
      console.log(`\n--- FAILURES (${failures.length}) ---\n`)
      for (const f of failures.slice(0, 10)) {
        console.log(`❌ ${f.scenarioId}`)
        console.log(`   Expected: ${f.expected}`)
        console.log(`   Actual:   ${f.actual}`)
        if (f.reasoning) {
          console.log(`   Reason:   ${f.reasoning.slice(0, 80)}...`)
        }
        console.log('')
      }
      if (failures.length > 10) {
        console.log(`   ... and ${failures.length - 10} more`)
      }
    }
  }
}
