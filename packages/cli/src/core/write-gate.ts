import { getKeyProvenance } from './config-loader.js'
import { CLIError, EXIT_CODES } from './errors.js'

/**
 * Keys that require personal configuration for write operations.
 * These must come from user config, not shipped defaults.
 */
export const WRITE_GATED_KEYS = [
  'LINEAR_API_KEY',
  'STRIPE_SECRET_KEY',
  'FRONT_API_TOKEN',
  'INNGEST_EVENT_KEY',
] as const

export type WriteGatedKey = (typeof WRITE_GATED_KEYS)[number]

/**
 * Require that a key exists in user config (not shipped defaults).
 * Throws CLIError if key is from shipped defaults or undefined.
 *
 * @param keyName - The environment variable name to check
 * @throws {CLIError} If key is not from user config
 *
 * @example
 * ```typescript
 * // In a write command handler
 * requirePersonalKey('LINEAR_API_KEY')
 * // proceeds if user has configured it
 * // throws if using shipped default or missing
 * ```
 */
export function requirePersonalKey(keyName: string): void {
  const provenance = getKeyProvenance(keyName)

  if (provenance === 'user') {
    return
  }

  // Key is either 'shipped' or undefined
  throw new CLIError({
    userMessage: `Write operations require a personal API key for ${keyName}.`,
    exitCode: EXIT_CODES.auth,
    suggestion: "Run 'skill keys add' to set up your personal keys.",
    debugMessage: `Key provenance for ${keyName}: ${provenance ?? 'undefined'}`,
  })
}

/**
 * Check if a key name is write-gated.
 */
export function isWriteGatedKey(keyName: string): keyName is WriteGatedKey {
  return WRITE_GATED_KEYS.includes(keyName as WriteGatedKey)
}
