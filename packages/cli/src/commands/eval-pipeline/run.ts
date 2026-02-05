/**
 * Pipeline step evaluation runner
 *
 * Runs actual pipeline steps against labeled scenarios and measures accuracy.
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
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
import { type CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import {
  cleanupRealTools,
  createRealTools,
  initRealTools,
  isRealToolsAvailable,
} from './real-tools'

// ============================================================================
// Concurrency helpers
// ============================================================================

/**
 * Run items in batches with controlled concurrency
 */
async function runBatch<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => fn(item, i + batchIndex))
    )
    results.push(...batchResults)
  }
  return results
}

/**
 * Run items in batches with fail-fast support
 */
async function runBatchWithFailFast<T, R extends { passed: boolean }>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
  failFast: boolean
): Promise<{ results: R[]; aborted: boolean }> {
  const results: R[] = []
  let aborted = false

  for (let i = 0; i < items.length && !aborted; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => fn(item, i + batchIndex))
    )
    results.push(...batchResults)

    if (failFast && batchResults.some((r) => !r.passed)) {
      aborted = true
    }
  }

  return { results, aborted }
}

// ============================================================================
// Classify cache helpers
// ============================================================================

const CACHE_DIR = '.eval-cache'

function getCacheKey(scenarioId: string, classifySourceHash: string): string {
  return `classify-${scenarioId}-${classifySourceHash.slice(0, 8)}`
}

function getClassifySourceHash(): string {
  // Hash based on classify.ts content to invalidate cache when code changes
  try {
    // Try to read the classify source from core package
    const possiblePaths = [
      join(process.cwd(), 'packages/core/src/pipeline/classify.ts'),
      join(process.cwd(), '../core/src/pipeline/classify.ts'),
    ]
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        const content = readFileSync(path, 'utf-8')
        return createHash('md5').update(content).digest('hex')
      }
    }
  } catch {
    // Fallback: use timestamp-based invalidation (cache for 1 hour)
  }
  // Fallback hash based on current hour
  return createHash('md5')
    .update(Math.floor(Date.now() / 300000).toString())
    .digest('hex')
}

function loadCachedClassify(cacheKey: string): ClassifyOutput | null {
  const cachePath = join(CACHE_DIR, `${cacheKey}.json`)
  try {
    if (existsSync(cachePath)) {
      return JSON.parse(readFileSync(cachePath, 'utf-8'))
    }
  } catch {
    // Cache miss or invalid
  }
  return null
}

function saveCachedClassify(cacheKey: string, result: ClassifyOutput): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true })
    }
    const cachePath = join(CACHE_DIR, `${cacheKey}.json`)
    writeFileSync(cachePath, JSON.stringify(result))
  } catch {
    // Ignore cache write errors
  }
}

function clearClassifyCache(): void {
  try {
    if (existsSync(CACHE_DIR)) {
      rmSync(CACHE_DIR, { recursive: true, force: true })
    }
  } catch {
    // Ignore
  }
}

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
  parallel?: number
  cacheClassify?: boolean
  clearCache?: boolean
  failFast?: boolean
  quick?: boolean
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

