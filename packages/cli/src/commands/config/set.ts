import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { password, select } from '@inquirer/prompts'
import { Decrypter, Encrypter, identityToRecipient } from 'age-encryption'
import type { CommandContext } from '../../core/context'
import { EXIT_CODES } from '../../core/errors'
import { SECRET_REFS } from '../../core/secret-refs'
import { getAgeKeyPath, getUserConfigDir } from './init'

export interface ConfigSetOptions {
  json?: boolean
}

type ConfigSetResult = {
  success: boolean
  key?: string
  encrypted?: boolean
  error?: string
}

/**
 * Get the encrypted user config file path
 */
export function getEncryptedConfigPath(): string {
  return `${getUserConfigDir()}/.env.user.encrypted`
}

/**
 * Parse KEY=value format
 */
function parseKeyValue(input: string): { key: string; value: string } | null {
  const match = input.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (!match) return null
  const key = match[1]
  const value = match[2]
  if (!key || value === undefined) return null
  return { key, value }
}

/**
 * Decrypt and parse existing config
 */
async function readExistingConfig(
  identity: string,
  configPath: string
): Promise<Record<string, string>> {
  if (!existsSync(configPath)) {
    return {}
  }

  try {
    const encrypted = readFileSync(configPath)
    const decrypter = new Decrypter()
    decrypter.addIdentity(identity)
    const decrypted = await decrypter.decrypt(encrypted, 'text')

    const config: Record<string, string> = {}
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
  } catch {
    return {}
  }
}

/**
 * Set a config value (encrypted)
 */
export async function configSetAction(
  ctx: CommandContext,
  keyValue: string | undefined,
  options: ConfigSetOptions = {}
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const keyPath = getAgeKeyPath()

  // Check if age key exists
  if (!existsSync(keyPath)) {
    const result: ConfigSetResult = {
      success: false,
      error: 'Age key not found. Run: skill config init',
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.error(result.error!)
    }

    process.exitCode = EXIT_CODES.usage
    return
  }

  // Interactive mode: no argument provided and stdin is a TTY
  let finalKeyValue = keyValue
  if (!finalKeyValue && process.stdin.isTTY && !outputJson) {
    try {
      const selectedKey = await select({
        message: 'Select a secret key to set:',
        choices: Object.keys(SECRET_REFS).map((key) => ({
          name: key,
          value: key,
        })),
      })

      const secretValue = await password({
        message: `Enter value for ${selectedKey}:`,
      })

      finalKeyValue = `${selectedKey}=${secretValue}`
    } catch (error) {
      // User cancelled (Ctrl+C)
      if (
        error instanceof Error &&
        (error.message.includes('User force closed') ||
          error.message.includes('canceled'))
      ) {
        ctx.output.data('Cancelled')
        return
      }
      throw error
    }
  }

  // Parse KEY=value
  const parsed = parseKeyValue(finalKeyValue || '')
  if (!parsed) {
    const result: ConfigSetResult = {
      success: false,
      error: 'Invalid format. Expected: KEY=value',
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.error(result.error!)
      ctx.output.data('Example: skill config set DATABASE_URL=postgresql://...')
    }

    process.exitCode = EXIT_CODES.usage
    return
  }

  try {
    // Read private key and derive recipient
    const identity = readFileSync(keyPath, 'utf8').trim()
    const recipient = await identityToRecipient(identity)

    // Read existing config, update/add key, then re-encrypt everything
    const configPath = getEncryptedConfigPath()
    const config = await readExistingConfig(identity, configPath)
    config[parsed.key] = parsed.value

    // Build .env format content
    const envContent = Object.entries(config)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')

    // Encrypt entire config
    const encrypter = new Encrypter()
    encrypter.addRecipient(recipient)
    const encrypted = await encrypter.encrypt(envContent + '\n')

    // Write encrypted config
    writeFileSync(configPath, Buffer.from(encrypted))

    const result: ConfigSetResult = {
      success: true,
      key: parsed.key,
      encrypted: true,
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.success(`Set ${parsed.key} (encrypted)`)
      ctx.output.data(`Saved to: ${configPath}`)
    }
  } catch (error) {
    const result: ConfigSetResult = {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to encrypt config',
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.error(`Failed to set config: ${result.error}`)
    }

    process.exitCode = EXIT_CODES.error
  }
}
