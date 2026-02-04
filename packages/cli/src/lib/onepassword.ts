import { execSync, spawn } from 'node:child_process'

// 1Password coordinates for the egghead team vault
export const OP_ACCOUNT = 'egghead.1password.com'
export const OP_VAULT_ID = 'u3ujzar6l3nahlahsuzfvg7vcq'
export const OP_AGE_KEY_ITEM_ID = 'lxndka3exn475vqdiqq5heg2wm'
export const OP_SERVICE_ACCOUNT_TOKEN_ID = '3e4ip354ps3mhq2wwt6vmtm2zu'

export const OP_AGE_KEY_LINK = `https://start.1password.com/open/i?a=GCTJE4MRGFHKRAYXCEXKZKCEFU&v=${OP_VAULT_ID}&i=${OP_AGE_KEY_ITEM_ID}&h=${OP_ACCOUNT}`

/**
 * Check if the `op` CLI is installed and available
 */
export function isOpCliAvailable(): boolean {
  try {
    execSync('which op', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if user is signed in to the egghead 1Password account
 */
export function isOpSignedIn(): boolean {
  try {
    execSync(`op account get --account ${OP_ACCOUNT}`, {
      stdio: 'pipe',
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Fetch a field from a 1Password item in the egghead vault
 */
export function fetchFromOp(itemId: string, field: string): string | null {
  try {
    const result = execSync(
      `op item get ${itemId} --vault ${OP_VAULT_ID} --account ${OP_ACCOUNT} --fields ${field} --reveal`,
      { stdio: 'pipe', timeout: 15000 }
    )
    const value = result.toString().trim()
    return value || null
  } catch {
    return null
  }
}

export function getOpInstallInstructions(): string {
  switch (process.platform) {
    case 'darwin':
      return 'brew install 1password-cli'
    case 'linux':
      return 'https://developer.1password.com/docs/cli/get-started/#install'
    default:
      return 'https://developer.1password.com/docs/cli/get-started/#install'
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
  if (!isOpCliAvailable()) {
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
  if (!isOpCliAvailable()) {
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
