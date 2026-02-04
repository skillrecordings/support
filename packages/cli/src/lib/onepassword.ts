import { execSync, spawn } from 'node:child_process'

/**
 * 1Password Service Account integration for headless Linux environments
 *
 * Authenticates using OP_SERVICE_ACCOUNT_TOKEN environment variable.
 * Provides functions to read secrets and execute commands with injected secrets.
 */

/**
 * Check if the `op` CLI is installed and available
 */
export async function isOpAvailable(): Promise<boolean> {
  try {
    execSync('which op', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if OP_SERVICE_ACCOUNT_TOKEN is configured
 */
export function isServiceAccountConfigured(): boolean {
  return Boolean(process.env.OP_SERVICE_ACCOUNT_TOKEN)
}

/**
 * Read a secret from 1Password using a secret reference
 *
 * @param reference - Secret reference in format: op://vault/item/field
 * @returns The secret value
 * @throws Error if op CLI is not available, token is not configured, or read fails
 *
 * @example
 * const apiKey = await readSecret('op://Private/Stripe/api_key')
 */
export async function readSecret(reference: string): Promise<string> {
  if (!(await isOpAvailable())) {
    throw new Error(
      '1Password CLI not installed. Install from https://developer.1password.com/docs/cli/get-started/'
    )
  }

  if (!isServiceAccountConfigured()) {
    throw new Error(
      'OP_SERVICE_ACCOUNT_TOKEN not set. Configure a service account token: https://developer.1password.com/docs/service-accounts/'
    )
  }

  if (!reference.startsWith('op://')) {
    throw new Error(
      `Invalid secret reference format: ${reference}. Expected format: op://vault/item/field`
    )
  }

  try {
    const output = execSync(`op read "${reference}"`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return output.trim()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    throw new Error(`Failed to read secret from 1Password: ${message}`)
  }
}

/**
 * Execute a command with secrets injected via `op run`
 *
 * The command runs with secrets referenced in the environment automatically resolved.
 * Use this when you need to run commands that require secrets in their environment.
 *
 * @param cmd - Command and arguments to execute
 * @returns stdout and stderr from the command
 * @throws Error if op CLI is not available, token is not configured, or execution fails
 *
 * @example
 * // Environment has STRIPE_KEY="op://Private/Stripe/api_key"
 * const { stdout } = await runWithSecrets(['node', 'script.js'])
 * // script.js will see STRIPE_KEY with the actual secret value
 */
export async function runWithSecrets(
  cmd: string[]
): Promise<{ stdout: string; stderr: string }> {
  if (!(await isOpAvailable())) {
    throw new Error(
      '1Password CLI not installed. Install from https://developer.1password.com/docs/cli/get-started/'
    )
  }

  if (!isServiceAccountConfigured()) {
    throw new Error(
      'OP_SERVICE_ACCOUNT_TOKEN not set. Configure a service account token: https://developer.1password.com/docs/service-accounts/'
    )
  }

  if (!cmd.length) {
    throw new Error('Command array cannot be empty')
  }

  return new Promise((resolve, reject) => {
    const child = spawn('op', ['run', '--', ...cmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(
          new Error(
            `Command failed with exit code ${code}${stderr ? `: ${stderr}` : ''}`
          )
        )
      }
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn command: ${err.message}`))
    })
  })
}
