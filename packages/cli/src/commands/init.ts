import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

/**
 * Check if stdin is a TTY (interactive terminal)
 */
function isInteractive(): boolean {
  return process.stdin.isTTY === true
}

/**
 * Prompt user for app name interactively
 */
async function promptForName(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
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

/**
 * Initialize command for registering new app with webhook secret
 *
 * Agent-friendly: requires name argument in non-interactive mode.
 * Use --json for machine-readable output.
 *
 * @param name - Name for the app (required in non-interactive mode)
 * @param options - Command options
 */
export async function init(
  name: string | undefined,
  options: InitOptions = {}
): Promise<void> {
  const { json = false } = options

  // In non-interactive mode, name is required
  if (!name && !isInteractive()) {
    const result: InitResult = {
      success: false,
      error:
        'App name is required in non-interactive mode. Usage: skill init <name>',
    }
    if (json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.error(`Error: ${result.error}`)
    }
    process.exit(1)
  }

  const appName = name || (await promptForName())

  if (!appName || appName.trim() === '') {
    const result: InitResult = {
      success: false,
      error: 'App name cannot be empty',
    }
    if (json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.error(`Error: ${result.error}`)
    }
    process.exit(1)
  }

  const webhookSecret = randomBytes(32).toString('hex')

  // TODO: Save to DB when database connection is configured
  // For now, output the values for manual configuration

  const result: InitResult = {
    success: true,
    appName,
    webhookSecret,
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`\n✓ App "${appName}" initialized\n`)
    console.log(`Webhook URL: https://your-domain.com/api/webhooks/front`)
    console.log(`Webhook Secret: ${webhookSecret}`)
    console.log(`\nAdd to your .env:`)
    console.log(`FRONT_WEBHOOK_SECRET=${webhookSecret}`)
  }

  process.exit(0)
}
