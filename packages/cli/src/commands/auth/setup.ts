import { execSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { confirm, input, password, select } from '@inquirer/prompts'
import type { Command } from 'commander'
import {
  detectPlatform,
  detectShellProfile,
  getShellProfileExportLine,
  isKeychainAvailable,
  readFromKeychain,
  shellProfileHasExport,
  storeInKeychain,
} from '../../lib/keychain.js'
import {
  OP_AGE_KEY_ITEM_ID,
  OP_AGE_KEY_LINK,
  fetchFromOp,
  getOpInstallInstructions,
  isOpCliAvailable,
  isOpSignedIn,
} from '../../lib/onepassword.js'

const KEY_NAME = 'AGE_SECRET_KEY'
const KEY_PREFIX = 'AGE-SECRET-KEY-1'

function validateAgeKey(value: string): boolean | string {
  const trimmed = value.trim()
  if (!trimmed) return 'Key cannot be empty'
  if (!trimmed.startsWith(KEY_PREFIX)) {
    return `Invalid format — must start with ${KEY_PREFIX}`
  }
  return true
}

export function registerSetupCommand(auth: Command): void {
  auth
    .command('setup')
    .description('Store AGE_SECRET_KEY in OS keychain and configure shell')
    .option('--json', 'Output result as JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        await runSetup(options)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (options.json) {
          console.error(JSON.stringify({ success: false, error: message }))
        } else {
          console.error(`Error: ${message}`)
        }
        process.exit(1)
      }
    })
}

