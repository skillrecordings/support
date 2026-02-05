/**
 * Inngest patterns command - aggregate event analysis
 *
 * Analyzes event distribution, function success rates, and frequency patterns.
 */

import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { withSpinner } from '../../core/spinner'
import { InngestClient, parseTimeArg } from './client'

interface FunctionFinishedData {
  _inngest?: { status?: string }
  function_id?: string
  run_id?: string
  error?: { message?: string; name?: string }
}

interface EventPattern {
  name: string
  count: number
  frequency_per_hour: number
}

interface FunctionStats {
  success: number
  failed: number
  success_rate: number
}

interface PatternsOutput {
  time_range: string
  total_events: number
  events_by_name: Record<string, number>
  by_function: Record<string, FunctionStats>
  top_events: EventPattern[]
}

/**
 * Command: skill inngest patterns
 * Aggregate event analysis
 */
export async function patterns(
  ctx: CommandContext,
  options: {
    after?: string
    json?: boolean
    dev?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const client = new InngestClient({ dev: options.dev })

    // Fetch events
    const params: { limit: number; received_after?: string } = { limit: 100 }
    if (options.after) {
      params.received_after = parseTimeArg(options.after)
    }

    const events = outputJson
      ? await client.listEvents(params)
      : await withSpinner('Fetching events...', () => client.listEvents(params))

    // Aggregate by event name
    const byName: Record<string, number> = {}
    const byFunction: Record<string, { success: number; failed: number }> = {}

    for (const event of events.data) {
      byName[event.name] = (byName[event.name] || 0) + 1

      // Track function success/failure
      if (event.name === 'inngest/function.finished') {
        const data = event.data as FunctionFinishedData | null
        const functionId = data?.function_id
        if (!functionId) continue

        if (!byFunction[functionId]) {
          byFunction[functionId] = { success: 0, failed: 0 }
        }

        if (data.error || data._inngest?.status === 'Failed') {
          byFunction[functionId].failed++
        } else {
          byFunction[functionId].success++
        }
      }
    }

    // Calculate frequencies and success rates
    const timeRangeHours = options.after ? parseTimeWindow(options.after) : 24
    const topEvents: EventPattern[] = Object.entries(byName)
      .map(([name, count]) => ({
        name,
        count,
        frequency_per_hour: count / timeRangeHours,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const functionStats: Record<string, FunctionStats> = {}
    for (const [functionId, stats] of Object.entries(byFunction)) {
      const total = stats.success + stats.failed
      functionStats[functionId] = {
        success: stats.success,
        failed: stats.failed,
        success_rate: total > 0 ? stats.success / total : 0,
      }
    }

    const output: PatternsOutput = {
      time_range: options.after || '24h',
      total_events: events.data.length,
      events_by_name: byName,
      by_function: functionStats,
      top_events: topEvents,
    }

    if (outputJson) {
      ctx.output.data(output)
    } else {
      // Text output with tables
      const lines: string[] = []

      lines.push('\nEvent Patterns\n')
      lines.push(`Time range: ${output.time_range}`)
      lines.push(`Total events: ${output.total_events}\n`)

      // Top events table
      lines.push('Top Events:')
      lines.push(
        '┌────────────────────────────────────────┬───────┬──────────────┐'
      )
      lines.push(
        '│ Event Name                             │ Count │ Per Hour     │'
      )
      lines.push(
        '├────────────────────────────────────────┼───────┼──────────────┤'
      )
      for (const event of topEvents) {
        const name = event.name.padEnd(38).slice(0, 38)
        const count = String(event.count).padStart(5)
        const freq = event.frequency_per_hour.toFixed(2).padStart(12)
        lines.push(`│ ${name} │ ${count} │ ${freq} │`)
      }
      lines.push(
        '└────────────────────────────────────────┴───────┴──────────────┘\n'
      )

      // Function stats table
      if (Object.keys(functionStats).length > 0) {
        lines.push('Function Stats:')
        lines.push(
          '┌────────────────────────────────────────┬─────────┬────────┬─────────────┐'
        )
        lines.push(
          '│ Function                               │ Success │ Failed │ Success %   │'
        )
        lines.push(
          '├────────────────────────────────────────┼─────────┼────────┼─────────────┤'
        )
        for (const [functionId, stats] of Object.entries(functionStats)) {
          const name = functionId.padEnd(38).slice(0, 38)
          const success = String(stats.success).padStart(7)
          const failed = String(stats.failed).padStart(6)
          const rate = `${(stats.success_rate * 100).toFixed(1)}%`.padStart(11)
          lines.push(`│ ${name} │ ${success} │ ${failed} │ ${rate} │`)
        }
        lines.push(
          '└────────────────────────────────────────┴─────────┴────────┴─────────────┘\n'
        )
      }

      lines.push(
        'Use `skill inngest failures` for detailed failure analysis.\n'
      )

      ctx.output.data(lines.join('\n'))
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to analyze Inngest patterns.',
            suggestion: 'Verify INNGEST_SIGNING_KEY and time window.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Parse time window string to hours
 */
function parseTimeWindow(input: string): number {
  const match = input.match(/^(\d+)([hmd])$/)
  if (!match) return 24

  const [, num, unit] = match
  const value = Number.parseInt(num ?? '24', 10)

  switch (unit) {
    case 'h':
      return value
    case 'd':
      return value * 24
    case 'm':
      return value / 60
    default:
      return 24
  }
}

/**
 * Register patterns command
 */
export function registerPatternsCommand(inngest: Command): void {
  inngest
    .command('patterns')
    .description(
      'Aggregate event analysis (event distribution, function success rates)'
    )
    .option('--after <time>', 'Time window (e.g., "2h", "1d")', '24h')
    .option('--json', 'Output as JSON')
    .option('--dev', 'Use dev server')
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
      await patterns(ctx, options)
    })
}
