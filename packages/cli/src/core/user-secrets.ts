import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decrypt, encrypt } from '../lib/crypto.js'

// Placeholder import - will be provided by worker-0
import { getUserConfigDir } from './user-config.js'

const USER_SECRETS_FILENAME = '.env.user.encrypted'

/**
 * Get the user's age private key from env or config directory
 */
export function getUserAgeKey(): string {
  const envKey = process.env.AGE_USER_KEY
  if (envKey) return envKey

  const keyPath = join(getUserConfigDir(), 'age.key')
  if (!existsSync(keyPath)) {
    throw new Error(
      `Age key not found. Set AGE_USER_KEY env var or create ${keyPath}`
    )
  }

  const key = readFileSync(keyPath, 'utf-8').trim()
  if (!key.startsWith('AGE-SECRET-KEY-1')) {
    throw new Error('Invalid age private key format')
  }

  return key
}

/**
 * Get the path to the encrypted user secrets file
 */
export function getUserSecretsPath(): string {
  return join(getUserConfigDir(), USER_SECRETS_FILENAME)
}

/**
 * Load and decrypt user secrets
 * @returns Key-value pairs of secrets
 */
export async function loadUserSecrets(): Promise<Record<string, string>> {
  const secretsPath = getUserSecretsPath()

  if (!existsSync(secretsPath)) {
    return {}
  }

  const encrypted = await readFile(secretsPath)
  const privateKey = getUserAgeKey()
  const decrypted = await decrypt(encrypted, privateKey)

  // Parse .env format
  const secrets: Record<string, string> = {}
  for (const line of decrypted.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const [key, ...valueParts] = trimmed.split('=')
    if (key && valueParts.length > 0) {
      secrets[key.trim()] = valueParts.join('=').trim()
    }
  }

  return secrets
}

/**
 * Save a user secret (encrypts and writes to .env.user.encrypted)
 * @param key - Secret key
 * @param value - Secret value
 */
export async function saveUserSecret(
  key: string,
  value: string
): Promise<void> {
  // Load existing secrets
  const secrets = await loadUserSecrets()

  // Update
  secrets[key] = value

  // Serialize to .env format
  const content = Object.entries(secrets)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  // Encrypt
  const privateKey = getUserAgeKey()
  // Derive public key from private key
  // age-encryption doesn't expose key derivation, so we need the public key
  // For now, require it from env
  const publicKey = process.env.AGE_USER_PUBLIC_KEY
  if (!publicKey) {
    throw new Error(
      'AGE_USER_PUBLIC_KEY env var required for encryption. Generate with: age-keygen'
    )
  }

  const encrypted = await encrypt(content, publicKey)

  // Write
  const secretsPath = getUserSecretsPath()
  await writeFile(secretsPath, encrypted)
}

/**
 * Remove a user secret
 * @param key - Secret key to remove
 */
export async function removeUserSecret(key: string): Promise<void> {
  const secrets = await loadUserSecrets()
  delete secrets[key]

  if (Object.keys(secrets).length === 0) {
    // If no secrets left, remove file
    const { unlink } = await import('node:fs/promises')
    const secretsPath = getUserSecretsPath()
    if (existsSync(secretsPath)) {
      await unlink(secretsPath)
    }
    return
  }

  // Serialize and encrypt
  const content = Object.entries(secrets)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const publicKey = process.env.AGE_USER_PUBLIC_KEY
  if (!publicKey) {
    throw new Error('AGE_USER_PUBLIC_KEY env var required')
  }

  const encrypted = await encrypt(content, publicKey)
  const secretsPath = getUserSecretsPath()
  await writeFile(secretsPath, encrypted)
}
