/**
 * CLI commands for querying Axiom logs and traces
 *
 * Usage:
 *   skill axiom query "['support-traces'] | where name == 'agent.run' | limit 10"
 *   skill axiom agents --app total-typescript --limit 20
 *   skill axiom errors --since 1h
 *   skill axiom conversation <conversationId>
 */

import { Axiom } from '@axiomhq/js'
import type { Command } from 'commander'

/**
 * Get dataset name from env or default
 */
function getDataset(): string {
  return process.env.AXIOM_DATASET || 'support-agent'
}

/**
 * Get Axiom client (requires AXIOM_TOKEN env var)
 */
function getAxiomClient(): Axiom {
  const token = process.env.AXIOM_TOKEN
  if (!token) {
    console.error('AXIOM_TOKEN environment variable is required')
    process.exit(1)
  }
  return new Axiom({ token })
}

/**
 * Format duration in milliseconds to human-readable
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

/**
 * Format timestamp
 */
function formatTime(timestamp: string | Date): string {
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Parse time range string to start/end dates
 */
function parseTimeRange(since: string): { startTime: Date; endTime: Date } {
  const endTime = new Date()
  let startTime: Date

  // Parse duration strings like "1h", "24h", "7d"
  const match = since.match(/^(\d+)([hmd])$/)
  if (match && match[1] && match[2]) {
    const value = parseInt(match[1], 10)
    const unit = match[2] as 'h' | 'm' | 'd'
    const msPerUnit: Record<'h' | 'm' | 'd', number> = {
      h: 60 * 60 * 1000,
      m: 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    }
    startTime = new Date(endTime.getTime() - value * msPerUnit[unit])
  } else {
    // Try ISO date
    startTime = new Date(since)
    if (isNaN(startTime.getTime())) {
      console.error(
        `Invalid time range: ${since}. Use format like "1h", "24h", "7d" or ISO date.`
      )
      process.exit(1)
    }
  }

  return { startTime, endTime }
}

/**
 * Run a raw APL query
 */
async function runQuery(
  apl: string,
  options: { since?: string; json?: boolean }
): Promise<void> {
  const client = getAxiomClient()
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    // Display results in table format
    const matches = result.matches ?? []
    if (matches.length === 0) {
      console.log('No results found')
      return
    }

    console.log(
      `\nFound ${matches.length} results (${result.status?.elapsedTime}ms)`
    )
    console.log('='.repeat(80))

    for (const match of matches) {
      const data = match.data as Record<string, unknown>
      console.log(`\n[${formatTime(match._time)}]`)
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('_')) continue
        const displayValue =
          typeof value === 'object' ? JSON.stringify(value) : value
        console.log(`  ${key}: ${displayValue}`)
      }
    }
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

/**
 * List recent agent runs
 */
