import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { config } from 'dotenv-flow'
import { decrypt } from './crypto.js'

/** 1Password reference for the age private key */
const OP_AGE_KEY_REF = 'op://Support/skill-cli-age-key/private_key'

/**
 * Load secrets from layered fallback:
 * 1. Local .env/.env.local files
 * 2. Encrypted .env.encrypted file (auto-fetches key from 1Password if ~/.op-token exists)
 * 3. Fail with clear instructions
 *
 * Injects secrets into process.env
 */
export async function loadSecrets(): Promise<void> {
  const cliDir = path.resolve(import.meta.dirname, '../..')

  // Layer 1: Check for local .env files
  const localEnvExists = await checkLocalEnv(cliDir)
  if (localEnvExists) {
    config({ path: cliDir, silent: true })
    return
  }

  // Layer 2: Try encrypted fallback
  const encryptedPath = path.join(cliDir, '.env.encrypted')
  const encryptedExists = await fileExists(encryptedPath)

  if (encryptedExists) {
    // Try to get the private key - either from env or via 1Password
    let privateKey = process.env.AGE_SECRET_KEY

    if (!privateKey) {
      // Attempt to load from 1Password via ~/.op-token
      privateKey = await tryLoadKeyFrom1Password()
    }

    if (!privateKey) {
      throw new Error(
        'Found .env.encrypted but cannot decrypt.\n\n' +
          'Options:\n' +
          '1. Set AGE_SECRET_KEY env var with the private key\n' +
          '2. Create ~/.op-token with 1Password service account token\n\n' +
          'See docs/CLI-AUTH.md for setup instructions.'
      )
    }

    try {
      const encryptedData = await fs.readFile(encryptedPath)
      const decrypted = await decrypt(encryptedData, privateKey)

      // Parse decrypted env file format (KEY=VALUE lines)
      parseAndInjectEnv(decrypted)
      return
    } catch (error) {
      throw new Error(
        `Failed to decrypt .env.encrypted: ${error instanceof Error ? error.message : String(error)}\n` +
          'Check that the decryption key matches the encryption key.'
      )
    }
  }

  // Layer 3: Nothing found - fail with instructions
  throw new Error(
    'No environment configuration found.\n\n' +
      'Options:\n' +
      '1. Create .env.local in packages/cli/ with your secrets\n' +
      '2. Set AGE_SECRET_KEY and use encrypted .env.encrypted\n' +
      '3. Create ~/.op-token for automatic 1Password-based decryption\n\n' +
      'See docs/CLI-AUTH.md for setup instructions.'
  )
}

/**
 * Try to load the age private key from 1Password using ~/.op-token
 * Returns the key if successful, undefined otherwise
 */
async function tryLoadKeyFrom1Password(): Promise<string | undefined> {
  const opTokenPath = path.join(os.homedir(), '.op-token')

  // Check if ~/.op-token exists
  if (!(await fileExists(opTokenPath))) {
    return undefined
  }

  try {
    // Read and parse ~/.op-token (format: export VAR="value")
    const tokenFileContent = await fs.readFile(opTokenPath, 'utf-8')
    const token = parseOpTokenFile(tokenFileContent)

    if (!token) {
      return undefined
    }

    // Set the token in env for op CLI to use
    process.env.OP_SERVICE_ACCOUNT_TOKEN = token

    // Fetch the age private key from 1Password
    const privateKey = execSync(`op read "${OP_AGE_KEY_REF}"`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env, // Explicit env pass required for token to be visible
    }).trim()

    return privateKey || undefined
  } catch {
    // Silently fail - caller will show appropriate error
    return undefined
  }
}

/**
 * Parse ~/.op-token file format: export OP_SERVICE_ACCOUNT_TOKEN="value"
 */
function parseOpTokenFile(content: string): string | undefined {
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Match: export OP_SERVICE_ACCOUNT_TOKEN="value" or =value
    const match = trimmed.match(
      /^export\s+OP_SERVICE_ACCOUNT_TOKEN\s*=\s*["']?([^"'\s]+)["']?/
    )
    if (match?.[1]) {
      return match[1]
    }

    // Also support bare assignment: OP_SERVICE_ACCOUNT_TOKEN=value
    const bareMatch = trimmed.match(
      /^OP_SERVICE_ACCOUNT_TOKEN\s*=\s*["']?([^"'\s]+)["']?/
    )
    if (bareMatch?.[1]) {
      return bareMatch[1]
    }
  }

  return undefined
}

/**
 * Check if any local .env files exist
 */
async function checkLocalEnv(dir: string): Promise<boolean> {
  const candidates = ['.env.local', '.env']
  for (const file of candidates) {
    if (await fileExists(path.join(dir, file))) {
      return true
    }
  }
  return false
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
 * Parse env file format (KEY=VALUE) and inject into process.env
 * Handles quoted values, comments, and empty lines
 */
function parseAndInjectEnv(content: string): void {
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // Only set if not already defined (respect existing env vars)
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
