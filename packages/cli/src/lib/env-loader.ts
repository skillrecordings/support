import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from 'dotenv-flow'

/**
 * Load secrets from layered fallback:
 * 1. Local .env/.env.local files
 * 2. Fail with clear instructions
 *
 * Injects secrets into process.env
 *
 * @param cliDirOverride - Optional path to CLI package root (use when calling from bundled code)
 */
export async function loadSecrets(cliDirOverride?: string): Promise<void> {
  const cliDir = cliDirOverride ?? path.resolve(import.meta.dirname, '../..')

  // Layer 1: Check for local .env files
  const localEnvExists = await checkLocalEnv(cliDir)
  if (localEnvExists) {
    config({ path: cliDir, silent: true })
    return
  }

  // Layer 2: Nothing found - fail with instructions
  throw new Error(
    'No environment configuration found.\n\n' +
      'Options:\n' +
      '1. Create .env.local in packages/cli/ with your secrets\n\n' +
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
