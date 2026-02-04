import { readFileSync } from 'node:fs'
import { Command } from 'commander'
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
async function signalCommand(
  signal: string,
  options: {
    data?: string
    dataFile?: string
    dev?: boolean
    json?: boolean
  }
): Promise<void> {
  const { data: dataString, dataFile, dev = false, json = false } = options

  // Parse signal data
  let data: unknown = null

  if (dataFile) {
    try {
      const fileContent = readFileSync(dataFile, 'utf-8')
      data = JSON.parse(fileContent)
    } catch (err) {
      const error = {
        success: false,
        error:
          err instanceof Error
            ? `Failed to read data file: ${err.message}`
            : 'Failed to read data file',
      }
      if (json) {
        console.log(JSON.stringify(error, null, 2))
      } else {
        console.error(`Error: ${error.error}`)
      }
      process.exit(1)
    }
  } else if (dataString) {
    try {
      data = JSON.parse(dataString)
    } catch (err) {
      const error = {
        success: false,
        error:
          err instanceof Error
            ? `Invalid JSON in --data: ${err.message}`
            : 'Invalid JSON in --data',
      }
      if (json) {
        console.log(JSON.stringify(error, null, 2))
      } else {
        console.error(`Error: ${error.error}`)
      }
      process.exit(1)
    }
  }

  // Send signal
  try {
    const client = new InngestClient({ dev })
    const response = await client.sendSignal(signal, data)

    if (json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            signal,
            data,
            response,
          },
          null,
          2
        )
      )
    } else {
      console.log(`Signal sent: ${signal}`)
      if (response.run_id) {
        console.log(`Run ID: ${response.run_id}`)
      }
      if (response.message) {
        console.log(`Message: ${response.message}`)
      }
    }
  } catch (err) {
    const error = {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to send signal to Inngest API',
    }
    if (json) {
      console.log(JSON.stringify(error, null, 2))
    } else {
      console.error(`Error: ${error.error}`)
    }
    process.exit(1)
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
    .action(signalCommand)
}
