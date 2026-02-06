import { existsSync, readFileSync } from 'node:fs'
import { Decrypter } from 'age-encryption'
import { getAgeKey } from '../../core/config-loader'
import type { CommandContext } from '../../core/context'
import { EXIT_CODES } from '../../core/errors'
import { getEncryptedConfigPath } from './set'

export interface ConfigListOptions {
  json?: boolean
  showValues?: boolean
}

type ConfigListResult = {
  success: boolean
  config?: Record<string, string>
  keys?: string[]
  error?: string
}

/**
 * Decrypt and parse the user config file
 */
async function decryptConfig(
  identity: string
): Promise<Record<string, string>> {
  const configPath = getEncryptedConfigPath()

  if (!existsSync(configPath)) {
    return {}
  }

  const encrypted = readFileSync(configPath)
  const decrypter = new Decrypter()
  decrypter.addIdentity(identity)

  try {
    const decrypted = await decrypter.decrypt(encrypted, 'text')
    const config: Record<string, string> = {}

    // Parse key=value lines
    for (const line of decrypted.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const eqIndex = trimmed.indexOf('=')
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex)
        const value = trimmed.substring(eqIndex + 1)
        config[key] = value
      }
    }

    return config
  } catch (error) {
    throw new Error(
      `Failed to decrypt config: ${error instanceof Error ? error.message : 'unknown error'}`
    )
  }
}

/**
 * List all config overrides
 */
export async function configListAction(
  ctx: CommandContext,
  options: ConfigListOptions = {}
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  // Get age key (env var > local file > keychain > 1Password)
  const identity = await getAgeKey()
  if (!identity) {
    const result: ConfigListResult = {
      success: false,
      error: 'No age key found. Set SKILL_AGE_KEY, place key at ~/.config/skill/age.key, or configure 1Password.',
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.error(result.error!)
    }

    process.exitCode = EXIT_CODES.usage
    return
  }

  try {
    // Decrypt and parse config
    const config = await decryptConfig(identity)
    const keys = Object.keys(config)

    if (keys.length === 0) {
      const result: ConfigListResult = {
        success: true,
        config: {},
        keys: [],
      }

      if (outputJson) {
        ctx.output.data(result)
      } else {
        ctx.output.data('No config overrides set.')
        ctx.output.data('\nTo add a config: skill config set KEY=value')
      }
      return
    }

    const result: ConfigListResult = {
      success: true,
      config: options.showValues ? config : undefined,
      keys,
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.data('User config overrides:\n')

      if (options.showValues) {
        // Show key=value
        for (const key of keys.sort()) {
          ctx.output.data(`${key}=${config[key]}`)
        }
      } else {
        // Show keys only (secure by default)
        for (const key of keys.sort()) {
          ctx.output.data(`${key}=********`)
        }
        ctx.output.data('\nTo view values: skill config list --show-values')
      }
    }
  } catch (error) {
    const result: ConfigListResult = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list config',
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.error(`Failed to list config: ${result.error}`)
    }

    process.exitCode = EXIT_CODES.error
  }
}
