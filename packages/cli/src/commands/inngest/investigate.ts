/**
 * Inngest investigation/spelunking commands
 *
 * Optimized for agent consumption - JSON output, aggregate stats, anomaly detection.
 */

import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { type Event, InngestClient, parseTimeArg } from './client.js'

interface FunctionFinishedData {
  _inngest?: { status?: string }
  function_id?: string
  run_id?: string
  result?: Record<string, unknown>
  error?: { message?: string; name?: string }
  event?: { name?: string; data?: Record<string, unknown> }
}

/**
 * Command: skill inngest inspect <event-id>
 * Deep dive into an event - returns structured data for agent analysis
 */
export async function inspect(
  ctx: CommandContext,
  eventId: string,
  options: { json?: boolean; dev?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const client = new InngestClient({ dev: options.dev })

    const [event, runs] = await Promise.all([
      client.getEvent(eventId),
      client.getEventRuns(eventId),
    ])

    // Find function.finished events for runs
    const finishedEvents = await client.listEvents({
      name: 'inngest/function.finished',
      limit: 50,
    })

    const runResults = runs.map((run) => {
      const finished = finishedEvents.data.find((e) => {
        const data = e.data as FunctionFinishedData | null
        return data?.run_id === run.run_id
      })
      const data = finished?.data as FunctionFinishedData | null

      return {
        run_id: run.run_id,
        function_id: run.function_id,
        status: run.status,
        duration_ms: run.ended_at
          ? new Date(run.ended_at).getTime() -
            new Date(run.run_started_at).getTime()
          : null,
        result: data?.result || null,
        error: data?.error || null,
      }
    })

    const output = {
      event_id: eventId,
      event_name: event?.name || null,
      event_data: event?.data || null,
      received_at: event?.received_at || null,
      runs: runResults,
    }

    if (outputJson) {
      ctx.output.data(output)
    } else {
      ctx.output.data('\n' + JSON.stringify(output, null, 2))
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to inspect Inngest event.',
            suggestion: 'Verify event ID and INNGEST_SIGNING_KEY.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill inngest failures
 * Aggregate failure analysis
 */
export async function failures(
  ctx: CommandContext,
  options: {
    after?: string
    limit?: string
    json?: boolean
    dev?: boolean
  }
): Promise<void> {
  try {
    const client = new InngestClient({ dev: options.dev })
    const limit = options.limit ? parseInt(options.limit, 10) : 20

    const params: { limit: number; received_after?: string } = {
      limit: Math.min(limit * 3, 100),
    }
    if (options.after) {
      params.received_after = parseTimeArg(options.after)
    }

    const events = await client.listEvents({
      name: 'inngest/function.finished',
      ...params,
    })

    const failureList = events.data
      .filter((e) => {
        const data = e.data as FunctionFinishedData | null
        return data?.error || data?._inngest?.status === 'Failed'
      })
      .slice(0, limit)
      .map((e) => {
        const data = e.data as FunctionFinishedData
        return {
          run_id: data.run_id,
          function_id: data.function_id,
          error: data.error?.message || 'Unknown error',
          error_type: data.error?.name || null,
          timestamp: e.received_at,
          event_name: data.event?.name || null,
        }
      })

    // Group by error message
    const byError: Record<string, number> = {}
    for (const f of failureList) {
      byError[f.error] = (byError[f.error] || 0) + 1
    }

    const output = {
      total_failures: failureList.length,
      by_error: byError,
      failures: failureList,
    }

    ctx.output.data(output)
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to aggregate Inngest failures.',
            suggestion: 'Verify INNGEST_SIGNING_KEY and time window.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill inngest stats
 * Aggregate statistics optimized for pattern detection
 */
export async function stats(
  ctx: CommandContext,
  options: {
    after?: string
    json?: boolean
    dev?: boolean
  }
): Promise<void> {
  try {
    const client = new InngestClient({ dev: options.dev })

    const params: { limit: number; received_after?: string } = { limit: 100 }
    if (options.after) {
      params.received_after = parseTimeArg(options.after)
    }

    const events = await client.listEvents(params)

    // Aggregate by event name
    const byName: Record<string, number> = {}
    const outcomes = { completed: 0, failed: 0, skipped: 0, filtered: 0 }
    const classifications: Record<string, number> = {}
    const durations: number[] = []

    for (const event of events.data) {
      byName[event.name] = (byName[event.name] || 0) + 1

      if (event.name === 'inngest/function.finished') {
        const data = event.data as FunctionFinishedData | null
        const result = data?.result

        if (data?.error || data?._inngest?.status === 'Failed') {
          outcomes.failed++
        } else if (result?.skipped) {
          outcomes.skipped++
          const reason = (result.classification as Record<string, unknown>)
            ?.category as string
          if (reason)
            classifications[reason] = (classifications[reason] || 0) + 1
        } else if (result?.filtered) {
          outcomes.filtered++
        } else {
          outcomes.completed++
        }
      }
    }

    const output = {
      time_range: options.after || 'recent',
      total_events: events.data.length,
      events_by_type: byName,
      workflow_outcomes: outcomes,
      skip_reasons: classifications,
      anomalies: [] as string[],
    }

    // Detect anomalies
    const failRate =
      outcomes.failed /
      (outcomes.completed +
        outcomes.failed +
        outcomes.skipped +
        outcomes.filtered)
    if (failRate > 0.1) {
      output.anomalies.push(
        `High failure rate: ${(failRate * 100).toFixed(1)}%`
      )
    }
    if (outcomes.skipped > outcomes.completed) {
      output.anomalies.push('More skipped than completed workflows')
    }

    ctx.output.data(output)
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to compute Inngest stats.',
            suggestion: 'Verify INNGEST_SIGNING_KEY and time window.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill inngest trace <run-id>
 * Full trace of a workflow run
 */
export async function trace(
  ctx: CommandContext,
  runId: string,
  options: { json?: boolean; dev?: boolean }
): Promise<void> {
  try {
    const client = new InngestClient({ dev: options.dev })

    const run = await client.getRun(runId)

    // Find function.finished event
    const events = await client.listEvents({
      name: 'inngest/function.finished',
      limit: 50,
    })

    const finished = events.data.find((e) => {
      const data = e.data as FunctionFinishedData | null
      return data?.run_id === runId
    })

    const data = finished?.data as FunctionFinishedData | null

    const output = {
      run_id: run.run_id,
      function_id: run.function_id,
      status: run.status,
      started_at: run.run_started_at,
      ended_at: run.ended_at,
      duration_ms: run.ended_at
        ? new Date(run.ended_at).getTime() -
          new Date(run.run_started_at).getTime()
        : null,
      input: data?.event?.data || null,
      result: data?.result || null,
      error: data?.error || null,
    }

    ctx.output.data(output)
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to fetch Inngest trace.',
            suggestion: 'Verify run ID and INNGEST_SIGNING_KEY.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill inngest search
 * Search event data for patterns
 */
export async function search(
  ctx: CommandContext,
  pattern: string,
  options: { after?: string; field?: string; limit?: string; dev?: boolean }
): Promise<void> {
  try {
    const client = new InngestClient({ dev: options.dev })
    const limit = options.limit ? parseInt(options.limit, 10) : 50

    const params: { limit: number; received_after?: string } = { limit }
    if (options.after) {
      params.received_after = parseTimeArg(options.after)
    }

    const events = await client.listEvents(params)
    const regex = new RegExp(pattern, 'i')

    const matches = events.data.filter((e) => {
      if (!e.data) return false
      const searchIn = options.field
        ? JSON.stringify((e.data as Record<string, unknown>)[options.field])
        : JSON.stringify(e.data)
      return regex.test(searchIn)
    })

    const output = {
      pattern,
      field: options.field || 'all',
      total_searched: events.data.length,
      matches_found: matches.length,
      matches: matches.map((e) => ({
        event_id: e.internal_id,
        event_name: e.name,
        received_at: e.received_at,
        data: e.data,
      })),
    }

    ctx.output.data(output)
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to search Inngest events.',
            suggestion: 'Verify INNGEST_SIGNING_KEY and search pattern.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Register investigation commands
 */
export function registerInvestigateCommands(inngest: Command): void {
  inngest
    .command('inspect')
    .description('Deep dive into event with runs and results')
    .argument('<event-id>', 'Event internal ID')
    .option('--json', 'Output as JSON (default)')
    .option('--dev', 'Use dev server')
    .action(async (eventId, options, command) => {
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
      await inspect(ctx, eventId, options)
    })

  inngest
    .command('failures')
    .description('Aggregate failure analysis')
    .option('--after <time>', 'Time window (e.g., "2h", "1d")')
    .option('--limit <n>', 'Max failures (default: 20)')
    .option('--json', 'Output as JSON (default)')
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
      await failures(ctx, options)
    })

  inngest
    .command('stats')
    .description('Aggregate statistics with anomaly detection')
    .option('--after <time>', 'Time window (e.g., "2h", "1d")')
    .option('--json', 'Output as JSON (default)')
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
      await stats(ctx, options)
    })

  inngest
    .command('trace')
    .description('Full workflow trace for a run')
    .argument('<run-id>', 'Run ID')
    .option('--json', 'Output as JSON (default)')
    .option('--dev', 'Use dev server')
    .action(async (runId, options, command) => {
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
      await trace(ctx, runId, options)
    })

  inngest
    .command('search')
    .description('Search event data for patterns')
    .argument('<pattern>', 'Regex pattern to search')
    .option('--after <time>', 'Time window (e.g., "2h", "1d")')
    .option('--field <name>', 'Search specific field only')
    .option('--limit <n>', 'Max events to search (default: 50)')
    .option('--dev', 'Use dev server')
    .action(async (pattern, options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await search(ctx, pattern, options)
    })
}