async function runSetup(options: { json?: boolean }): Promise<void> {
  const platform = detectPlatform()

  if (platform === 'unsupported') {
    throw new Error(
      `Unsupported platform: ${process.platform}. Only macOS and Linux are supported.`
    )
  }

  if (!isKeychainAvailable()) {
    const tool = platform === 'macos' ? 'security' : 'secret-tool'
    throw new Error(
      `Keychain CLI not found: ${tool}. Install it before running setup.`
    )
  }

  if (!process.stdin.isTTY && !options.json) {
    throw new Error(
      'Setup requires an interactive terminal. Use --json for non-interactive mode.'
    )
  }

  if (!options.json) {
    console.log('\nSkill Recordings CLI — Auth Setup\n')
  }

  // Check if key already exists
  const existingEnv = process.env[KEY_NAME]
  const existingKeychain = readFromKeychain(KEY_NAME)

  if (existingEnv || existingKeychain) {
    if (!options.json) {
      if (existingEnv) {
        console.log(`  ${KEY_NAME} is already set in your environment.`)
      }
      if (existingKeychain) {
        console.log(`  ${KEY_NAME} is already stored in the keychain.`)
      }
    }

    const overwrite = await confirm({
      message: 'Overwrite existing key?',
      default: false,
    })

    if (!overwrite) {
      if (options.json) {
        console.log(JSON.stringify({ success: true, skipped: true }))
      } else {
        console.log('\nSetup cancelled.')
      }
      return
    }
  }

  // Try to get the key — 1Password auto-fetch or manual paste
  const trimmedKey = await obtainKey(options)

  if (!options.json) {
    console.log(`  ✓ Valid age key format`)
  }

  // Store in keychain
  storeInKeychain(KEY_NAME, trimmedKey)

  // Verify it was stored
  const stored = readFromKeychain(KEY_NAME)
  if (stored !== trimmedKey) {
    throw new Error(
      'Keychain verification failed — stored value does not match'
    )
  }

  const keychainLabel =
    platform === 'macos' ? 'macOS Keychain' : 'Linux secret-tool'
  if (!options.json) {
    console.log(`  ✓ Stored in ${keychainLabel}`)
  }

  // Shell profile
  let profilePath = detectShellProfile()
  let profileUpdated = false

  if (!profilePath) {
    if (!options.json) {
      console.log(
        `\n  Could not detect shell profile from $SHELL (${process.env.SHELL || 'unset'}).`
      )
    }
    profilePath = await input({
      message: 'Path to your shell profile (e.g., ~/.zshrc):',
      validate: (v) => v.trim().length > 0 || 'Path is required',
    })
    profilePath = profilePath.replace(/^~/, process.env.HOME || '')
  }

  if (profilePath && !shellProfileHasExport(profilePath, KEY_NAME)) {
    const exportLine = getShellProfileExportLine(KEY_NAME)
    const comment =
      platform === 'macos'
        ? '# age encryption key (stored in macOS Keychain)'
        : '# age encryption key (stored in Linux secret-tool)'

    appendFileSync(profilePath, `\n${comment}\n${exportLine}\n`)
    profileUpdated = true

    if (!options.json) {
      console.log(`  ✓ Added export line to ${profilePath}`)
    }
  } else if (profilePath) {
    if (!options.json) {
      console.log(`  ✓ Export line already in ${profilePath}`)
    }
  }

  // Test decrypt if .env.encrypted exists
  let decryptOk: boolean | null = null
  const cliDir = findCliDir()
  if (cliDir) {
    const encryptedPath = `${cliDir}/.env.encrypted`
    if (existsSync(encryptedPath)) {
      try {
        process.env[KEY_NAME] = trimmedKey
        execSync(`rage -d -i - ${JSON.stringify(encryptedPath)}`, {
          input: trimmedKey,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        decryptOk = true
        if (!options.json) {
          console.log(`  ✓ Decryption test passed (.env.encrypted)`)
        }
      } catch {
        decryptOk = false
        if (!options.json) {
          console.log(
            `  ⚠ Decryption test failed — key may not match .env.encrypted`
          )
        }
      }
    }
  }

  // Output
  if (options.json) {
    console.log(
      JSON.stringify({
        success: true,
        keychain: keychainLabel,
        profilePath,
        profileUpdated,
        decryptOk,
      })
    )
  } else {
    console.log(`\nDone! Restart your shell or run:`)
    console.log(`  source ${profilePath}`)
    console.log(`\nThen verify with:`)
    console.log(`  skill auth status\n`)
  }
}

/**
 * Get the AGE_SECRET_KEY — tries 1Password CLI first, falls back to manual paste.
 */
async function obtainKey(options: { json?: boolean }): Promise<string> {
  const hasOp = isOpCliAvailable()

  if (hasOp) {
    if (!options.json) {
      console.log('  Checking 1Password CLI...')
    }

    const signedIn = isOpSignedIn()

    if (signedIn) {
      const method = await select({
        message: 'How do you want to provide the key?',
        choices: [
          {
            name: 'Fetch from 1Password automatically',
            value: 'auto' as const,
          },
          { name: 'Paste manually', value: 'manual' as const },
        ],
      })

      if (method === 'auto') {
        if (!options.json) {
          console.log('  Fetching AGE_SECRET_KEY from 1Password...')
        }

        const value = fetchFromOp(OP_AGE_KEY_ITEM_ID, 'password')
        if (value && validateAgeKey(value) === true) {
          if (!options.json) {
            console.log('  ✓ Retrieved from 1Password')
          }
          return value
        }

        // password field didn't work, try credential
        const alt = fetchFromOp(OP_AGE_KEY_ITEM_ID, 'credential')
        if (alt && validateAgeKey(alt) === true) {
          if (!options.json) {
            console.log('  ✓ Retrieved from 1Password')
          }
          return alt
        }

        if (!options.json) {
          console.log(
            '  ⚠ Could not auto-fetch key. Falling back to manual paste.'
          )
        }
      }
    } else if (!options.json) {
      console.log('  1Password CLI found but not signed in to egghead account.')
      console.log('  Sign in with: op signin --account egghead.1password.com')
      console.log('')
    }
  } else if (!options.json) {
    console.log('  1Password CLI not installed.')
    console.log(`  Install it: ${getOpInstallInstructions()}`)
    console.log('  (optional — you can paste the key manually below)\n')
  }

  // Manual paste with 1Password link
  if (!options.json) {
    console.log(`  Get the key from 1Password:`)
    console.log(`  ${OP_AGE_KEY_LINK}\n`)
  }

  const key = await password({
    message: `Paste your ${KEY_NAME}:`,
    mask: '*',
    validate: validateAgeKey,
  })

  return key.trim()
}

function findCliDir(): string | null {
  const candidates = [
    process.cwd(),
    new URL('../../..', import.meta.url).pathname,
  ]

  for (const dir of candidates) {
    if (existsSync(`${dir}/.env.encrypted`)) {
      return dir
    }
  }

  return null
}
