import { existsSync, readFileSync } from 'node:fs'
import { password, select } from '@inquirer/prompts'
import { Decrypter } from 'age-encryption'
import type { Command } from 'commander'
import { getKeyProvenance } from '../../core/config-loader'
import { createContext } from '../../core/context'
import { SECRET_REFS, type SecretRefKey } from '../../core/secret-refs'
import { configInitAction, getAgeKeyPath } from '../config/init'
import { configSetAction, getEncryptedConfigPath } from '../config/set'

const buildContext = async (command: Command, json?: boolean) => {
  const opts =
    typeof command.optsWithGlobals === 'function'
      ? command.optsWithGlobals()
      : {
          ...command.parent?.opts(),
          ...command.opts(),
        }
  return createContext({
    format: json ? 'json' : opts.format,
    verbose: opts.verbose,
    quiet: opts.quiet,
  })
}

/**
 * Get list of user-configured keys from encrypted config
 */
async function getUserConfiguredKeys(): Promise<Set<string>> {
  const keyPath = getAgeKeyPath()
  const configPath = getEncryptedConfigPath()

  if (!existsSync(keyPath) || !existsSync(configPath)) {
    return new Set()
  }

  try {
    const identity = readFileSync(keyPath, 'utf8').trim()
    const encrypted = readFileSync(configPath)
    const decrypter = new Decrypter()
    decrypter.addIdentity(identity)
    const decrypted = await decrypter.decrypt(encrypted, 'text')

    const keys = new Set<string>()
    for (const line of decrypted.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex > 0) {
        keys.add(trimmed.substring(0, eqIndex))
      }
    }
    return keys
  } catch {
    return new Set()
  }
}

/**
 * Show key status - which are personal vs shared
 */
async function showKeyStatus(
  ctx: ReturnType<typeof createContext> extends Promise<infer T> ? T : never
): Promise<void> {
  const userKeys = await getUserConfiguredKeys()
  const allKeys = Object.keys(SECRET_REFS) as SecretRefKey[]

  ctx.output.data('\n📋 API Key Status')
  ctx.output.data('─'.repeat(60))

  // Group by status
  const personal: string[] = []
  const shared: string[] = []
  const notSet: string[] = []

  for (const key of allKeys) {
    const provenance = getKeyProvenance(key)
    const hasUserKey = userKeys.has(key)
    const hasEnvValue = !!process.env[key]

    if (hasUserKey) {
      personal.push(key)
    } else if (provenance === 'shipped' || hasEnvValue) {
      shared.push(key)
    } else {
      notSet.push(key)
    }
  }

  if (personal.length > 0) {
    ctx.output.data('\n🔐 Your personal keys:')
    for (const key of personal) {
      ctx.output.data(`   ✓ ${key}`)
    }
  }

  if (shared.length > 0) {
    ctx.output.data('\n🏢 Using shared/shipped keys:')
    for (const key of shared.slice(0, 5)) {
      ctx.output.data(`   • ${key}`)
    }
    if (shared.length > 5) {
      ctx.output.data(`   • ... and ${shared.length - 5} more`)
    }
  }

  if (notSet.length > 0 && notSet.length < 10) {
    ctx.output.data('\n⚠️  Not configured:')
    for (const key of notSet) {
      ctx.output.data(`   ○ ${key}`)
    }
  }

  ctx.output.data('')
}

/**
 * Interactive key setup flow
 */
