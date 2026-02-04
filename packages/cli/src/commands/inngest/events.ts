import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { type Event, InngestClient, type Run, parseTimeArg } from './client.js'

/**
 * Format a timestamp to human-readable format
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Pad string to fixed width
 */
function pad(str: string, width: number): string {
  return str.padEnd(width).slice(0, width)
}

/**
 * Print events as a table
 */
function printEventsTable(ctx: CommandContext, events: Event[]): void {
  if (events.length === 0) {
    ctx.output.data('No events found.')
    return
  }

  ctx.output.data(
    '\n' + pad('ID', 24) + ' ' + pad('NAME', 40) + ' ' + pad('RECEIVED', 20)
  )
  ctx.output.data('-'.repeat(86))

  for (const event of events) {
    ctx.output.data(
      pad(event.internal_id, 24) +
        ' ' +
        pad(event.name, 40) +
        ' ' +
        pad(formatTimestamp(event.received_at), 20)
    )
  }

  ctx.output.data('')
}

/**
 * Print runs as a table
 */
function printRunsTable(ctx: CommandContext, runs: Run[]): void {
  if (runs.length === 0) {
    ctx.output.data('No runs triggered by this event.')
    return
  }

  ctx.output.data(
    '\n' +
      pad('RUN ID', 30) +
      ' ' +
      pad('FUNCTION', 30) +
      ' ' +
      pad('STATUS', 12) +
      ' ' +
      pad('STARTED', 20)
  )
  ctx.output.data('-'.repeat(94))

  for (const run of runs) {
    ctx.output.data(
      pad(run.run_id, 30) +
        ' ' +
        pad(run.function_id, 30) +
        ' ' +
        pad(run.status, 12) +
        ' ' +
        pad(formatTimestamp(run.run_started_at), 20)
    )
  }

  ctx.output.data('')
}

/**
 * Command: skill inngest events
 * List recent events
 */
export async function listEvents(
  ctx: CommandContext,
  options: {
    name?: string
    after?: string
    limit?: string
    json?: boolean
    dev?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const client = new InngestClient({ dev: options.dev })

    const params: {
      name?: string
      received_after?: string
      limit?: number
    } = {}

    if (options.name) {
      params.name = options.name
    }

    if (options.after) {
      params.received_after = parseTimeArg(options.after)
    }

    const limit = options.limit ? parseInt(options.limit, 10) : 20
    if (limit < 1 || limit > 100) {
      throw new CLIError({
        userMessage: '--limit must be between 1 and 100.',
        suggestion: 'Choose a value between 1 and 100 (default: 20).',
      })
    }
    params.limit = limit

    const response = await client.listEvents(params)

    if (outputJson) {
      ctx.output.data(response.data)
    } else {
      printEventsTable(ctx, response.data)
      if (response.cursor) {
        ctx.output.data('More events available. Use pagination for full list.')
      }
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list Inngest events.',
            suggestion: 'Verify INNGEST_SIGNING_KEY and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill inngest event <id>
 * Get event details and runs it triggered
 */
export async function getEvent(
  ctx: CommandContext,
  id: string,
  options: { json?: boolean; dev?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const client = new InngestClient({ dev: options.dev })

    const [event, runs] = await Promise.all([
      client.getEvent(id),
      client.getEventRuns(id),
    ])

    if (outputJson) {
      ctx.output.data({ event, runs })
    } else {
      if (!event) {
        ctx.output.data(`\n⚠️  Event ${id} data unavailable (may be archived)`)
      } else {
        ctx.output.data('\n📋 Event Details:')
        ctx.output.data(`   ID:       ${event.internal_id}`)
        ctx.output.data(`   Name:     ${event.name}`)
        ctx.output.data(`   Received: ${formatTimestamp(event.received_at)}`)
        ctx.output.data(
          `   Data:     ${event.data ? JSON.stringify(event.data, null, 2) : '(null)'}`
        )
      }

      if (runs.length > 0) {
        ctx.output.data('\n🔄 Triggered Runs:')
        printRunsTable(ctx, runs)
      } else {
        ctx.output.data('\n🔄 Triggered Runs: None')
      }
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to fetch Inngest event.',
            suggestion: 'Verify event ID and INNGEST_SIGNING_KEY.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill inngest replay <id>
 * Replay an event by re-emitting with the same name and data
 */
export async function replayEvent(
  ctx: CommandContext,
  id: string,
  options: { json?: boolean; dev?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const client = new InngestClient({ dev: options.dev })

    if (!outputJson) {
      ctx.output.data(`\n🔄 Replaying event ${id}...`)
    }

    const { newEventId, event } = await client.replayEvent(id)

    if (outputJson) {
      ctx.output.data({
        success: true,
        originalEventId: id,
        newEventId,
        eventName: event.name,
        eventData: event.data,
      })
    } else {
      ctx.output.data(`\n✅ Event replayed successfully!`)
      ctx.output.data(`   Original ID: ${id}`)
      ctx.output.data(`   New ID:      ${newEventId}`)
      ctx.output.data(`   Name:        ${event.name}`)
      ctx.output.data(`   Data:        ${JSON.stringify(event.data, null, 2)}`)
      ctx.output.data(
        `\nUse 'skill inngest event ${newEventId}' to check triggered runs.`
      )
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to replay Inngest event.',
            suggestion: 'Verify event ID and INNGEST_SIGNING_KEY.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Register events commands with Commander
 */
export function registerEventsCommands(inngest: Command): void {
  inngest
    .command('events')
    .description('List recent events')
    .option('--name <name>', 'Filter by event name')
    .option('--after <time>', 'Events after time (e.g., "2h", "30m", "1d")')
    .option('--limit <number>', 'Max events to return (1-100, default: 20)')
    .option('--json', 'Output as JSON')
    .option('--dev', 'Use dev server (localhost:8288)')
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
      await listEvents(ctx, options)
    })

  inngest
    .command('event')
    .description('Get event details and triggered runs')
    .argument('<id>', 'Event internal ID')
    .option('--json', 'Output as JSON')
    .option('--dev', 'Use dev server (localhost:8288)')
    .action(async (id, options, command) => {
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
      await getEvent(ctx, id, options)
    })

  inngest
    .command('replay')
    .description('Replay an event (re-emit with same name and data)')
    .argument('<id>', 'Event internal ID to replay')
    .option('--json', 'Output as JSON')
    .option('--dev', 'Use dev server (localhost:8288)')
    .action(async (id, options, command) => {
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
      await replayEvent(ctx, id, options)
    })
}
