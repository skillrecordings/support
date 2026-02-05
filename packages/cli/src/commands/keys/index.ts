import { existsSync, readFileSync } from 'node:fs'
import { password, select } from '@inquirer/prompts'
import { Decrypter } from 'age-encryption'
import type { Command } from 'commander'
import { getKeyProvenance } from '../../core/config-loader'
import { createContext } from '../../core/context'
import {
  addShellIntegration,
  getFromKeychain,
  getKeychainStatus,
  hasShellIntegration,
  isInKeychain,
  isMacOS,
  storeInKeychain,
} from '../../core/keychain'
import { SECRET_REFS, type SecretRefKey } from '../../core/secret-refs'
import { OnePasswordProvider } from '../../core/secrets'
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

  keys
    .command('setup')
    .description(
      'Set up 1Password integration with macOS Keychain\n\n' +
        '  Automatically pulls secrets from 1Password and stores\n' +
        '  them in Keychain so CLI works without manual unlocks.\n\n' +
        '  macOS only. Requires 1Password access.'
    )
    .option('--json', 'Output as JSON')
    .option('--status', 'Show current setup status')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      const outputJson = options.json || ctx.format === 'json'

      const OP_VAULT_LINK =
        'https://start.1password.com/open/i?a=GCTJE4MRGFHKRAYXCEXKZKCEFU&v=u3ujzar6l3nahlahsuzfvg7vcq&i=3e4ip354ps3mhq2wwt6vmtm2zu&h=egghead.1password.com'
      const AGE_KEY_REF = 'op://Support/skill-cli-age-key/private_key'

      // Status check
      if (options.status) {
        const status = getKeychainStatus()
        if (outputJson) {
          ctx.output.data(status)
        } else {
          ctx.output.data('\n🔐 Keychain Integration Status')
          ctx.output.data('─'.repeat(50))
          ctx.output.data(`   Platform:           ${status.platform}`)
          ctx.output.data(
            `   OP token in Keychain: ${status.opTokenInKeychain ? '✓' : '○'}`
          )
          ctx.output.data(
            `   Age key in Keychain:  ${status.ageKeyInKeychain ? '✓' : '○'}`
          )
          ctx.output.data(
            `   Shell integration:    ${status.shellIntegration ? '✓' : '○'}`
          )
          ctx.output.data(
            `   OP token in env:      ${status.opTokenInEnv ? '✓' : '○'}`
          )
          ctx.output.data('')
        }
        return
      }

      // macOS only
      if (!isMacOS()) {
        if (outputJson) {
          ctx.output.data({
            success: false,
            error: 'Keychain integration is macOS only',
          })
        } else {
          ctx.output.error('Keychain integration is only available on macOS.')
          ctx.output.data(
            '\nOn other platforms, set OP_SERVICE_ACCOUNT_TOKEN in your environment.'
          )
        }
        return
      }

      // Check if already fully set up
      const status = getKeychainStatus()
      if (
        status.opTokenInKeychain &&
        status.ageKeyInKeychain &&
        status.shellIntegration
      ) {
        if (outputJson) {
          ctx.output.data({ success: true, message: 'Already configured' })
        } else {
          ctx.output.data('\n✓ Keychain integration already configured!')
          ctx.output.data('  OP token and age key are in Keychain.')
          ctx.output.data('  Shell integration is set up.')
          ctx.output.data('\n  Restart your shell or run: source ~/.zshrc')
        }
        return
      }

      ctx.output.data('\n🔐 1Password Keychain Setup')
      ctx.output.data('─'.repeat(50))

      try {
        // Step 1: Get OP_SERVICE_ACCOUNT_TOKEN
        let opToken = process.env.OP_SERVICE_ACCOUNT_TOKEN

        if (!opToken && status.opTokenInKeychain) {
          // Already in keychain, pull it
          opToken = getFromKeychain('op-service-account-token') ?? undefined
        }

        if (!opToken) {
          // Need to get the token from user
          ctx.output.data('')
          ctx.output.data(
            'No OP_SERVICE_ACCOUNT_TOKEN found. Opening 1Password...'
          )
          ctx.output.data('')

          // Try to open 1Password to the right item
          const { execSync } = await import('node:child_process')
          try {
            execSync(`open "${OP_VAULT_LINK}"`, { stdio: 'ignore' })
            ctx.output.data('  → 1Password should open to the Support vault')
            ctx.output.data('  → Copy the "Service Account Token" field')
          } catch {
            ctx.output.data(`  Open this URL in 1Password:`)
            ctx.output.data(`  ${OP_VAULT_LINK}`)
          }

          ctx.output.data('')

          if (!process.stdin.isTTY) {
            ctx.output.error(
              'Non-interactive mode. Set OP_SERVICE_ACCOUNT_TOKEN and retry.'
            )
            return
          }

          opToken = await password({
            message: 'Paste your OP_SERVICE_ACCOUNT_TOKEN:',
          })

          if (!opToken) {
            ctx.output.data('\nCancelled.')
            return
          }
        }

        // Step 2: Store OP token in keychain
        if (!status.opTokenInKeychain) {
          ctx.output.data('')
          ctx.output.data('Storing OP token in Keychain...')
          if (!storeInKeychain('op-service-account-token', opToken)) {
            ctx.output.error('Failed to store OP token in Keychain.')
            return
          }
          ctx.output.data('  ✓ OP token stored')
        } else {
          ctx.output.data('\n  ✓ OP token already in Keychain')
        }

        // Step 3: Use 1Password SDK to fetch age key
        if (!status.ageKeyInKeychain) {
          ctx.output.data('')
          ctx.output.data('Fetching age key from 1Password...')

          // Temporarily set env var for SDK
          const originalEnv = process.env.OP_SERVICE_ACCOUNT_TOKEN
          process.env.OP_SERVICE_ACCOUNT_TOKEN = opToken

          try {
            const op = new OnePasswordProvider()
            if (!(await op.isAvailable())) {
              throw new Error('1Password SDK not available')
            }
            const ageKey = await op.resolve(AGE_KEY_REF)
            if (!ageKey) {
              throw new Error('Could not resolve age key from 1Password')
            }

            // Store age key in keychain
            if (!storeInKeychain('age-private-key', ageKey)) {
              throw new Error('Failed to store age key in Keychain')
            }
            ctx.output.data('  ✓ Age key fetched and stored')
          } finally {
            // Restore original env
            if (originalEnv) {
              process.env.OP_SERVICE_ACCOUNT_TOKEN = originalEnv
            }
          }
        } else {
          ctx.output.data('  ✓ Age key already in Keychain')
        }

        // Step 4: Add shell integration
        if (!status.shellIntegration) {
          ctx.output.data('')
          ctx.output.data('Adding shell integration...')
          const result = addShellIntegration()
          if (result.success) {
            ctx.output.data(`  ✓ Added exports to ${result.path}`)
          } else {
            ctx.output.data(
              `  ⚠ Could not update ${result.path}: ${result.error}`
            )
            ctx.output.data('')
            ctx.output.data('Add this to your shell rc file manually:')
            ctx.output.data('')
            ctx.output.data('  # skill-cli keychain integration')
            ctx.output.data(
              '  export OP_SERVICE_ACCOUNT_TOKEN=$(security find-generic-password -a "op-service-account-token" -s "skill-cli" -w 2>/dev/null)'
            )
            ctx.output.data(
              '  export SKILL_AGE_KEY=$(security find-generic-password -a "age-private-key" -s "skill-cli" -w 2>/dev/null)'
            )
          }
        } else {
          ctx.output.data('  ✓ Shell integration already configured')
        }

        ctx.output.data('')
        ctx.output.data('─'.repeat(50))
        ctx.output.data('✓ Setup complete!')
        ctx.output.data('')
        ctx.output.data('Restart your shell or run:')
        ctx.output.data('  source ~/.zshrc')
        ctx.output.data('')
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
    })
}