async function interactiveKeySetup(
  ctx: ReturnType<typeof createContext> extends Promise<infer T> ? T : never
): Promise<void> {
  const keyPath = getAgeKeyPath()

  // Auto-init if needed
  if (!existsSync(keyPath)) {
    ctx.output.data('\n🔑 First time setup - creating your encryption key...\n')
    await configInitAction(ctx, { json: false })
    ctx.output.data('')
  }

  // Show current status
  await showKeyStatus(ctx)

  // Offer to add a key
  ctx.output.data('─'.repeat(60))
  ctx.output.data('')

  try {
    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Add/update a personal API key', value: 'add' },
        { name: 'View all available keys', value: 'list' },
        { name: 'Exit', value: 'exit' },
      ],
    })

    if (action === 'exit') {
      return
    }

    if (action === 'list') {
      ctx.output.data('\n📋 Available API keys you can personalize:\n')
      const keys = Object.keys(SECRET_REFS) as SecretRefKey[]
      for (const key of keys) {
        ctx.output.data(`   • ${key}`)
      }
      ctx.output.data('\nRun `skill keys add` to set one.')
      return
    }

    if (action === 'add') {
      const selectedKey = await select({
        message: 'Which key do you want to set?',
        choices: (Object.keys(SECRET_REFS) as SecretRefKey[]).map((key) => ({
          name: key,
          value: key,
        })),
      })

      const value = await password({
        message: `Enter your ${selectedKey}:`,
      })

      if (!value) {
        ctx.output.data('Cancelled - no value provided.')
        return
      }

      await configSetAction(ctx, `${selectedKey}=${value}`, { json: false })
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('User force closed') ||
        error.message.includes('canceled'))
    ) {
      ctx.output.data('\nCancelled.')
      return
    }
    throw error
  }
}

/**
 * Register keys commands
 */
export function registerKeysCommands(program: Command): void {
  const keys = program
    .command('keys')
    .description(
      'Manage your personal API keys\n\n' +
        '  Use your own API keys instead of shared defaults.\n' +
        '  Keys are encrypted and stored in ~/.config/skill/\n\n' +
        '  Examples:\n' +
        '    skill keys           Interactive setup\n' +
        '    skill keys status    Show which keys are personal vs shared\n' +
        '    skill keys add       Add a personal API key'
    )
    .action(async (_options, command) => {
      const ctx = await buildContext(command, false)
      if (!process.stdin.isTTY) {
        ctx.output.error(
          'Interactive mode requires a TTY. Use `skill keys add KEY=value` for scripting.'
        )
        return
      }
      await interactiveKeySetup(ctx)
    })

  keys
    .command('status')
    .description('Show which API keys are personal vs shared')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      if (options.json || ctx.format === 'json') {
        const userKeys = await getUserConfiguredKeys()
        const allKeys = Object.keys(SECRET_REFS) as SecretRefKey[]
        const status: Record<string, 'personal' | 'shared' | 'not_set'> = {}
        for (const key of allKeys) {
          const provenance = getKeyProvenance(key)
          if (userKeys.has(key)) {
            status[key] = 'personal'
          } else if (provenance === 'shipped' || process.env[key]) {
            status[key] = 'shared'
          } else {
            status[key] = 'not_set'
          }
        }
        ctx.output.data({ keys: status })
      } else {
        await showKeyStatus(ctx)
      }
    })

  keys
    .command('add [key-value]')
    .description(
      'Add a personal API key\n\n' +
        '  Interactive: skill keys add\n' +
        '  Direct:      skill keys add LINEAR_API_KEY=lin_xxx'
    )
    .option('--json', 'Output as JSON')
    .action(async (keyValue, options, command) => {
      const ctx = await buildContext(command, options.json)
      const keyPath = getAgeKeyPath()

      // Auto-init if needed (silent in non-interactive mode)
      if (!existsSync(keyPath)) {
        if (process.stdin.isTTY && !options.json) {
          ctx.output.data(
            '🔑 First time setup - creating your encryption key...\n'
          )
        }
        await configInitAction(ctx, { json: options.json })
      }

      await configSetAction(ctx, keyValue, options)
    })

  keys
    .command('list')
    .description('List your personal API keys (names only, values hidden)')
    .option('--show-values', 'Show decrypted values')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      const userKeys = await getUserConfiguredKeys()

      if (options.json || ctx.format === 'json') {
        ctx.output.data({ personalKeys: Array.from(userKeys) })
      } else {
        if (userKeys.size === 0) {
          ctx.output.data('No personal keys configured.')
          ctx.output.data('\nRun `skill keys add` to set one.')
        } else {
          ctx.output.data('\n🔐 Your personal API keys:\n')
          for (const key of userKeys) {
            ctx.output.data(`   • ${key}`)
          }
          ctx.output.data('')
        }
      }
    })
}
