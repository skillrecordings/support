import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { type CommandContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

/**
 * Check if stdin is a TTY (interactive terminal)
 */
function isInteractive(ctx: CommandContext): boolean {
  return ctx.stdin.isTTY === true
}

/**
 * Prompt user for app name interactively
 */
async function promptForName(ctx: CommandContext): Promise<string> {
  const rl = createInterface({
    input: ctx.stdin,
    output: ctx.stdout,
  })

  return new Promise((resolve) => {
    rl.question('App name: ', (answer) => {
      rl.close()
      resolve(answer.trim() || 'my-app')
    })
  })
}

export interface InitOptions {
  json?: boolean
}

export interface InitResult {
  success: boolean
  appName?: string
  webhookSecret?: string
  error?: string
}

const handleInitError = (
  ctx: CommandContext,
  error: unknown,
  message: string,
  suggestion = 'Provide a valid app name and retry.'
): void => {
  const cliError =
    error instanceof CLIError
      ? error
      : new CLIError({
          userMessage: message,
          suggestion,
          cause: error,
        })

  ctx.output.error(formatError(cliError))
  process.exitCode = cliError.exitCode
}

/**
 * Initialize command for registering new app with webhook secret
 *
 * Agent-friendly: requires name argument in non-interactive mode.
 * Use --json for machine-readable output.
 *
 * @param ctx - Command context
 * @param name - Name for the app (required in non-interactive mode)
 * @param options - Command options
 */
export async function init(
  ctx: CommandContext,
  name: string | undefined,
  options: InitOptions = {}
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    // In non-interactive mode, name is required
    if (!name && !isInteractive(ctx)) {
      throw new CLIError({
        userMessage:
          'App name is required in non-interactive mode. Usage: skill init <name>.',
        suggestion: 'Provide the app name argument or run interactively.',
      })
    }

    const appName = name || (await promptForName(ctx))

    if (!appName || appName.trim() === '') {
      throw new CLIError({
        userMessage: 'App name cannot be empty.',
        suggestion: 'Provide a non-empty app name.',
      })
    }

    const webhookSecret = randomBytes(32).toString('hex')

    // TODO: Save to DB when database connection is configured
    // For now, output the values for manual configuration

    const result: InitResult = {
      success: true,
      appName,
      webhookSecret,
    }

    if (outputJson) {
      ctx.output.data(result)
      return
    }

    ctx.output.data(`\n✓ App "${appName}" initialized\n`)
    ctx.output.data(`Webhook URL: https://your-domain.com/api/webhooks/front`)
    ctx.output.data(`Webhook Secret: ${webhookSecret}`)
    ctx.output.data(`\nAdd to your .env:`)
    ctx.output.data(`FRONT_WEBHOOK_SECRET=${webhookSecret}`)
  } catch (error) {
    handleInitError(ctx, error, 'Failed to initialize app.')
  }
}
