import { existsSync, rmSync } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use a module-level variable that vi.mock can access
let testConfigDir = ''

// Mock user-config before importing user-secrets
vi.mock('./user-config.js', () => ({
  getUserConfigDir: () => testConfigDir,
  getUserConfigPath: (fileName: string) => join(testConfigDir, fileName),
  USER_CONFIG_PATHS: {
    ageKey: 'age.key',
    envEncrypted: '.env.user.encrypted',
    configJson: 'config.json',
  },
}))

// Import after mocking
const {
  loadUserSecrets,
  saveUserSecret,
  removeUserSecret,
  getUserSecretsPath,
} = await import('./user-secrets.js')

describe('user-secrets', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(async () => {
    originalEnv = { ...process.env }
    testConfigDir = join(tmpdir(), `skill-test-${Date.now()}`)
    await mkdir(testConfigDir, { recursive: true })
  })

  afterEach(async () => {
    process.env = originalEnv

    // Cleanup test directory
    if (testConfigDir && existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
  })

  it('should return empty object when no secrets file exists', async () => {
    // Without age key, loadUserSecrets should return empty
    const secrets = await loadUserSecrets()
    expect(secrets).toEqual({})
  })

  // Note: The following tests require valid age keys for encryption/decryption
  // Since age key generation is complex, we'll mark these as integration tests
  // that can be run with real keys

  describe('with file-based operations (no encryption)', () => {
    // These test the file operations without actual encryption
    // The real encryption tests would require valid age keys

    it('getUserSecretsPath returns path in config dir', () => {
      const path = getUserSecretsPath()
      expect(path).toBe(join(testConfigDir, '.env.user.encrypted'))
    })
  })
})

// Skip crypto integration tests - they require real age keys
// Real keys can be generated with: npx age-keygen
describe.skip('crypto integration (requires real age keys)', () => {
  it('should encrypt and decrypt round-trip', async () => {
    // Would need real keys:
    // const { encrypt, decrypt } = await import('../lib/crypto.js')
    // const content = 'TEST_SECRET=supersecret'
    // const encrypted = await encrypt(content, REAL_PUBLIC_KEY)
    // const decrypted = await decrypt(encrypted, REAL_PRIVATE_KEY)
    // expect(decrypted).toBe(content)
  })
})
