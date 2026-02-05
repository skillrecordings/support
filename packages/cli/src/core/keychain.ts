import { execSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SERVICE_NAME = 'skill-cli'

type KeychainKey = 'op-service-account-token' | 'age-private-key'

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin'
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux'
}

/**
 * Check if keychain is supported (macOS or Linux with secret-tool)
 */
export function isKeychainSupported(): boolean {
  if (isMacOS()) return true
  if (isLinux()) {
    try {
      execSync('which secret-tool', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  return false
}

/**
 * Check if op CLI is installed and authenticated
 */
export function isOpCliAvailable(): boolean {
  try {
    execSync('op account list', { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Fetch a secret from 1Password using op CLI
 */
export function fetchFromOp(
  itemId: string,
  vaultId: string,
  field = 'credential'
): string | null {
  try {
    const result = execSync(
      `op item get "${itemId}" --vault "${vaultId}" --fields "label=${field}" --reveal`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000 }
    )
    return result.trim() || null
  } catch {
    return null
  }
}

/**
 * Store a secret in system keychain (macOS or Linux)
 */
export function storeInKeychain(key: KeychainKey, value: string): boolean {
  if (isMacOS()) {
    try {
      // Delete existing entry first (ignore errors)
      spawnSync(
        'security',
        ['delete-generic-password', '-a', key, '-s', SERVICE_NAME],
        { stdio: 'ignore' }
      )
      // Add new entry
      const result = spawnSync(
        'security',
        ['add-generic-password', '-a', key, '-s', SERVICE_NAME, '-w', value],
        { stdio: 'pipe' }
      )
      return result.status === 0
    } catch {
      return false
    }
  }

  if (isLinux()) {
    try {
      // secret-tool store --label="skill-cli: op-service-account-token" service skill-cli key op-service-account-token
      const result = spawnSync(
        'secret-tool',
        [
          'store',
          '--label',
          `${SERVICE_NAME}: ${key}`,
          'service',
          SERVICE_NAME,
          'key',
          key,
        ],
        { input: value, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      return result.status === 0
    } catch {
      return false
    }
  }

  return false
}

/**
 * Retrieve secret from system keychain (macOS or Linux)
 */
export function getFromKeychain(key: KeychainKey): string | null {
  if (isMacOS()) {
    try {
      const result = execSync(
        `security find-generic-password -a "${key}" -s "${SERVICE_NAME}" -w 2>/dev/null`,
        { encoding: 'utf8' }
      )
      return result.trim() || null
    } catch {
      return null
    }
  }

  if (isLinux()) {
    try {
      const result = execSync(
        `secret-tool lookup service "${SERVICE_NAME}" key "${key}" 2>/dev/null`,
        { encoding: 'utf8' }
      )
      return result.trim() || null
    } catch {
      return null
    }
  }

  return null
}

/**
 * Check if a key is in keychain
 */
export function isInKeychain(key: KeychainKey): boolean {
  return getFromKeychain(key) !== null
}

/**
 * Get the shell rc file path
 */
function getShellRcPath(): string {
  const shell = process.env.SHELL || '/bin/zsh'
  if (shell.includes('zsh')) {
    return join(homedir(), '.zshrc')
  }
  if (shell.includes('bash')) {
    // macOS prefers .bash_profile for login shells
    const bashProfile = join(homedir(), '.bash_profile')
    if (existsSync(bashProfile)) {
      return bashProfile
    }
    return join(homedir(), '.bashrc')
  }
  return join(homedir(), '.profile')
}

/**
 * The export lines we add to shell rc
 */
const SHELL_EXPORTS = `
# skill-cli keychain integration
export OP_SERVICE_ACCOUNT_TOKEN=$(security find-generic-password -a "op-service-account-token" -s "skill-cli" -w 2>/dev/null)
export SKILL_AGE_KEY=$(security find-generic-password -a "age-private-key" -s "skill-cli" -w 2>/dev/null)
`.trim()

const EXPORT_MARKER = '# skill-cli keychain integration'

/**
 * Check if shell integration is already set up
 */
export function hasShellIntegration(): boolean {
  const rcPath = getShellRcPath()
  if (!existsSync(rcPath)) {
    return false
  }
  const content = readFileSync(rcPath, 'utf8')
  return content.includes(EXPORT_MARKER)
}

/**
 * Add export lines to shell rc file
 */
export function addShellIntegration(): {
  success: boolean
  path: string
  error?: string
} {
  const rcPath = getShellRcPath()

  try {
    // Check if already present
    if (existsSync(rcPath)) {
      const content = readFileSync(rcPath, 'utf8')
      if (content.includes(EXPORT_MARKER)) {
        return { success: true, path: rcPath }
      }
    }

    // Append to rc file
    const addition = `\n${SHELL_EXPORTS}\n`
    appendFileSync(rcPath, addition)

    return { success: true, path: rcPath }
  } catch (err) {
    return {
      success: false,
      path: rcPath,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Get status of keychain setup
 */
export function getKeychainStatus(): {
  platform: 'macos' | 'linux' | 'other'
  keychainSupported: boolean
  opCliAvailable: boolean
  opTokenInKeychain: boolean
  ageKeyInKeychain: boolean
  shellIntegration: boolean
  opTokenInEnv: boolean
} {
  return {
    platform: isMacOS() ? 'macos' : isLinux() ? 'linux' : 'other',
    keychainSupported: isKeychainSupported(),
    opCliAvailable: isOpCliAvailable(),
    opTokenInKeychain: isInKeychain('op-service-account-token'),
    ageKeyInKeychain: isInKeychain('age-private-key'),
    shellIntegration: hasShellIntegration(),
    opTokenInEnv: !!process.env.OP_SERVICE_ACCOUNT_TOKEN,
  }
}

// 1Password vault/item IDs for service account token
const OP_VAULT_ID = 'u3ujzar6l3nahlahsuzfvg7vcq'
const OP_SERVICE_ACCOUNT_ITEM_ID = '3e4ip354ps3mhq2wwt6vmtm2zu'

/**
 * Automatically bootstrap keychain from op CLI if available.
 * Called by config-loader when secrets are needed.
 * Returns the OP_SERVICE_ACCOUNT_TOKEN if successful.
 */
export function autoBootstrapKeychain(): string | null {
  // Already have token in env?
  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    return process.env.OP_SERVICE_ACCOUNT_TOKEN
  }

  // Already in keychain?
  const fromKeychain = getFromKeychain('op-service-account-token')
  if (fromKeychain) {
    return fromKeychain
  }

  // No keychain support? Can't bootstrap.
  if (!isKeychainSupported()) {
    return null
  }

  // Try op CLI
  if (!isOpCliAvailable()) {
    return null
  }

  // Fetch service account token from 1Password
  const token = fetchFromOp(
    OP_SERVICE_ACCOUNT_ITEM_ID,
    OP_VAULT_ID,
    'credential'
  )
  if (!token) {
    return null
  }

  // Store in keychain for future use
  storeInKeychain('op-service-account-token', token)

  // Also add shell integration if not present
  if (!hasShellIntegration()) {
    addShellIntegration()
  }

  return token
}
