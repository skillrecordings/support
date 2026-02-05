/**
 * CLI commands for querying Axiom logs and traces
 *
 * Usage:
 *   skill axiom query "['support-traces'] | where name == 'agent.run' | limit 10"
 *   skill axiom agents --app total-typescript --limit 20
 *   skill axiom errors --since 1h
 *   skill axiom conversation <conversationId>
 */

import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import {
  formatDuration,
  formatTime,
  getAxiomClient,
  getDataset,
  parseTimeRange,
} from '../../lib/axiom-client'
import { registerForensicCommands } from './forensic'

const handleAxiomError = (
  ctx: CommandContext,
  error: unknown,
  message: string,
  suggestion = 'Verify AXIOM_TOKEN and query parameters.'
): void => {
  const cliError =
    error instanceof CLIError
      ? error
      : new CLIError({
          userMessage: message,
          suggestion,
          cause: error,
        })

  ctx.output.error(formatError(cliError))
  process.exitCode = cliError.exitCode
}

/**
 * Run a raw APL query
 */
export async function runQuery(
  ctx: CommandContext,
  apl: string,
  options: { since?: string; json?: boolean }
): Promise<void> {
  const client = getAxiomClient()
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    if (outputJson) {
      ctx.output.data(result)
      return
    }

    // Display results in table format
    const matches = result.matches ?? []
    if (matches.length === 0) {
      ctx.output.data('No results found')
      return
    }

    ctx.output.data(
      `\nFound ${matches.length} results (${result.status?.elapsedTime}ms)`
    )
    ctx.output.data('='.repeat(80))

    for (const match of matches) {
      const data = match.data as Record<string, unknown>
      ctx.output.data(`\n[${formatTime(match._time)}]`)
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('_')) continue
        const displayValue =
          typeof value === 'object' ? JSON.stringify(value) : value
        ctx.output.data(`  ${key}: ${displayValue}`)
      }
    }
  } catch (error) {
    handleAxiomError(ctx, error, 'Failed to run Axiom query.')
  }
}

/**
 * List recent agent runs
 */
export async function listAgentRuns(
  ctx: CommandContext,
  options: {
    app?: string
    limit?: number
    since?: string
    json?: boolean
  }
): Promise<void> {
  const client = getAxiomClient()
  const limit = options.limit ?? 20
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')
  const outputJson = options.json === true || ctx.format === 'json'

  let apl = `['${getDataset()}']
| where name == 'agent.run'`

  if (options.app) {
    apl += `
| where appId == '${options.app}'`
  }

  apl += `
| sort by _time desc
| limit ${limit}`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const matches = result.matches ?? []

    if (outputJson) {
      ctx.output.data(matches.map((m) => m.data))
      return
    }

    if (matches.length === 0) {
      ctx.output.data('No agent runs found')
      return
    }

    ctx.output.data('\nRecent Agent Runs')
    ctx.output.data('='.repeat(100))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const time = formatTime(match._time)
      const duration = formatDuration(Number(d.durationMs) || 0)
      const app = d.appId ?? 'unknown'
      const tools = (d.toolCallsCount ?? 0) + ' tools'
      const model = String(d.model ?? '').replace('anthropic/', '')
      const approval = d.requiresApproval ? '!' : d.autoSent ? '+' : '-'

      ctx.output.data(`\n[${time}] ${app} (${duration})`)
      ctx.output.data(`  Model: ${model} | Tools: ${tools} | Auto: ${approval}`)
      ctx.output.data(`  Conv: ${d.conversationId}`)
      if (d.customerEmail) ctx.output.data(`  Customer: ${d.customerEmail}`)
    }

    // Summary stats
    const durations = matches.map(
      (m) => Number((m.data as Record<string, unknown>).durationMs) || 0
    )
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
    const autoSent = matches.filter(
      (m) => (m.data as Record<string, unknown>).autoSent
    ).length
    const approvals = matches.filter(
      (m) => (m.data as Record<string, unknown>).requiresApproval
    ).length

    ctx.output.data('\n' + '-'.repeat(100))
    ctx.output.data(
      `Total: ${matches.length} | Avg duration: ${formatDuration(avgDuration)} | Auto-sent: ${autoSent} | Approvals: ${approvals}`
    )
  } catch (error) {
    handleAxiomError(ctx, error, 'Failed to list recent agent runs.')
  }
}

