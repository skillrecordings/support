import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from 'dotenv-flow'
import { decrypt } from './crypto.js'

/**
 * Load secrets from layered fallback:
 * 1. Local .env/.env.local files (dev override)
 * 2. Encrypted .env.encrypted + AGE_SECRET_KEY (npm installs)
 * 3. Fail with clear instructions
 *
 * Injects secrets into process.env
 *
 * @param cliDirOverride - Optional path to CLI package root (use when calling from bundled code)
 */
export async function loadSecrets(cliDirOverride?: string): Promise<void> {
  const cliDir = cliDirOverride ?? path.resolve(import.meta.dirname, '../..')

  // Layer 1: Check for local .env files (takes priority — dev workflow)
  const localEnvExists = await checkLocalEnv(cliDir)
  if (localEnvExists) {
    config({ path: cliDir, silent: true })
    return
  }

  // Layer 2: Decrypt .env.encrypted with AGE_SECRET_KEY
  const encryptedPath = path.join(cliDir, '.env.encrypted')
  if (await fileExists(encryptedPath)) {
    const privateKey = process.env.AGE_SECRET_KEY
    if (!privateKey) {
      throw new Error(
        'Found .env.encrypted but AGE_SECRET_KEY is not set.\n\n' +
          'Add to your shell profile (~/.zshrc):\n' +
          '  export AGE_SECRET_KEY="AGE-SECRET-KEY-1..."\n\n' +
          'Or create .env.local in the CLI package directory to bypass encryption.'
      )
    }

    try {
      const encryptedData = await fs.readFile(encryptedPath)
      const decrypted = await decrypt(encryptedData, privateKey)
      parseAndInjectEnv(decrypted)
      return
    } catch (error) {
      throw new Error(
        `Failed to decrypt .env.encrypted: ${error instanceof Error ? error.message : String(error)}\n` +
          'Check that AGE_SECRET_KEY matches the encryption key.'
      )
    }
  }

  // Layer 3: Nothing found
  throw new Error(
    'No environment configuration found.\n\n' +
      'Options:\n' +
      '1. Set AGE_SECRET_KEY in your shell profile (for .env.encrypted)\n' +
      '2. Create .env.local in the CLI package directory\n\n' +
      'See docs/CLI-AUTH.md for setup instructions.'
  )
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
