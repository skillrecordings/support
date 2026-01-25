import type { Command } from 'commander'
import { type Event, InngestClient, type Run, parseTimeArg } from './client.js'
import { registerInvestigateCommands } from './investigate.js'

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
function printEventsTable(events: Event[]): void {
  if (events.length === 0) {
    console.log('No events found.')
    return
  }

  console.log(
    '\n' + pad('ID', 24) + ' ' + pad('NAME', 40) + ' ' + pad('RECEIVED', 20)
  )
  console.log('-'.repeat(86))

  for (const event of events) {
    console.log(
      pad(event.internal_id, 24) +
        ' ' +
        pad(event.name, 40) +
        ' ' +
        pad(formatTimestamp(event.received_at), 20)
    )
  }

  console.log('')
}

/**
 * Print runs as a table
 */
function printRunsTable(runs: Run[]): void {
  if (runs.length === 0) {
    console.log('No runs triggered by this event.')
    return
  }

  console.log(
    '\n' +
      pad('RUN ID', 30) +
      ' ' +
      pad('FUNCTION', 30) +
      ' ' +
      pad('STATUS', 12) +
      ' ' +
      pad('STARTED', 20)
  )
  console.log('-'.repeat(94))

  for (const run of runs) {
    console.log(
      pad(run.run_id, 30) +
        ' ' +
        pad(run.function_id, 30) +
        ' ' +
        pad(run.status, 12) +
        ' ' +
        pad(formatTimestamp(run.run_started_at), 20)
    )
  }

  console.log('')
}

/**
 * Command: skill inngest events
 * List recent events
 */
async function listEvents(options: {
  name?: string
  after?: string
  limit?: string
  json?: boolean
  dev?: boolean
}): Promise<void> {
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
      console.error('Error: --limit must be between 1 and 100')
      process.exit(1)
    }
    params.limit = limit

    const response = await client.listEvents(params)

    if (options.json) {
      console.log(JSON.stringify(response.data, null, 2))
    } else {
      printEventsTable(response.data)
      if (response.cursor) {
        console.log('More events available. Use pagination for full list.')
      }
    }
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Command: skill inngest event <id>
 * Get event details and runs it triggered
 */
async function getEvent(
  id: string,
  options: { json?: boolean; dev?: boolean }
): Promise<void> {
  try {
    const client = new InngestClient({ dev: options.dev })

    const [event, runs] = await Promise.all([
      client.getEvent(id),
      client.getEventRuns(id),
    ])

    if (options.json) {
      console.log(JSON.stringify({ event, runs }, null, 2))
    } else {
      if (!event) {
        console.log(`\n⚠️  Event ${id} data unavailable (may be archived)`)
      } else {
        console.log('\n📋 Event Details:')
        console.log(`   ID:       ${event.internal_id}`)
        console.log(`   Name:     ${event.name}`)
        console.log(`   Received: ${formatTimestamp(event.received_at)}`)
        console.log(
          `   Data:     ${event.data ? JSON.stringify(event.data, null, 2) : '(null)'}`
        )
      }

      if (runs.length > 0) {
        console.log('\n🔄 Triggered Runs:')
        printRunsTable(runs)
      } else {
        console.log('\n🔄 Triggered Runs: None')
      }
    }
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Command: skill inngest replay <id>
 * Replay an event by re-emitting with the same name and data
 */
async function replayEvent(
  id: string,
  options: { json?: boolean; dev?: boolean }
): Promise<void> {
  try {
    const client = new InngestClient({ dev: options.dev })

    console.log(`\n🔄 Replaying event ${id}...`)

    const { newEventId, event } = await client.replayEvent(id)

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            originalEventId: id,
            newEventId,
            eventName: event.name,
            eventData: event.data,
          },
          null,
          2
        )
      )
    } else {
      console.log(`\n✅ Event replayed successfully!`)
      console.log(`   Original ID: ${id}`)
      console.log(`   New ID:      ${newEventId}`)
      console.log(`   Name:        ${event.name}`)
      console.log(`   Data:        ${JSON.stringify(event.data, null, 2)}`)
      console.log(
        `\nUse 'skill inngest event ${newEventId}' to check triggered runs.`
      )
    }
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        '❌ Replay failed:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Register events commands with Commander
 */
export function registerEventsCommands(program: Command): void {
  const inngest = program.command('inngest').description('Inngest API commands')

  inngest
    .command('events')
    .description('List recent events')
    .option('--name <name>', 'Filter by event name')
    .option('--after <time>', 'Events after time (e.g., "2h", "30m", "1d")')
    .option('--limit <number>', 'Max events to return (1-100, default: 20)')
    .option('--json', 'Output as JSON')
    .option('--dev', 'Use dev server (localhost:8288)')
    .action(listEvents)

  inngest
    .command('event')
    .description('Get event details and triggered runs')
    .argument('<id>', 'Event internal ID')
    .option('--json', 'Output as JSON')
    .option('--dev', 'Use dev server (localhost:8288)')
    .action(getEvent)

  inngest
    .command('replay')
    .description('Replay an event (re-emit with same name and data)')
    .argument('<id>', 'Event internal ID to replay')
    .option('--json', 'Output as JSON')
    .option('--dev', 'Use dev server (localhost:8288)')
    .action(replayEvent)

  // Register investigation/spelunking commands
  registerInvestigateCommands(inngest)
}
