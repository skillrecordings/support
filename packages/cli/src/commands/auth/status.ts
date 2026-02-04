import fs from 'node:fs/promises'
import path from 'node:path'
import type { Command } from 'commander'
import {
  detectPlatform,
  detectShellProfile,
  isKeychainAvailable,
  readFromKeychain,
  shellProfileHasExport,
} from '../../lib/keychain.js'
import {
  getOpInstallInstructions,
  isOpCliAvailable,
  isOpSignedIn,
  isServiceAccountConfigured,
} from '../../lib/onepassword.js'

const KEY_NAME = 'AGE_SECRET_KEY'

interface AuthStatus {
  envLocal: {
    exists: boolean
    path: string
  }
  envEncrypted: {
    exists: boolean
    path: string
  }
  ageSecretKey: {
    configured: boolean
    masked?: string
  }
  keychain: {
    available: boolean
    platform: string
    stored: boolean
  }
  onepassword: {
    cliInstalled: boolean
    signedIn: boolean
    serviceAccountConfigured: boolean
  }
  shellProfile: {
    path: string | null
    hasExport: boolean
  }
  envSource: 'local' | 'encrypted' | 'none'
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function maskAgeKey(key: string): string {
  if (!key.startsWith('AGE-SECRET-KEY-1')) {
    return 'INVALID_FORMAT'
  }
  const prefix = key.slice(0, 19)
  const suffix = key.slice(-3)
  return `${prefix}...${suffix}`
}

function determineEnvSource(
  localExists: boolean,
  encryptedExists: boolean,
  ageKeyConfigured: boolean
): 'local' | 'encrypted' | 'none' {
  if (localExists) return 'local'
  if (encryptedExists && ageKeyConfigured) return 'encrypted'
  return 'none'
}

export function registerStatusCommand(auth: Command): void {
  auth
    .command('status')
    .description('Show auth configuration status')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const status = await getAuthStatus()

      if (options.json) {
        console.log(JSON.stringify(status, null, 2))
        return
      }

      printStatus(status)
    })
}

async function getAuthStatus(): Promise<AuthStatus> {
  const platform = detectPlatform()
  const cliDir = path.resolve(import.meta.dirname, '../../..')

  // File checks
  const envLocalPath = path.join(cliDir, '.env.local')
  const envLocalExists = await fileExists(envLocalPath)
  const envEncryptedPath = path.join(cliDir, '.env.encrypted')
  const envEncryptedExists = await fileExists(envEncryptedPath)

  // Environment
  const ageSecretKey = process.env[KEY_NAME]
  const ageKeyConfigured = Boolean(ageSecretKey)

  // Keychain
  const keychainAvailable = isKeychainAvailable()
  const keychainValue = keychainAvailable ? readFromKeychain(KEY_NAME) : null

  // 1Password
  const opInstalled = isOpCliAvailable()

  // Shell profile
  const profilePath = detectShellProfile()

  const envSource = determineEnvSource(
    envLocalExists,
    envEncryptedExists,
    ageKeyConfigured
  )

  return {
    envLocal: { exists: envLocalExists, path: envLocalPath },
    envEncrypted: { exists: envEncryptedExists, path: envEncryptedPath },
    ageSecretKey: {
      configured: ageKeyConfigured,
      masked: ageKeyConfigured && ageSecretKey ? maskAgeKey(ageSecretKey) : undefined,
    },
    keychain: {
      available: keychainAvailable,
      platform:
        platform === 'macos'
          ? 'macOS Keychain'
          : platform === 'linux'
            ? 'Linux secret-tool'
            : 'unsupported',
      stored: !!keychainValue,
    },
    onepassword: {
      cliInstalled: opInstalled,
      signedIn: opInstalled ? isOpSignedIn() : false,
      serviceAccountConfigured: isServiceAccountConfigured(),
    },
    shellProfile: {
      path: profilePath,
      hasExport: profilePath ? shellProfileHasExport(profilePath, KEY_NAME) : false,
    },
    envSource,
  }
}

function printStatus(status: AuthStatus): void {
  console.log('\nAuth Status:\n')

  // Environment files
  console.log('  Environment Files:')
  console.log(
    `    .env.local:      ${status.envLocal.exists ? '✓ (exists)' : '✗ (not found)'}`
  )
  console.log(
    `    .env.encrypted:  ${status.envEncrypted.exists ? '✓ (exists)' : '✗ (not found)'}`
  )

  // AGE key
  console.log('\n  AGE_SECRET_KEY:')
  const envIcon = status.ageSecretKey.configured ? '✓' : '✗'
  console.log(
    `    env:       ${envIcon} ${status.ageSecretKey.configured ? `(${status.ageSecretKey.masked})` : 'not set'}`
  )

  // Keychain
  console.log(`\n  Keychain (${status.keychain.platform}):`)
  if (!status.keychain.available) {
    console.log(`    ${KEY_NAME}:  ✗ (keychain CLI not available)`)
  } else {
    const kcIcon = status.keychain.stored ? '✓' : '✗'
    console.log(
      `    ${KEY_NAME}:  ${kcIcon} ${status.keychain.stored ? '(stored)' : 'not found'}`
    )
  }

  // 1Password
  console.log('\n  1Password:')
  if (!status.onepassword.cliInstalled) {
    console.log(`    op CLI:           ✗ not installed (${getOpInstallInstructions()})`)
  } else {
    const signedInIcon = status.onepassword.signedIn ? '✓' : '✗'
    console.log(
      `    op CLI:           ✓ installed, ${signedInIcon} ${status.onepassword.signedIn ? 'signed in' : 'not signed in'}`
    )
  }
  console.log(
    `    service account:  ${status.onepassword.serviceAccountConfigured ? '✓ configured' : '✗ not set'}`
  )

  // Shell profile
  console.log('\n  Shell Profile:')
  if (status.shellProfile.path) {
    const spIcon = status.shellProfile.hasExport ? '✓' : '✗'
    console.log(
      `    ${status.shellProfile.path}:  ${spIcon} ${status.shellProfile.hasExport ? 'export configured' : 'no export line'}`
    )
  } else {
    console.log('    Could not detect shell profile')
  }

  // Env source
  console.log('\n  Env Source:')
  if (status.envSource === 'local') {
    console.log('    → Using .env.local')
  } else if (status.envSource === 'encrypted') {
    console.log('    → Using .env.encrypted')
  } else {
    console.log('    → No env source available')
  }

  // Summary
  const allGood =
    status.ageSecretKey.configured &&
    status.keychain.stored &&
    status.shellProfile.hasExport

  if (allGood) {
    console.log('\n  Everything looks good.\n')
  } else if (!status.keychain.stored) {
    console.log("\n  Run 'skill auth setup' to configure.\n")
  }
}
