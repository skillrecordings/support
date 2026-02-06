import { existsSync, readFileSync } from 'node:fs'
import { Decrypter } from 'age-encryption'
import { getAgeKey } from '../../core/config-loader'
import type { CommandContext } from '../../core/context'
import { EXIT_CODES } from '../../core/errors'
import { getEncryptedConfigPath } from './set'

export interface ConfigGetOptions {
  json?: boolean
}

type ConfigGetResult = {
  success: boolean
  key?: string
  value?: string
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
 * Get a specific config value
 */
export async function configGetAction(
  ctx: CommandContext,
  key: string,
  options: ConfigGetOptions = {}
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  // Get age key (env var > local file > keychain > 1Password)
  const identity = await getAgeKey()
  if (!identity) {
    const result: ConfigGetResult = {
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

    if (!(key in config)) {
      const result: ConfigGetResult = {
        success: false,
        key,
        error: `Key not found: ${key}`,
      }

      if (outputJson) {
        ctx.output.data(result)
      } else {
        ctx.output.error(result.error!)
      }

      process.exitCode = EXIT_CODES.usage
      return
    }

    const result: ConfigGetResult = {
      success: true,
      key,
      value: config[key],
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.data(config[key])
    }
  } catch (error) {
    const result: ConfigGetResult = {
      success: false,
      key,
      error: error instanceof Error ? error.message : 'Failed to get config',
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.error(`Failed to get config: ${result.error}`)
    }

    process.exitCode = EXIT_CODES.error
  }
}
