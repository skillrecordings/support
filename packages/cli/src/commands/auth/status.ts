import fs from 'node:fs/promises'
import path from 'node:path'
import { isServiceAccountConfigured } from '../../lib/onepassword.js'

interface StatusOptions {
  json?: boolean
}

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
  opServiceAccountToken: {
    configured: boolean
  }
  envSource: 'local' | 'encrypted' | 'none'
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Mask AGE secret key for display
 * Shows AGE-SECRET-KEY-1XXX...XXX format
 */
function maskAgeKey(key: string): string {
  if (!key.startsWith('AGE-SECRET-KEY-1')) {
    return 'INVALID_FORMAT'
  }
  const prefix = key.slice(0, 19) // AGE-SECRET-KEY-1XXX
  const suffix = key.slice(-3) // XXX
  return `${prefix}...${suffix}`
}

/**
 * Determine which env source would be used based on priority
 */
function determineEnvSource(
  localExists: boolean,
  encryptedExists: boolean,
  ageKeyConfigured: boolean
): 'local' | 'encrypted' | 'none' {
  // Priority from env-loader.ts:
  // 1. Local .env files
  // 2. Encrypted .env.encrypted (if AGE_SECRET_KEY is set)
  // 3. None

  if (localExists) {
    return 'local'
  }

  if (encryptedExists && ageKeyConfigured) {
    return 'encrypted'
  }

  return 'none'
}

/**
 * Check auth configuration status
 */
export async function statusAction(options: StatusOptions): Promise<void> {
  const cliDir = path.resolve(import.meta.dirname, '../../..')

  // Check .env.local
  const envLocalPath = path.join(cliDir, '.env.local')
  const envLocalExists = await fileExists(envLocalPath)

  // Check .env.encrypted
  const envEncryptedPath = path.join(cliDir, '.env.encrypted')
  const envEncryptedExists = await fileExists(envEncryptedPath)

  // Check AGE_SECRET_KEY
  const ageSecretKey = process.env.AGE_SECRET_KEY
  const ageKeyConfigured = Boolean(ageSecretKey)

  // Check OP_SERVICE_ACCOUNT_TOKEN
  const opConfigured = isServiceAccountConfigured()

  // Determine env source
  const envSource = determineEnvSource(
    envLocalExists,
    envEncryptedExists,
    ageKeyConfigured
  )

  const status: AuthStatus = {
    envLocal: {
      exists: envLocalExists,
      path: envLocalPath,
    },
    envEncrypted: {
      exists: envEncryptedExists,
      path: envEncryptedPath,
    },
    ageSecretKey: {
      configured: ageKeyConfigured,
      masked:
        ageKeyConfigured && ageSecretKey ? maskAgeKey(ageSecretKey) : undefined,
    },
    opServiceAccountToken: {
      configured: opConfigured,
    },
    envSource,
  }

  if (options.json) {
    console.log(JSON.stringify(status, null, 2))
    return
  }

  // Human-readable output
  console.log('Auth Configuration Status\n')

  console.log('Environment Files:')
  console.log(
    `  .env.local:     ${envLocalExists ? '✓' : '✗'} ${envLocalExists ? '(exists)' : '(not found)'}`
  )
  console.log(`    Path: ${envLocalPath}`)
  console.log(
    `  .env.encrypted: ${envEncryptedExists ? '✓' : '✗'} ${envEncryptedExists ? '(exists)' : '(not found)'}`
  )
  console.log(`    Path: ${envEncryptedPath}`)

  console.log('\nEnvironment Variables:')
  console.log(
    `  AGE_SECRET_KEY:           ${ageKeyConfigured ? '✓' : '✗'} ${ageKeyConfigured ? `(${status.ageSecretKey.masked})` : '(not set)'}`
  )
  console.log(
    `  OP_SERVICE_ACCOUNT_TOKEN: ${opConfigured ? '✓' : '✗'} ${opConfigured ? '(configured)' : '(not set)'}`
  )

  console.log('\nEnv Source Priority:')
  if (envSource === 'local') {
    console.log('  → Using local .env.local file')
  } else if (envSource === 'encrypted') {
    console.log('  → Using encrypted .env.encrypted file')
  } else {
    console.log('  → No env source available')
    console.log('\n⚠ No environment configuration found.')
    console.log('\nOptions:')
    console.log('  1. Create .env.local with your secrets')
    console.log('  2. Use encrypted .env.encrypted (requires AGE_SECRET_KEY)')
    console.log('\nSee docs/ENV.md for setup instructions.')
  }
}