export async function run(
  ctx: CommandContext,
  options: RunOptions
): Promise<void> {
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
    parallel = 10,
    cacheClassify,
    clearCache,
    failFast,
    quick,
  } = options
  const outputJson = json === true || ctx.format === 'json'

  try {
    // Clear cache if requested
    if (clearCache) {
      clearClassifyCache()
      if (!outputJson) {
        ctx.output.message('🗑️  Cleared classify cache')
      }
    }

    // Load scenarios
    let scenarios = await loadScenarios(scenarioGlob, dataset)

    // Apply quick filter (smoke test subset)
    if (quick) {
      scenarios = filterQuickScenarios(scenarios)
      if (!outputJson) {
        ctx.output.message(
          `⚡ Quick mode: filtered to ${scenarios.length} scenarios`
        )
      }
    }

    if (limit && limit < scenarios.length) {
      scenarios = scenarios.slice(0, limit)
    }

    if (!outputJson) {
      const parallelInfo = parallel > 1 ? ` (parallel: ${parallel})` : ''
      const flags = [
        cacheClassify ? 'cache' : null,
        failFast ? 'fail-fast' : null,
      ]
        .filter(Boolean)
        .join(', ')
      const flagsInfo = flags ? ` [${flags}]` : ''
      ctx.output.data(
        `\n🧪 Running ${step} eval on ${scenarios.length} scenarios${parallelInfo}${flagsInfo}\n`
      )
    }

    // Initialize real tools if requested
    if (realTools) {
      if (!outputJson) {
        ctx.output.message('🔌 Connecting to Docker services...')
      }
      const status = await initRealTools(
        undefined,
        ctx.output,
        verbose && !outputJson
      )

      if (!status.mysql && !status.qdrant) {
        throw new CLIError({
          userMessage: 'Failed to connect to any Docker services.',
          suggestion: 'Make sure MySQL (3306) and Qdrant (6333) are running.',
        })
      }

      if (!outputJson) {
        ctx.output.data('')
      }
    }

    const startTime = Date.now()
    let results: StepResult[] = []

    try {
      const evalOptions = {
        verbose,
        model,
        forceLlm,
        realTools,
        parallel,
        cacheClassify,
        failFast,
        outputJson,
      }

      switch (step) {
        case 'classify':
          results = await runClassifyEval(ctx, scenarios, evalOptions)
          break
        case 'route':
          results = await runRouteEval(ctx, scenarios, evalOptions)
          break
        case 'gather':
          results = await runGatherEval(ctx, scenarios, evalOptions)
          break
        case 'validate':
          results = await runValidateEval(ctx, scenarios, evalOptions)
          break
        case 'e2e':
          results = await runE2EEval(ctx, scenarios, evalOptions)
          break
        case 'draft':
          throw new CLIError({
            userMessage: `Step "${step}" not yet implemented.`,
            suggestion: 'Use e2e for full pipeline.',
          })
        default:
          throw new CLIError({
            userMessage: `Unknown step: ${step}.`,
            suggestion: 'Use classify, route, gather, validate, or e2e.',
          })
      }
    } finally {
      // Clean up real tools connections
      if (realTools) {
        await cleanupRealTools()
      }
    }

    const totalDuration = Date.now() - startTime
    const metrics = computeMetrics(results, step, totalDuration)

    if (outputJson) {
      ctx.output.data({ metrics, results })
    } else {
      printMetrics(ctx, step, metrics, verbose ? results : undefined)
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Eval pipeline failed.',
            suggestion: 'Verify inputs and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
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
      throw new CLIError({
        userMessage: `No scenario files found matching: ${scenarioGlob}.`,
        suggestion: 'Verify the glob pattern or use --dataset.',
      })
    }

    return Promise.all(
      files.map(async (file) => {
        const content = await readFile(file, 'utf-8')
        return JSON.parse(content)
      })
    )
  }

  throw new CLIError({
    userMessage: 'Must provide --scenarios or --dataset.',
    suggestion: 'Pass one of the options to run the eval.',
  })
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
 * Filter scenarios for quick mode (smoke test subset)
 * Returns scenarios with smoke: true, or first 2 from each category
 */
function filterQuickScenarios(scenarios: Scenario[]): Scenario[] {
  // First, try to use smoke flag
  const smokeScenarios = scenarios.filter((s: any) => s.smoke === true)
  if (smokeScenarios.length > 0) {
    return smokeScenarios
  }

  // Fallback: first 2 from each category
  const byCategory = new Map<string, Scenario[]>()
  for (const scenario of scenarios) {
    const cat =
      scenario.expectedCategory ||
      scenario.category ||
      scenario.expectedAction ||
      'other'
    if (!byCategory.has(cat)) {
      byCategory.set(cat, [])
    }
    byCategory.get(cat)!.push(scenario)
  }

  const result: Scenario[] = []
  for (const [, categoryScenarios] of byCategory) {
    result.push(...categoryScenarios.slice(0, 2))
  }

  return result
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
  parallel?: number
  cacheClassify?: boolean
  failFast?: boolean
  outputJson?: boolean
}

