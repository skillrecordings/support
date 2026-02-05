import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { generateIdentity, identityToRecipient } from 'age-encryption'
import type { CommandContext } from '../../core/context'
import { EXIT_CODES } from '../../core/errors'

export interface ConfigInitOptions {
  force?: boolean
  json?: boolean
}

type ConfigInitResult = {
  success: boolean
  keyPath?: string
  publicKey?: string
  error?: string
}

/**
 * Get the user config directory path (~/.config/skill)
 */
export function getUserConfigDir(): string {
  return join(homedir(), '.config', 'skill')
}

/**
 * Get the age key file path (~/.config/skill/age.key)
 */
export function getAgeKeyPath(): string {
  return join(getUserConfigDir(), 'age.key')
}

/**
 * Initialize user config with age keypair
 */
export async function configInitAction(
  ctx: CommandContext,
  options: ConfigInitOptions = {}
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const keyPath = getAgeKeyPath()
  const configDir = getUserConfigDir()

  // Check if key already exists
  if (existsSync(keyPath) && !options.force) {
    const result: ConfigInitResult = {
      success: false,
      error: `Age key already exists at ${keyPath}. Use --force to overwrite.`,
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.error(result.error!)
      ctx.output.data(`\nTo view your public key: skill config public-key`)
    }

    process.exitCode = EXIT_CODES.usage
    return
  }

  try {
    // Ensure config directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true, mode: 0o700 })
    }

    // Generate age identity
    const identity = await generateIdentity()
    const recipient = await identityToRecipient(identity)

    // Write private key to file with restricted permissions
    writeFileSync(keyPath, identity, { encoding: 'utf8', mode: 0o600 })

    const result: ConfigInitResult = {
      success: true,
      keyPath,
      publicKey: recipient,
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.success('Age keypair generated successfully!')
      ctx.output.data(`\nPrivate key saved to: ${keyPath}`)
      ctx.output.data(`Public key (age recipient): ${recipient}`)
      ctx.output.data(
        '\n⚠️  Keep your private key secure. Anyone with access can decrypt your config.'
      )
      ctx.output.data('\nNext steps:')
      ctx.output.data('  1. Set config values: skill config set KEY=value')
      ctx.output.data('  2. View config: skill config list')
    }
  } catch (error) {
    const result: ConfigInitResult = {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to generate keypair',
    }

    if (outputJson) {
      ctx.output.data(result)
    } else {
      ctx.output.error(`Failed to generate keypair: ${result.error}`)
    }

    process.exitCode = EXIT_CODES.error
  }
}
