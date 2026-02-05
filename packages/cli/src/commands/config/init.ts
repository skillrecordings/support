import { homedir } from 'node:os'
import { join } from 'node:path'
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
 *
 * @deprecated This command is obsolete. The CLI now uses the 1Password age key directly.
 * Use `skill keys` to manage personal API keys.
 */
export async function configInitAction(
  ctx: CommandContext,
  options: ConfigInitOptions = {}
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  // This command is deprecated - redirect to skill keys
  const result: ConfigInitResult = {
    success: false,
    error:
      'DEPRECATED: skill config init is no longer needed.\n' +
      'The CLI now uses the 1Password age key for encryption.\n' +
      'Use `skill keys` to manage your personal API keys.',
  }

  if (outputJson) {
    ctx.output.data(result)
  } else {
    ctx.output.error('⚠️  DEPRECATED: skill config init is no longer needed.')
    ctx.output.data('')
    ctx.output.data('The CLI now uses the 1Password age key for encryption.')
    ctx.output.data('Local age keypairs are no longer required.')
    ctx.output.data('')
    ctx.output.data('To manage your personal API keys:')
    ctx.output.data('  skill keys           Interactive setup')
    ctx.output.data('  skill keys add       Add a personal API key')
    ctx.output.data('  skill keys status    Show key provenance')
  }

  process.exitCode = EXIT_CODES.usage
}
