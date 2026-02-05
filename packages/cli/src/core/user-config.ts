import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathExists } from './fs-extra'

/**
 * User-local config directory name.
 * Uses ~/.config/skill (NOT skill-cli) for user-specific settings.
 */
const USER_CONFIG_DIR_NAME = 'skill'

/**
 * User config file paths relative to getUserConfigDir().
 */
export const USER_CONFIG_PATHS = {
  /** Age encryption private key file */
  ageKey: 'age.key',
  /** Encrypted environment variables file */
  envEncrypted: '.env.user.encrypted',
  /** Optional plaintext config file */
  configJson: 'config.json',
} as const

/**
 * Resolves the user config directory following XDG_CONFIG_HOME pattern.
 * Matches the pattern from usage-tracker.ts (resolveConfigDir).
 *
 * @param configDir - Optional override for testing
 * @returns Absolute path to ~/.config/skill (or XDG_CONFIG_HOME/skill)
 */
export function getUserConfigDir(configDir?: string): string {
  if (configDir) return configDir
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome && xdgConfigHome.trim() !== '') {
    return join(xdgConfigHome, USER_CONFIG_DIR_NAME)
  }
  // homedir() can return '' on some systems if HOME is not set
  const home = homedir() || process.env.HOME || '/tmp'
  return join(home, '.config', USER_CONFIG_DIR_NAME)
}

/**
 * Gets absolute path for a user config file.
 *
 * @param fileName - One of USER_CONFIG_PATHS values
 * @param configDir - Optional override for testing
 * @returns Absolute path to the file
 */
export function getUserConfigPath(
  fileName: (typeof USER_CONFIG_PATHS)[keyof typeof USER_CONFIG_PATHS],
  configDir?: string
): string {
  return join(getUserConfigDir(configDir), fileName)
}

/**
 * Checks if user has configured encrypted environment variables.
 * Looks for .env.user.encrypted in the user config directory.
 *
 * @param configDir - Optional override for testing
 * @returns true if .env.user.encrypted exists
 */
export async function hasUserConfig(configDir?: string): Promise<boolean> {
  const envPath = getUserConfigPath(USER_CONFIG_PATHS.envEncrypted, configDir)
  return pathExists(envPath)
}

/**
 * Checks if user has an age encryption key configured.
 *
 * @param configDir - Optional override for testing
 * @returns true if age.key exists
 */
export async function hasAgeKey(configDir?: string): Promise<boolean> {
  const keyPath = getUserConfigPath(USER_CONFIG_PATHS.ageKey, configDir)
  return pathExists(keyPath)
}

/**
 * Gets the age encryption key path.
 * Checks AGE_USER_KEY env var first, then falls back to ~/.config/skill/age.key
 *
 * @param configDir - Optional override for testing
 * @returns Absolute path to age private key
 */
export function getAgeKeyPath(configDir?: string): string {
  const envKey = process.env.AGE_USER_KEY
  if (envKey && envKey.trim() !== '') {
    return envKey
  }
  return getUserConfigPath(USER_CONFIG_PATHS.ageKey, configDir)
}