/**
 * List recent errors
 */
export async function listErrors(
  ctx: CommandContext,
  options: {
    since?: string
    limit?: number
    json?: boolean
  }
): Promise<void> {
  const client = getAxiomClient()
  const limit = options.limit ?? 50
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')
  const outputJson = options.json === true || ctx.format === 'json'

  const apl = `['${getDataset()}']
| where status == 'error' or error != ''
| sort by _time desc
| limit ${limit}`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const matches = result.matches ?? []

    if (outputJson) {
      ctx.output.data(matches.map((m) => m.data))
      return
    }

    if (matches.length === 0) {
      ctx.output.data('No errors found')
      return
    }

    ctx.output.data('\nRecent Errors')
    ctx.output.data('='.repeat(100))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const time = formatTime(match._time)
      const name = d.name ?? 'unknown'
      const error =
        d.error ??
        d.errorStack ??
        d.message ??
        `[${d.level ?? 'error'}] ${d.name ?? 'unknown event'}`

      ctx.output.data(`\n[${time}] ${name}`)
      ctx.output.data(`  Error: ${String(error).slice(0, 200)}`)
      if (d.conversationId) ctx.output.data(`  Conv: ${d.conversationId}`)
      if (d.appId) ctx.output.data(`  App: ${d.appId}`)
    }

    ctx.output.data('\n' + '-'.repeat(100))
    ctx.output.data(`Total errors: ${matches.length}`)
  } catch (error) {
    handleAxiomError(ctx, error, 'Failed to list recent errors.')
  }
}

/**
 * Get all events for a conversation
 */
export async function getConversation(
  ctx: CommandContext,
  conversationId: string,
  options: { since?: string; json?: boolean }
): Promise<void> {
  const client = getAxiomClient()
  const { startTime, endTime } = parseTimeRange(options.since ?? '7d')
  const outputJson = options.json === true || ctx.format === 'json'

  const apl = `['${getDataset()}']
| where conversationId == '${conversationId}'
| sort by _time asc`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const matches = result.matches ?? []

    if (outputJson) {
      ctx.output.data(
        matches.map((m) => ({ _time: m._time, ...(m.data as object) }))
      )
      return
    }

    if (matches.length === 0) {
      ctx.output.data(`No events found for conversation: ${conversationId}`)
      return
    }

    ctx.output.data(`\nConversation Timeline: ${conversationId}`)
    ctx.output.data('='.repeat(100))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const time = formatTime(match._time)
      const name = d.name ?? d.type ?? 'event'
      const duration = d.durationMs
        ? ` (${formatDuration(Number(d.durationMs))})`
        : ''

      ctx.output.data(`\n[${time}] ${name}${duration}`)

      // Show relevant fields based on event type
      if (d.category)
        ctx.output.data(`  Category: ${d.category} (${d.confidence})`)
      if (d.complexity) ctx.output.data(`  Complexity: ${d.complexity}`)
      if (d.routingType) ctx.output.data(`  Routing: ${d.routingType}`)
      if (d.model) ctx.output.data(`  Model: ${d.model}`)
      if (d.toolCallsCount)
        ctx.output.data(
          `  Tools: ${d.toolCallsCount} (${(d.toolNames as string[])?.join(', ') ?? ''})`
        )
      if (d.memoriesRetrieved)
        ctx.output.data(`  Memories: ${d.memoriesRetrieved}`)
      if (d.error) ctx.output.data(`  Error: ${d.error}`)
      if (d.reasoning)
        ctx.output.data(`  Reasoning: ${String(d.reasoning).slice(0, 150)}`)
    }

    ctx.output.data('\n' + '-'.repeat(100))
    ctx.output.data(`Total events: ${matches.length}`)
  } catch (error) {
    handleAxiomError(ctx, error, 'Failed to fetch conversation timeline.')
  }
}

