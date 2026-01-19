/**
 * Inngest investigation/spelunking commands
 *
 * Optimized for agent consumption - JSON output, aggregate stats, anomaly detection.
 */

import type { Command } from 'commander'
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
async function inspect(
  eventId: string,
  options: { json?: boolean; dev?: boolean }
): Promise<void> {
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

    if (options.json) {
      console.log(JSON.stringify(output, null, 2))
    } else {
      console.log('\n' + JSON.stringify(output, null, 2))
    }
  } catch (error) {
    const err = { error: error instanceof Error ? error.message : 'Unknown' }
    console.error(options.json ? JSON.stringify(err) : `Error: ${err.error}`)
    process.exit(1)
  }
}

/**
 * Command: skill inngest failures
 * Aggregate failure analysis
 */
async function failures(options: {
  after?: string
  limit?: string
  json?: boolean
  dev?: boolean
}): Promise<void> {
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

    console.log(JSON.stringify(output, null, 2))
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown',
      })
    )
    process.exit(1)
  }
}

/**
 * Command: skill inngest stats
 * Aggregate statistics optimized for pattern detection
 */
async function stats(options: {
  after?: string
  json?: boolean
  dev?: boolean
}): Promise<void> {
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

    console.log(JSON.stringify(output, null, 2))
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown',
      })
    )
    process.exit(1)
  }
}

/**
 * Command: skill inngest trace <run-id>
 * Full trace of a workflow run
 */
async function trace(
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

    console.log(JSON.stringify(output, null, 2))
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown',
      })
    )
    process.exit(1)
  }
}

/**
 * Command: skill inngest search
 * Search event data for patterns
 */
async function search(
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

    console.log(JSON.stringify(output, null, 2))
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown',
      })
    )
    process.exit(1)
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
    .action(inspect)

  inngest
    .command('failures')
    .description('Aggregate failure analysis')
    .option('--after <time>', 'Time window (e.g., "2h", "1d")')
    .option('--limit <n>', 'Max failures (default: 20)')
    .option('--json', 'Output as JSON (default)')
    .option('--dev', 'Use dev server')
    .action(failures)

  inngest
    .command('stats')
    .description('Aggregate statistics with anomaly detection')
    .option('--after <time>', 'Time window (e.g., "2h", "1d")')
    .option('--json', 'Output as JSON (default)')
    .option('--dev', 'Use dev server')
    .action(stats)

  inngest
    .command('trace')
    .description('Full workflow trace for a run')
    .argument('<run-id>', 'Run ID')
    .option('--json', 'Output as JSON (default)')
    .option('--dev', 'Use dev server')
    .action(trace)

  inngest
    .command('search')
    .description('Search event data for patterns')
    .argument('<pattern>', 'Regex pattern to search')
    .option('--after <time>', 'Time window (e.g., "2h", "1d")')
    .option('--field <name>', 'Search specific field only')
    .option('--limit <n>', 'Max events to search (default: 50)')
    .option('--dev', 'Use dev server')
    .action(search)
}
