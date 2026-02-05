import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { USER_CONFIG_PATHS, getUserConfigPath } from './user-config'

/**
 * Key provenance tracking.
 * Tracks whether each env var came from shipped defaults or user overrides.
 */
export type KeyProvenance = 'shipped' | 'user'

/**
 * Result of loading the config chain.
 */
export interface ConfigChainResult {
  /** Merged environment variables (user overrides shipped) */
  env: Record<string, string>
  /** Provenance map: which keys came from user vs shipped */
  provenance: Map<string, KeyProvenance>
}

/**
 * Parse plaintext .env format into key-value pairs.
 * Strips comments, empty lines, and surrounding quotes.
 */
function parseEnvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const raw = trimmed.slice(eqIdx + 1).trim()
    // Strip surrounding quotes
    const value = raw.replace(/^["'](.*)["']$/, '$1')
    env[key] = value
  }
  return env
}

/**
 * Decrypt age-encrypted env file.
 * STUB: This will be implemented by worker-1 (user-secrets.ts).
 * For now, returns empty object if encrypted file exists.
 *
 * @param encryptedPath - Path to .env.encrypted file
 * @param keyPath - Path to age private key (optional, will use 1Password if not provided)
 * @returns Decrypted env vars
 */
async function decryptEnvFile(
  encryptedPath: string,
  keyPath?: string
): Promise<Record<string, string>> {
  // TODO: worker-1 will implement this using age CLI
  // For now, return empty to unblock config chain implementation
  return {}
}

/**
 * Load shipped defaults from packages/cli/.env.encrypted.
 * These are the default credentials shipped with the CLI.
 *
 * @param cliRoot - Root directory of the CLI package
 * @returns Shipped env vars
 */
async function loadShippedDefaults(
  cliRoot: string
): Promise<Record<string, string>> {
  const encryptedPath = resolve(cliRoot, '.env.encrypted')
  try {
    return await decryptEnvFile(encryptedPath)
  } catch {
    // If decryption fails or file doesn't exist, return empty
    return {}
  }
}

/**
 * Load user overrides from ~/.config/skill/.env.user.encrypted.
 * These are user-specific credentials that override shipped defaults.
 *
 * @param configDir - Optional override for testing
 * @returns User env vars
 */
async function loadUserOverrides(
  configDir?: string
): Promise<Record<string, string>> {
  const encryptedPath = getUserConfigPath(
    USER_CONFIG_PATHS.envEncrypted,
    configDir
  )
  try {
    return await decryptEnvFile(encryptedPath)
  } catch {
    // If decryption fails or file doesn't exist, return empty
    return {}
  }
}

/**
 * Load the config chain with provenance tracking.
 * Priority: user overrides > shipped defaults > existing process.env
 *
 * Steps:
 * 1. Load shipped defaults from packages/cli/.env.encrypted
 * 2. Load user overrides from ~/.config/skill/.env.user.encrypted
 * 3. Merge: user overrides shipped
 * 4. Track provenance for each key
 *
 * @param cliRoot - Root directory of the CLI package (defaults to ../../ from this file)
 * @param configDir - Optional override for user config dir (for testing)
 * @returns Merged env and provenance map
 */
export async function loadConfigChain(
  cliRoot?: string,
  configDir?: string
): Promise<ConfigChainResult> {
  const root = cliRoot ?? resolve(import.meta.dirname, '../..')
  const shipped = await loadShippedDefaults(root)
  const user = await loadUserOverrides(configDir)

  const env: Record<string, string> = {}
  const provenance = new Map<string, KeyProvenance>()

  // Start with shipped defaults
  for (const [key, value] of Object.entries(shipped)) {
    env[key] = value
    provenance.set(key, 'shipped')
  }

  // User overrides shipped
  for (const [key, value] of Object.entries(user)) {
    env[key] = value
    provenance.set(key, 'user')
  }

  return { env, provenance }
}

// Global provenance map, populated by initConfig()
let globalProvenance: Map<string, KeyProvenance> = new Map()

/**
 * Initialize the config system. Must be called before any command runs.
 * Stores provenance globally for write-gate access.
 */
export async function initConfig(
  cliRoot?: string,
  configDir?: string
): Promise<void> {
  const result = await loadConfigChain(cliRoot, configDir)
  globalProvenance = result.provenance
  // Apply to process.env
  for (const [key, value] of Object.entries(result.env)) {
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

/**
 * Get provenance for a specific key (uses global state).
 * Returns 'user' | 'shipped' | undefined
 */
export function getKeyProvenance(key: string): KeyProvenance | undefined {
  return globalProvenance.get(key)
}

/**
 * Check if a key is a user-provided override.
 * This is used by write-gate.ts to determine if writes are allowed.
 */
export function isUserKey(key: string): boolean {
  return globalProvenance.get(key) === 'user'
}

/**
 * Set global provenance for testing purposes.
 * @internal - Only for use in tests
 */
export function _setProvenanceForTesting(
  provenance: Map<string, KeyProvenance>
): void {
  globalProvenance = provenance
}

/**
 * Load plaintext .env.local file (legacy support).
 * This is the old behavior that reads .env.local directly.
 *
 * @param cliRoot - Root directory of the CLI package
 * @returns Env vars from .env.local or .env
 */
export function loadPlaintextEnv(cliRoot: string): Record<string, string> {
  for (const envFile of ['.env.local', '.env']) {
    try {
      const content = readFileSync(resolve(cliRoot, envFile), 'utf8')
      return parseEnvContent(content)
    } catch {
      // File doesn't exist — skip
    }
  }
  return {}
}