async function listAgentRuns(options: {
  app?: string
  limit?: number
  since?: string
  json?: boolean
}): Promise<void> {
  const client = getAxiomClient()
  const limit = options.limit ?? 20
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')

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

    if (options.json) {
      console.log(
        JSON.stringify(
          matches.map((m) => m.data),
          null,
          2
        )
      )
      return
    }

    if (matches.length === 0) {
      console.log('No agent runs found')
      return
    }

    console.log('\nRecent Agent Runs')
    console.log('='.repeat(100))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const time = formatTime(match._time)
      const duration = formatDuration(Number(d.durationMs) || 0)
      const app = d.appId ?? 'unknown'
      const tools = (d.toolCallsCount ?? 0) + ' tools'
      const model = String(d.model ?? '').replace('anthropic/', '')
      const approval = d.requiresApproval ? '!' : d.autoSent ? '+' : '-'

      console.log(`\n[${time}] ${app} (${duration})`)
      console.log(`  Model: ${model} | Tools: ${tools} | Auto: ${approval}`)
      console.log(`  Conv: ${d.conversationId}`)
      if (d.customerEmail) console.log(`  Customer: ${d.customerEmail}`)
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

    console.log('\n' + '-'.repeat(100))
    console.log(
      `Total: ${matches.length} | Avg duration: ${formatDuration(avgDuration)} | Auto-sent: ${autoSent} | Approvals: ${approvals}`
    )
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

/**
 * List recent errors
 */
async function listErrors(options: {
  since?: string
  limit?: number
  json?: boolean
}): Promise<void> {
  const client = getAxiomClient()
  const limit = options.limit ?? 50
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')

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

    if (options.json) {
      console.log(
        JSON.stringify(
          matches.map((m) => m.data),
          null,
          2
        )
      )
      return
    }

    if (matches.length === 0) {
      console.log('No errors found')
      return
    }

    console.log('\nRecent Errors')
    console.log('='.repeat(100))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const time = formatTime(match._time)
      const name = d.name ?? 'unknown'
      const error = d.error ?? d.errorStack ?? 'no message'

      console.log(`\n[${time}] ${name}`)
      console.log(`  Error: ${String(error).slice(0, 200)}`)
      if (d.conversationId) console.log(`  Conv: ${d.conversationId}`)
      if (d.appId) console.log(`  App: ${d.appId}`)
    }

    console.log('\n' + '-'.repeat(100))
    console.log(`Total errors: ${matches.length}`)
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

/**
 * Get all events for a conversation
 */
async function getConversation(
  conversationId: string,
  options: { since?: string; json?: boolean }
): Promise<void> {
  const client = getAxiomClient()
  const { startTime, endTime } = parseTimeRange(options.since ?? '7d')

  const apl = `['${getDataset()}']
| where conversationId == '${conversationId}'
| sort by _time asc`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const matches = result.matches ?? []

    if (options.json) {
      console.log(
        JSON.stringify(
          matches.map((m) => ({ _time: m._time, ...(m.data as object) })),
          null,
          2
        )
      )
      return
    }

    if (matches.length === 0) {
      console.log(`No events found for conversation: ${conversationId}`)
      return
    }

    console.log(`\nConversation Timeline: ${conversationId}`)
    console.log('='.repeat(100))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const time = formatTime(match._time)
      const name = d.name ?? d.type ?? 'event'
      const duration = d.durationMs
        ? ` (${formatDuration(Number(d.durationMs))})`
        : ''

      console.log(`\n[${time}] ${name}${duration}`)

      // Show relevant fields based on event type
      if (d.category) console.log(`  Category: ${d.category} (${d.confidence})`)
      if (d.complexity) console.log(`  Complexity: ${d.complexity}`)
      if (d.routingType) console.log(`  Routing: ${d.routingType}`)
      if (d.model) console.log(`  Model: ${d.model}`)
      if (d.toolCallsCount)
        console.log(
          `  Tools: ${d.toolCallsCount} (${(d.toolNames as string[])?.join(', ') ?? ''})`
        )
      if (d.memoriesRetrieved) console.log(`  Memories: ${d.memoriesRetrieved}`)
      if (d.error) console.log(`  Error: ${d.error}`)
      if (d.reasoning)
        console.log(`  Reasoning: ${String(d.reasoning).slice(0, 150)}`)
    }

    console.log('\n' + '-'.repeat(100))
    console.log(`Total events: ${matches.length}`)
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

/**
 * Get classification distribution
 */
async function getClassificationStats(options: {
  app?: string
  since?: string
  json?: boolean
}): Promise<void> {
  const client = getAxiomClient()
  const { startTime, endTime } = parseTimeRange(options.since ?? '24h')

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

    if (options.json) {
      console.log(JSON.stringify(buckets, null, 2))
      return
    }

    if (buckets.length === 0) {
      console.log('No classification data found')
      return
    }

    console.log('\nClassification Distribution')
    console.log('='.repeat(60))

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
      console.log(
        `${category.padEnd(25)} ${String(total).padStart(5)} (${pct.padStart(5)}%)  [${complexityStr}]`
      )
    }

    console.log('-'.repeat(60))
    console.log(`Total classifications: ${grandTotal}`)
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
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
    .action(runQuery)

  axiom
    .command('agents')
    .description('List recent agent runs')
    .option('-a, --app <slug>', 'Filter by app')
    .option('-l, --limit <n>', 'Number of results', parseInt)
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(listAgentRuns)

  axiom
    .command('errors')
    .description('List recent errors')
    .option('-l, --limit <n>', 'Number of results', parseInt)
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(listErrors)

  axiom
    .command('conversation')
    .description('Get all events for a conversation')
    .argument('<conversationId>', 'Front conversation ID')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '7d')
    .option('--json', 'Output as JSON')
    .action(getConversation)

  axiom
    .command('classifications')
    .description('Show classification distribution')
    .option('-a, --app <slug>', 'Filter by app')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(getClassificationStats)
}
