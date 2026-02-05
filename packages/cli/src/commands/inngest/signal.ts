import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { InngestClient } from './client'

/**
 * Send a signal to resume a waiting Inngest function
 *
 * Signals are used with step.waitForSignal() to pause execution until
 * an external event occurs (e.g., HITL approval).
 *
 * Usage:
 *   skill inngest signal "approval:draft_abc123" --data '{"approved": true}'
 *   skill inngest signal "approval:draft_abc123" --data-file ./approval.json
 *   skill inngest signal "payment:confirmed" --dev
 *
 * @param signal - Signal name (must match step.waitForSignal)
 * @param options - Command options
 */
export async function signalCommand(
  ctx: CommandContext,
  signal: string,
  options: {
    data?: string
    dataFile?: string
    dev?: boolean
    json?: boolean
  }
): Promise<void> {
  const { data: dataString, dataFile, dev = false } = options
  const outputJson = options.json === true || ctx.format === 'json'

  // Parse signal data
  let data: unknown = null

  if (dataFile) {
    try {
      const fileContent = readFileSync(dataFile, 'utf-8')
      data = JSON.parse(fileContent)
    } catch (err) {
      const cliError = new CLIError({
        userMessage:
          err instanceof Error
            ? `Failed to read data file: ${err.message}`
            : 'Failed to read data file.',
        suggestion: 'Verify the file path and ensure it contains valid JSON.',
        cause: err,
      })
      ctx.output.error(formatError(cliError))
      process.exitCode = cliError.exitCode
      return
    }
  } else if (dataString) {
    try {
      data = JSON.parse(dataString)
    } catch (err) {
      const cliError = new CLIError({
        userMessage:
          err instanceof Error
            ? `Invalid JSON in --data: ${err.message}`
            : 'Invalid JSON in --data.',
        suggestion: 'Provide valid JSON, e.g. \'{"approved": true}\'.',
        cause: err,
      })
      ctx.output.error(formatError(cliError))
      process.exitCode = cliError.exitCode
      return
    }
  }

  // Send signal
  try {
    const client = new InngestClient({ dev })
    const response = await client.sendSignal(signal, data)

    if (outputJson) {
      ctx.output.data({
        success: true,
        signal,
        data,
        response,
      })
    } else {
      ctx.output.data(`Signal sent: ${signal}`)
      if (response.run_id) {
        ctx.output.data(`Run ID: ${response.run_id}`)
      }
      if (response.message) {
        ctx.output.data(`Message: ${response.message}`)
      }
    }
  } catch (err) {
    const cliError = new CLIError({
      userMessage:
        err instanceof Error
          ? err.message
          : 'Failed to send signal to Inngest API.',
      suggestion: 'Verify INNGEST_SIGNING_KEY and the signal name.',
      cause: err,
    })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Register the signal command with Commander
 */
export function registerSignalCommand(inngest: Command): void {
  inngest
    .command('signal')
    .description('Send a signal to resume a waiting function')
    .argument('<signal>', 'Signal name (e.g., "approval:draft_abc123")')
    .option(
      '-d, --data <json>',
      'Signal data as JSON string (e.g., \'{"approved": true}\')'
    )
    .option(
      '-f, --data-file <path>',
      'Path to JSON file containing signal data'
    )
    .option('--dev', 'Target local dev server (localhost:8288)')
    .option('--json', 'Output result as JSON (machine-readable)')
    .action(async (signal: string, options, command) => {
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
      await signalCommand(ctx, signal, options)
    })
}