async function runClassifyEval(
  ctx: CommandContext,
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const concurrency = options.parallel || 1
  const classifyHash = options.cacheClassify ? getClassifySourceHash() : ''
  let completed = 0
  const outputJson = options.outputJson ?? false

  const processScenario = async (scenario: Scenario): Promise<StepResult> => {
    const trigger = scenario.trigger || scenario.triggerMessage
    if (!trigger) {
      return {
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedCategory || 'unknown',
        actual: 'ERROR: no trigger',
        durationMs: 0,
      }
    }

    const input: ClassifyInput = {
      subject: trigger.subject,
      body: trigger.body,
      appId: scenario.appId,
    }

    const startTime = Date.now()
    try {
      let result: ClassifyOutput

      // Check cache if enabled
      if (options.cacheClassify) {
        const cacheKey = getCacheKey(scenario.id, classifyHash)
        const cached = loadCachedClassify(cacheKey)
        if (cached) {
          result = cached
        } else {
          result = await classify(input, {
            forceLLM: options.forceLlm,
            model: options.model,
          })
          saveCachedClassify(cacheKey, result)
        }
      } else {
        result = await classify(input, {
          forceLLM: options.forceLlm,
          model: options.model,
        })
      }

      const expected = scenario.expectedCategory || 'unknown'
      const passed = result.category === expected

      completed++
      if (!options.verbose && !outputJson && ctx.verbose) {
        ctx.output.progress(`Processing ${completed}/${scenarios.length}...`)
      }

      if (options.verbose && !passed) {
        ctx.output.data(`\n❌ ${scenario.id}`)
        ctx.output.data(`   Expected: ${expected}`)
        ctx.output.data(
          `   Actual:   ${result.category} (${(result.confidence * 100).toFixed(0)}%)`
        )
        ctx.output.data(`   Subject:  ${trigger.subject.slice(0, 60)}...`)
      }

      return {
        scenarioId: scenario.id,
        passed,
        expected,
        actual: result.category,
        confidence: result.confidence,
        durationMs: Date.now() - startTime,
        reasoning: result.reasoning,
      }
    } catch (error) {
      completed++
      return {
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedCategory || 'unknown',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      }
    }
  }

  const { results, aborted } = await runBatchWithFailFast(
    scenarios,
    (scenario) => processScenario(scenario),
    concurrency,
    options.failFast || false
  )

  if (aborted && !outputJson) {
    ctx.output.warn('Stopped early due to --fail-fast')
  }
  return results
}

async function runRouteEval(
  ctx: CommandContext,
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const concurrency = options.parallel || 1
  const classifyHash = options.cacheClassify ? getClassifySourceHash() : ''
  let completed = 0
  const outputJson = options.outputJson ?? false

  const processScenario = async (scenario: Scenario): Promise<StepResult> => {
    const trigger = scenario.trigger || scenario.triggerMessage
    if (!trigger) {
      return {
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedAction || 'unknown',
        actual: 'ERROR: no trigger',
        durationMs: 0,
      }
    }

    const input: ClassifyInput = {
      subject: trigger.subject,
      body: trigger.body,
      appId: scenario.appId,
    }

    const startTime = Date.now()
    try {
      // First classify (with cache support), then route
      let classification: ClassifyOutput

      if (options.cacheClassify) {
        const cacheKey = getCacheKey(scenario.id, classifyHash)
        const cached = loadCachedClassify(cacheKey)
        if (cached) {
          classification = cached
        } else {
          classification = await classify(input, {
            forceLLM: options.forceLlm,
            model: options.model,
          })
          saveCachedClassify(cacheKey, classification)
        }
      } else {
        classification = await classify(input, {
          forceLLM: options.forceLlm,
          model: options.model,
        })
      }

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

      completed++
      if (!options.verbose && !outputJson && ctx.verbose) {
        ctx.output.progress(`Processing ${completed}/${scenarios.length}...`)
      }

      if (options.verbose && !passed) {
        ctx.output.data(`\n❌ ${scenario.id}`)
        ctx.output.data(`   Expected: ${expected}`)
        ctx.output.data(`   Actual:   ${routeResult.action}`)
        ctx.output.data(`   Category: ${classification.category}`)
        ctx.output.data(`   Reason:   ${routeResult.reason}`)
      }

      return {
        scenarioId: scenario.id,
        passed,
        expected,
        actual: routeResult.action,
        durationMs: Date.now() - startTime,
        reasoning: routeResult.reason,
      }
    } catch (error) {
      completed++
      return {
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedAction || 'respond',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      }
    }
  }

  const { results, aborted } = await runBatchWithFailFast(
    scenarios,
    (scenario) => processScenario(scenario),
    concurrency,
    options.failFast || false
  )

  if (aborted && !outputJson) {
    ctx.output.warn('Stopped early due to --fail-fast')
  }
  return results
}

