import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Decrypter,
  Encrypter,
  generateIdentity,
  identityToRecipient,
} from 'age-encryption'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('config commands - encryption/decryption logic', () => {
  let testConfigDir: string
  let testIdentity: string
  let testRecipient: string

  beforeEach(async () => {
    // Create unique test directory
    testConfigDir = join(
      tmpdir(),
      `skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(testConfigDir, { recursive: true })

    // Generate test identity
    testIdentity = await generateIdentity()
    testRecipient = await identityToRecipient(testIdentity)
  })

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
  })

  describe('encryption flow', () => {
    it('should encrypt and decrypt a single key=value pair', async () => {
      const encrypter = new Encrypter()
      encrypter.addRecipient(testRecipient)
      const encrypted = await encrypter.encrypt('TEST_KEY=test_value\n')

      const decrypter = new Decrypter()
      decrypter.addIdentity(testIdentity)
      const decrypted = await decrypter.decrypt(encrypted, 'text')

      expect(decrypted.trim()).toBe('TEST_KEY=test_value')
    })

    it('should encrypt and decrypt multiple key=value pairs', async () => {
      const content = 'KEY1=value1\nKEY2=value2\nKEY3=value3\n'

      const encrypter = new Encrypter()
      encrypter.addRecipient(testRecipient)
      const encrypted = await encrypter.encrypt(content)

      const decrypter = new Decrypter()
      decrypter.addIdentity(testIdentity)
      const decrypted = await decrypter.decrypt(encrypted, 'text')

      expect(decrypted.trim()).toBe(content.trim())
    })

    it('should parse decrypted content into config object', async () => {
      const content = 'KEY1=value1\nKEY2=value2\n'

      const encrypter = new Encrypter()
      encrypter.addRecipient(testRecipient)
      const encrypted = await encrypter.encrypt(content)

      const decrypter = new Decrypter()
      decrypter.addIdentity(testIdentity)
      const decrypted = await decrypter.decrypt(encrypted, 'text')

      const config: Record<string, string> = {}
      for (const line of decrypted.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const eqIndex = trimmed.indexOf('=')
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex)
          const value = trimmed.substring(eqIndex + 1)
          config[key] = value
        }
      }

      expect(config).toEqual({
        KEY1: 'value1',
        KEY2: 'value2',
      })
    })
  })

  describe('KEY=value parsing', () => {
    function parseKeyValue(
      input: string
    ): { key: string; value: string } | null {
      const match = input.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (!match) return null
      const key = match[1]
      const value = match[2]
      if (!key || value === undefined) return null
      return { key, value }
    }

    it('should parse valid KEY=value format', () => {
      expect(parseKeyValue('DATABASE_URL=postgresql://localhost')).toEqual({
        key: 'DATABASE_URL',
        value: 'postgresql://localhost',
      })
    })

    it('should parse key with empty value', () => {
      expect(parseKeyValue('EMPTY_KEY=')).toEqual({
        key: 'EMPTY_KEY',
        value: '',
      })
    })

    it('should parse value with equals signs', () => {
      expect(parseKeyValue('BASE64=aGVsbG89d29ybGQ=')).toEqual({
        key: 'BASE64',
        value: 'aGVsbG89d29ybGQ=',
      })
    })

    it('should reject invalid formats', () => {
      expect(parseKeyValue('no-equals-sign')).toBeNull()
      expect(parseKeyValue('lowercase=value')).toBeNull()
      expect(parseKeyValue('123KEY=value')).toBeNull()
    })
  })

  describe('age identity generation', () => {
    it('should generate valid age identity', async () => {
      const identity = await generateIdentity()
      expect(identity).toMatch(/^AGE-SECRET-KEY-1[A-Z0-9]+$/)
    })

    it('should derive recipient from identity', async () => {
      const identity = await generateIdentity()
      const recipient = await identityToRecipient(identity)
      expect(recipient).toMatch(/^age1[a-z0-9]+$/)
    })

    it('should generate unique identities', async () => {
      const identity1 = await generateIdentity()
      const identity2 = await generateIdentity()
      expect(identity1).not.toBe(identity2)
    })
  })
})
