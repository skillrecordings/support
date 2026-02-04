import { confirm } from '@inquirer/prompts'
import { Command } from 'commander'
import { InngestClient, detectDevServer } from './client'

interface RunCommandOptions {
  jobs?: boolean
  json?: boolean
  dev?: boolean
}

interface CancelCommandOptions {
  force?: boolean
  dev?: boolean
}

/**
 * Format a run for human-readable display
 */
function formatRun(run: {
  run_id: string
  function_id: string
  status: string
  run_started_at: string
  ended_at: string | null
  output: unknown
  event_id: string | null
}) {
  const startedAt = new Date(run.run_started_at).toLocaleString()
  const endedAt = run.ended_at ? new Date(run.ended_at).toLocaleString() : 'N/A'

  return `
Run Details:
  Run ID:      ${run.run_id}
  Function:    ${run.function_id}
  Status:      ${run.status}
  Started:     ${startedAt}
  Ended:       ${endedAt}
  Event ID:    ${run.event_id || 'N/A'}

Output:
${run.output ? JSON.stringify(run.output, null, 2) : '(no output)'}
`.trim()
}

/**
 * Get details for a specific function run
 */
async function runCommand(
  id: string,
  options: RunCommandOptions
): Promise<void> {
  try {
    // Auto-detect dev server if --dev not explicitly set
    const isDev = options.dev ?? (await detectDevServer())
    const client = new InngestClient({ dev: isDev })

    const run = await client.getRun(id)

    if (options.json) {
      console.log(JSON.stringify(run, null, 2))
    } else {
      console.log(formatRun(run))

      if (options.jobs) {
        // TODO: Implement job queue position display
        console.log('\n(Job queue position tracking not yet implemented)')
      }
    }

    process.exit(0)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options.json) {
      console.error(JSON.stringify({ error: message }))
    } else {
      console.error(`Error: ${message}`)
    }
    process.exit(1)
  }
}

/**
 * Cancel a running function
 */
async function cancelCommand(
  id: string,
  options: CancelCommandOptions
): Promise<void> {
  try {
    // Auto-detect dev server if --dev not explicitly set
    const isDev = options.dev ?? (await detectDevServer())

    // Confirm unless --force
    if (!options.force) {
      const confirmed = await confirm({
        message: `Cancel run ${id}?`,
        default: false,
      })

      if (!confirmed) {
        console.log('Cancelled.')
        process.exit(0)
      }
    }

    const client = new InngestClient({ dev: isDev })
    await client.cancelRun(id)

    console.log(`✅ Run ${id} cancelled successfully`)
    process.exit(0)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Error: ${message}`)
    process.exit(1)
  }
}

/**
 * Register run and cancel commands with the inngest command group
 */
export function registerRunsCommands(inngest: Command): void {
  inngest
    .command('run')
    .description('Get function run details')
    .argument('<id>', 'Run ID')
    .option('--jobs', 'Show job queue position (stub)')
    .option('--json', 'Output as JSON')
    .option('--dev', 'Use local dev server (localhost:8288)')
    .action(runCommand)

  inngest
    .command('cancel')
    .description('Cancel a running function')
    .argument('<id>', 'Run ID')
    .option('--force', 'Skip confirmation')
    .option('--dev', 'Use local dev server (localhost:8288)')
    .action(cancelCommand)
}