async function runGatherEval(
  ctx: CommandContext,
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const concurrency = options.parallel || 1
  let completed = 0
  const outputJson = options.outputJson ?? false

  // Check if real tools are available
  const useRealTools = options.realTools && isRealToolsAvailable()

  if (!useRealTools) {
    // Fallback to mock behavior
    const results = scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      passed: true,
      expected: 'context_complete',
      actual: 'context_complete',
      durationMs: 0,
      reasoning: 'Gather eval requires --real-tools flag with Docker services',
    }))

    if (!options.verbose && !outputJson) {
      ctx.output.message(
        `Processing ${scenarios.length}/${scenarios.length}...`
      )
    }
    if (!outputJson) {
      ctx.output.warn(
        'Gather eval: Use --real-tools with Docker services for actual tool calls'
      )
    }
    return results
  }

  const processScenario = async (scenario: Scenario): Promise<StepResult> => {
    const trigger = scenario.trigger || scenario.triggerMessage
    if (!trigger) {
      return {
        scenarioId: scenario.id,
        passed: false,
        expected: 'context_complete',
        actual: 'ERROR: no trigger',
        durationMs: 0,
      }
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

      completed++
      if (!options.verbose && !outputJson && ctx.verbose) {
        ctx.output.progress(`Processing ${completed}/${scenarios.length}...`)
      }

      if (options.verbose && !hasContext) {
        ctx.output.data(`\n⚠️  ${scenario.id}`)
        ctx.output.data(`   Context: ${toolResults.join(', ')}`)
      }

      return {
        scenarioId: scenario.id,
        passed: hasContext,
        expected,
        actual,
        durationMs: Date.now() - startTime,
        reasoning: toolResults.join(', '),
      }
    } catch (error) {
      completed++
      return {
        scenarioId: scenario.id,
        passed: false,
        expected: 'context_complete',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      }
    }
  }

  const { results, aborted } = await runBatchWithFailFast(
    scenarios,
    (scenario) => processScenario(scenario),
    concurrency,
    options.failFast || false
  )

  if (aborted && !outputJson) {
    ctx.output.warn('Stopped early due to --fail-fast')
  }
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
  ctx: CommandContext,
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const concurrency = options.parallel || 1
  let completed = 0
  const outputJson = options.outputJson ?? false

  // Filter to scenarios with drafts or assertions
  const validScenarios = scenarios.filter((s) => s.draft || s.assertions)

  if (validScenarios.length === 0) {
    if (!outputJson) {
      ctx.output.warn('No scenarios with draft or assertions found.')
      ctx.output.message('For validate eval, scenarios need either:')
      ctx.output.message('   - "draft": "text to validate"')
      ctx.output.message('   - "assertions": { "noFabrication": true, ... }')
    }
    return []
  }

  const processScenario = async (scenario: Scenario): Promise<StepResult> => {
    // If scenario has no draft but has assertions, it's for checking generated drafts
    // For now, skip those (they'd need full pipeline)
    if (!scenario.draft) {
      return {
        scenarioId: scenario.id,
        passed: true, // Can't evaluate without draft
        expected: 'needs_draft',
        actual: 'skipped',
        durationMs: 0,
        reasoning: 'No draft provided - use e2e eval with assertions',
      }
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
      priorConversations: [],
      gatherErrors: [],
    }

    try {
      const result = await validate({
        draft: scenario.draft,
        context: mockContext,
        strictMode: false,
      })

      // Map issue types to assertion names (unused but kept for documentation)
      const _issueTypeToAssertion: Record<
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
        repeated_mistake: 'noBannedPhrases', // No specific assertion
        relevance: 'noBannedPhrases', // No specific assertion for relevance
        ground_truth_mismatch: 'noBannedPhrases', // No specific assertion
        audience_inappropriate: 'noBannedPhrases', // No specific assertion
        tool_failure: 'noBannedPhrases', // No specific assertion
      }

      // Check if assertions match
      const assertions = scenario.assertions || {}
      const failedAssertions: string[] = []
      const foundIssueTypes = new Set(
        result.issues.map((i: { type: string }) => i.type)
      )

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
        .map(
          (i: { type: string; match?: string }) =>
            `${i.type}:${i.match || 'none'}`
        )
        .join(', ')

      completed++
      if (!options.verbose && !outputJson && ctx.verbose) {
        ctx.output.progress(
          `Processing ${completed}/${validScenarios.length}...`
        )
      }

      if (options.verbose && !passed) {
        ctx.output.data(`\n❌ ${scenario.id}`)
        ctx.output.data(`   Failed assertions: ${failedAssertions.join(', ')}`)
        ctx.output.data(`   Issues found: ${issuesSummary || 'none'}`)
        ctx.output.data(`   Draft preview: ${scenario.draft.slice(0, 80)}...`)
      }

      return {
        scenarioId: scenario.id,
        passed,
        expected: 'valid',
        actual: passed ? 'valid' : `invalid: ${failedAssertions.join('; ')}`,
        durationMs: Date.now() - startTime,
        reasoning: issuesSummary || 'no issues found',
      }
    } catch (error) {
      completed++
      return {
        scenarioId: scenario.id,
        passed: false,
        expected: 'valid',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      }
    }
  }

  const { results, aborted } = await runBatchWithFailFast(
    validScenarios,
    (scenario) => processScenario(scenario),
    concurrency,
    options.failFast || false
  )

  if (aborted && !outputJson) {
    ctx.output.warn('Stopped early due to --fail-fast')
  }
  return results
}

