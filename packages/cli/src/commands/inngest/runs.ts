import { confirm } from '@inquirer/prompts'
import { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { withSpinner } from '../../core/spinner'
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
export async function runCommand(
  ctx: CommandContext,
  id: string,
  options: RunCommandOptions
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    // Auto-detect dev server if --dev not explicitly set
    const isDev = options.dev ?? (await detectDevServer())
    const client = new InngestClient({ dev: isDev })

    const run = await withSpinner('Loading run...', () => client.getRun(id))

    if (outputJson) {
      ctx.output.data(run)
    } else {
      ctx.output.data(formatRun(run))

      if (options.jobs) {
        // TODO: Implement job queue position display
        ctx.output.data('\n(Job queue position tracking not yet implemented)')
      }
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to fetch Inngest run.',
            suggestion: 'Verify run ID and INNGEST_SIGNING_KEY.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Cancel a running function
 */
export async function cancelCommand(
  ctx: CommandContext,
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
        ctx.output.data('Cancelled.')
        return
      }
    }

    const client = new InngestClient({ dev: isDev })
    await client.cancelRun(id)

    ctx.output.data(`✅ Run ${id} cancelled successfully`)
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to cancel Inngest run.',
            suggestion: 'Verify run ID and INNGEST_SIGNING_KEY.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
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
    .action(
      async (id: string, options: RunCommandOptions, command: Command) => {
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
        await runCommand(ctx, id, options)
      }
    )

  inngest
    .command('cancel')
    .description('Cancel a running function')
    .argument('<id>', 'Run ID')
    .option('--force', 'Skip confirmation')
    .option('--dev', 'Use local dev server (localhost:8288)')
    .action(
      async (id: string, options: CancelCommandOptions, command: Command) => {
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
        await cancelCommand(ctx, id, options)
      }
    )
}
