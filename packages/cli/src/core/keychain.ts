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
 * Store a secret in macOS Keychain
 */
export function storeInKeychain(key: KeychainKey, value: string): boolean {
  if (!isMacOS()) {
    return false
  }

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

/**
 * Retrieve secret from macOS Keychain
 */
export function getFromKeychain(key: KeychainKey): string | null {
  if (!isMacOS()) {
    return null
  }

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
  platform: 'macos' | 'other'
  opTokenInKeychain: boolean
  ageKeyInKeychain: boolean
  shellIntegration: boolean
  opTokenInEnv: boolean
} {
  return {
    platform: isMacOS() ? 'macos' : 'other',
    opTokenInKeychain: isInKeychain('op-service-account-token'),
    ageKeyInKeychain: isInKeychain('age-private-key'),
    shellIntegration: hasShellIntegration(),
    opTokenInEnv: !!process.env.OP_SERVICE_ACCOUNT_TOKEN,
  }
}