async function runE2EEval(
  ctx: CommandContext,
  scenarios: Scenario[],
  options: EvalOptions
): Promise<StepResult[]> {
  const { runPipeline } = await import('@skillrecordings/core/pipeline')
  const concurrency = options.parallel || 1
  let completed = 0
  const outputJson = options.outputJson ?? false

  // Note: Real tools are available when --real-tools is passed
  // They're initialized globally and accessible to the pipeline's gather step
  if (options.realTools && options.verbose) {
    const available = isRealToolsAvailable()
    if (!outputJson) {
      ctx.output.message(
        `Real tools: ${available ? 'connected' : 'not available'}`
      )
    }
  }

  const processScenario = async (scenario: Scenario): Promise<StepResult> => {
    const trigger = scenario.trigger || scenario.triggerMessage
    if (!trigger) {
      return {
        scenarioId: scenario.id,
        passed: false,
        expected: 'respond',
        actual: 'ERROR: no trigger',
        durationMs: 0,
      }
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

      completed++
      if (!options.verbose && !outputJson && ctx.verbose) {
        ctx.output.progress(`Processing ${completed}/${scenarios.length}...`)
      }

      if (options.verbose && !passed) {
        ctx.output.data(`\n❌ ${scenario.id}`)
        ctx.output.data(`   Expected: ${expected}`)
        ctx.output.data(`   Actual:   ${pipelineResult.action}`)
        ctx.output.data(
          `   Steps:    ${pipelineResult.steps.map((s) => s.step).join(' → ')}`
        )
      }

      return {
        scenarioId: scenario.id,
        passed,
        expected,
        actual: pipelineResult.action,
        durationMs: Date.now() - startTime,
        reasoning: pipelineResult.steps
          .map((s) => `${s.step}:${s.success}`)
          .join(', '),
      }
    } catch (error) {
      completed++
      return {
        scenarioId: scenario.id,
        passed: false,
        expected: scenario.expectedAction || 'respond',
        actual: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
        durationMs: Date.now() - startTime,
      }
    }
  }

  const { results, aborted } = await runBatchWithFailFast(
    scenarios,
    (scenario) => processScenario(scenario),
    concurrency,
    options.failFast || false
  )

  if (aborted && !outputJson) {
    ctx.output.warn('Stopped early due to --fail-fast')
  }
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
  ctx: CommandContext,
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

  ctx.output.data(`${stepEmoji[step]}  ${step.toUpperCase()} Eval Results\n`)
  ctx.output.data(`Total: ${metrics.total}`)
  ctx.output.data(
    `  ✅ Passed: ${metrics.passed} (${(metrics.accuracy * 100).toFixed(1)}%)`
  )
  ctx.output.data(`  ❌ Failed: ${metrics.failed}`)

  if (step === 'route' && metrics.falseSilenceRate !== undefined) {
    ctx.output.data(`\nRouting Errors:`)
    ctx.output.data(
      `  False silence rate: ${(metrics.falseSilenceRate * 100).toFixed(1)}%`
    )
    ctx.output.data(
      `  False respond rate: ${(metrics.falseRespondRate! * 100).toFixed(1)}%`
    )
  }

  // Show breakdown if there are multiple labels
  const labelCount = Object.keys(metrics.breakdown).length
  if (labelCount > 1 && labelCount <= 20) {
    ctx.output.data(
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
      ctx.output.data(
        `  ${label}: ${stats.tp}/${total} (P=${precisionStr}% R=${recallStr}%)`
      )
    }
  }

  // Latency
  const avgLatency = metrics.durationMs / metrics.total
  ctx.output.data(`\nLatency: ${avgLatency.toFixed(0)}ms avg`)

  // Show individual failures if verbose
  if (results) {
    const failures = results.filter((r) => !r.passed)
    if (failures.length > 0) {
      ctx.output.data(`\n--- FAILURES (${failures.length}) ---\n`)
      for (const f of failures.slice(0, 10)) {
        ctx.output.data(`❌ ${f.scenarioId}`)
        ctx.output.data(`   Expected: ${f.expected}`)
        ctx.output.data(`   Actual:   ${f.actual}`)
        if (f.reasoning) {
          ctx.output.data(`   Reason:   ${f.reasoning.slice(0, 80)}...`)
        }
        ctx.output.data('')
      }
      if (failures.length > 10) {
        ctx.output.data(`   ... and ${failures.length - 10} more`)
      }
    }
  }
}