/**
 * Get classification distribution
 */
export async function getClassificationStats(
  ctx: CommandContext,
  options: {
    app?: string
    since?: string
    json?: boolean
  }
): Promise<void> {
  const client = getAxiomClient()
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')
  const outputJson = options.json === true || ctx.format === 'json'

  let apl = `['${getDataset()}']
| where name == 'classifier.run'`

  if (options.app) {
    apl += `
| where appId == '${options.app}'`
  }

  apl += `
| summarize count = count() by category, complexity`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const buckets = result.buckets?.totals ?? []

    if (outputJson) {
      ctx.output.data(buckets)
      return
    }

    if (buckets.length === 0) {
      ctx.output.data('No classification data found')
      return
    }

    ctx.output.data('\nClassification Distribution')
    ctx.output.data('='.repeat(60))

    // Group by category
    const byCategory: Record<
      string,
      { total: number; complexities: Record<string, number> }
    > = {}
    for (const bucket of buckets) {
      const group = bucket.group as Record<string, string>
      const category = group.category ?? 'unknown'
      const complexity = group.complexity ?? 'unknown'
      const count = Number(bucket.aggregations?.[0]?.value ?? 0)

      if (!byCategory[category]) {
        byCategory[category] = { total: 0, complexities: {} }
      }
      byCategory[category].total += count
      byCategory[category].complexities[complexity] =
        (byCategory[category].complexities[complexity] ?? 0) + count
    }

    // Sort by total count
    const sorted = Object.entries(byCategory).sort(
      (a, b) => b[1].total - a[1].total
    )
    const grandTotal = sorted.reduce((sum, [, v]) => sum + v.total, 0)

    for (const [category, { total, complexities }] of sorted) {
      const pct = ((total / grandTotal) * 100).toFixed(1)
      const complexityStr = Object.entries(complexities)
        .map(([c, n]) => `${c}:${n}`)
        .join(', ')
      ctx.output.data(
        `${category.padEnd(25)} ${String(total).padStart(5)} (${pct.padStart(5)}%)  [${complexityStr}]`
      )
    }

    ctx.output.data('-'.repeat(60))
    ctx.output.data(`Total classifications: ${grandTotal}`)
  } catch (error) {
    handleAxiomError(ctx, error, 'Failed to fetch classification stats.')
  }
}

/**
 * List workflow step traces (for debugging timeout issues)
 */
export async function listWorkflowSteps(
  ctx: CommandContext,
  options: {
    workflow?: string
    conversation?: string
    since?: string
    limit?: number
    json?: boolean
  }
): Promise<void> {
  const client = getAxiomClient()
  const limit = options.limit ?? 50
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')
  const outputJson = options.json === true || ctx.format === 'json'

  let apl = `['${getDataset()}']
| where type == 'workflow-step'`

  if (options.workflow) {
    apl += `
| where workflowName == '${options.workflow}'`
  }

  if (options.conversation) {
    apl += `
| where conversationId == '${options.conversation}'`
  }

  apl += `
| sort by _time desc
| limit ${limit}`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const matches = result.matches ?? []

    if (outputJson) {
      ctx.output.data(matches.map((m) => m.data))
      return
    }

    if (matches.length === 0) {
      ctx.output.data('No workflow steps found')
      return
    }

    ctx.output.data('\nWorkflow Steps')
    ctx.output.data('='.repeat(100))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const time = formatTime(match._time)
      const workflow = d.workflowName ?? 'unknown'
      const step = d.stepName ?? 'unknown'
      const duration = formatDuration(Number(d.durationMs) || 0)
      const success = d.success ? '✓' : '✗'

      ctx.output.data(
        `\n[${time}] ${workflow} > ${step} ${success} (${duration})`
      )
      if (d.conversationId) ctx.output.data(`  Conv: ${d.conversationId}`)
      if (d.error) ctx.output.data(`  Error: ${d.error}`)
      if (d.metadata) ctx.output.data(`  Meta: ${JSON.stringify(d.metadata)}`)
    }

    ctx.output.data('\n' + '-'.repeat(100))
    ctx.output.data(`Total: ${matches.length}`)
  } catch (error) {
    handleAxiomError(ctx, error, 'Failed to list workflow steps.')
  }
}

/**
 * List approval-related traces (for debugging HITL flow)
 */
export async function listApprovals(
  ctx: CommandContext,
  options: {
    since?: string
    limit?: number
    json?: boolean
  }
): Promise<void> {
  const client = getAxiomClient()
  const limit = options.limit ?? 30
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')
  const outputJson = options.json === true || ctx.format === 'json'

  const apl = `['${getDataset()}']
| where type in ('approval', 'slack')
| sort by _time desc
| limit ${limit}`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const matches = result.matches ?? []

    if (outputJson) {
      ctx.output.data(matches.map((m) => m.data))
      return
    }

    if (matches.length === 0) {
      ctx.output.data('No approval traces found')
      return
    }

    ctx.output.data('\nApproval Flow Traces')
    ctx.output.data('='.repeat(100))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const time = formatTime(match._time)
      const name = d.name ?? 'unknown'
      const actionId = d.actionId ?? ''
      const success = d.success !== undefined ? (d.success ? '✓' : '✗') : ''
      const duration = d.durationMs
        ? ` (${formatDuration(Number(d.durationMs))})`
        : ''

      ctx.output.data(`\n[${time}] ${name} ${success}${duration}`)
      if (actionId) ctx.output.data(`  Action: ${actionId}`)
      if (d.actionType) ctx.output.data(`  Type: ${d.actionType}`)
      if (d.conversationId) ctx.output.data(`  Conv: ${d.conversationId}`)
      if (d.channel) ctx.output.data(`  Channel: ${d.channel}`)
      if (d.messageTs) ctx.output.data(`  Slack TS: ${d.messageTs}`)
      if (d.error) ctx.output.data(`  Error: ${d.error}`)
      if (d.customerEmail) ctx.output.data(`  Customer: ${d.customerEmail}`)
    }

    ctx.output.data('\n' + '-'.repeat(100))
    ctx.output.data(`Total: ${matches.length}`)
  } catch (error) {
    handleAxiomError(ctx, error, 'Failed to list approval traces.')
  }
}

/**
 * Register Axiom commands with Commander
 */
export function registerAxiomCommands(program: Command): void {
  const axiom = program
    .command('axiom')
    .description('Query Axiom logs and traces')

  axiom
    .command('query')
    .description('Run a raw APL query')
    .argument('<apl>', 'APL query string')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(async (apl, options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await runQuery(ctx, apl, options)
    })

  axiom
    .command('agents')
    .description('List recent agent runs')
    .option('-a, --app <slug>', 'Filter by app')
    .option('-l, --limit <n>', 'Number of results', parseInt)
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await listAgentRuns(ctx, options)
    })

  axiom
    .command('errors')
    .description('List recent errors')
    .option('-l, --limit <n>', 'Number of results', parseInt)
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await listErrors(ctx, options)
    })

  axiom
    .command('conversation')
    .description('Get all events for a conversation')
    .argument('<conversationId>', 'Front conversation ID')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '7d')
    .option('--json', 'Output as JSON')
    .action(async (conversationId, options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await getConversation(ctx, conversationId, options)
    })

  axiom
    .command('classifications')
    .description('Show classification distribution')
    .option('-a, --app <slug>', 'Filter by app')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await getClassificationStats(ctx, options)
    })

  axiom
    .command('workflow-steps')
    .description('List workflow step traces (for debugging timeouts)')
    .option('-w, --workflow <name>', 'Filter by workflow name')
    .option('-c, --conversation <id>', 'Filter by conversation ID')
    .option('-l, --limit <n>', 'Number of results', parseInt)
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await listWorkflowSteps(ctx, options)
    })

  axiom
    .command('approvals')
    .description('List approval flow traces (HITL debugging)')
    .option('-l, --limit <n>', 'Number of results', parseInt)
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await listApprovals(ctx, options)
    })

  // Register forensic / self-diagnosis queries
  registerForensicCommands(axiom)
}
