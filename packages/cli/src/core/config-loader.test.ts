import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type KeyProvenance,
  _setProvenanceForTesting,
  getKeyProvenance,
  isUserKey,
  loadConfigChain,
  loadPlaintextEnv,
} from './config-loader'

describe('config-loader', () => {
  let tempDir: string
  let tempCliRoot: string
  let tempConfigDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'config-loader-test-'))
    tempCliRoot = join(tempDir, 'cli')
    tempConfigDir = join(tempDir, 'config')
    // Create the directories
    mkdirSync(tempCliRoot, { recursive: true })
    mkdirSync(tempConfigDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('loadPlaintextEnv', () => {
    it('loads .env.local if it exists', () => {
      const envContent = `
        # Comment
        FOO=bar
        BAZ="quoted value"
      `
      writeFileSync(join(tempCliRoot, '.env.local'), envContent)

      const result = loadPlaintextEnv(tempCliRoot)

      expect(result).toEqual({
        FOO: 'bar',
        BAZ: 'quoted value',
      })
    })

    it('falls back to .env if .env.local does not exist', () => {
      const envContent = 'KEY=value\n'
      writeFileSync(join(tempCliRoot, '.env'), envContent)

      const result = loadPlaintextEnv(tempCliRoot)

      expect(result).toEqual({
        KEY: 'value',
      })
    })

    it('returns empty object if no env files exist', () => {
      const result = loadPlaintextEnv(tempCliRoot)

      expect(result).toEqual({})
    })

    it('strips comments and empty lines', () => {
      const envContent = `
        # This is a comment

        KEY1=value1
        # Another comment
        KEY2=value2

      `
      writeFileSync(join(tempCliRoot, '.env.local'), envContent)

      const result = loadPlaintextEnv(tempCliRoot)

      expect(result).toEqual({
        KEY1: 'value1',
        KEY2: 'value2',
      })
    })

    it('strips surrounding quotes', () => {
      const envContent = `
        SINGLE='single quotes'
        DOUBLE="double quotes"
        NONE=no quotes
      `
      writeFileSync(join(tempCliRoot, '.env.local'), envContent)

      const result = loadPlaintextEnv(tempCliRoot)

      expect(result).toEqual({
        SINGLE: 'single quotes',
        DOUBLE: 'double quotes',
        NONE: 'no quotes',
      })
    })
  })

  describe('loadConfigChain', () => {
    it('returns empty env and provenance when no encrypted files exist', async () => {
      const result = await loadConfigChain(tempCliRoot, tempConfigDir)

      expect(result.env).toEqual({})
      expect(result.provenance.size).toBe(0)
    })

    // TODO: Add tests for decryption once worker-1 implements decryptEnvFile
    it.todo(
      'loads shipped defaults from packages/cli/.env.encrypted when decryption is implemented'
    )
    it.todo(
      'loads user overrides from ~/.config/skill/.env.user.encrypted when decryption is implemented'
    )
    it.todo(
      'user values override shipped values when decryption is implemented'
    )
    it.todo('tracks provenance correctly when decryption is implemented')
  })

  describe('getKeyProvenance', () => {
    afterEach(() => {
      // Reset global state after each test
      _setProvenanceForTesting(new Map())
    })

    it('returns user for user-provided keys', () => {
      const provenance = new Map<string, KeyProvenance>([
        ['USER_KEY', 'user'],
        ['SHIPPED_KEY', 'shipped'],
      ])
      _setProvenanceForTesting(provenance)

      expect(getKeyProvenance('USER_KEY')).toBe('user')
    })

    it('returns shipped for shipped keys', () => {
      const provenance = new Map<string, KeyProvenance>([
        ['USER_KEY', 'user'],
        ['SHIPPED_KEY', 'shipped'],
      ])
      _setProvenanceForTesting(provenance)

      expect(getKeyProvenance('SHIPPED_KEY')).toBe('shipped')
    })

    it('returns undefined for missing keys', () => {
      _setProvenanceForTesting(new Map())

      expect(getKeyProvenance('MISSING')).toBeUndefined()
    })
  })

  describe('isUserKey', () => {
    afterEach(() => {
      // Reset global state after each test
      _setProvenanceForTesting(new Map())
    })

    it('returns true for user-provided keys', () => {
      const provenance = new Map<string, KeyProvenance>([
        ['USER_KEY', 'user'],
        ['SHIPPED_KEY', 'shipped'],
      ])
      _setProvenanceForTesting(provenance)

      expect(isUserKey('USER_KEY')).toBe(true)
    })

    it('returns false for shipped keys', () => {
      const provenance = new Map<string, KeyProvenance>([
        ['USER_KEY', 'user'],
        ['SHIPPED_KEY', 'shipped'],
      ])
      _setProvenanceForTesting(provenance)

      expect(isUserKey('SHIPPED_KEY')).toBe(false)
    })

    it('returns false for missing keys', () => {
      _setProvenanceForTesting(new Map())

      expect(isUserKey('MISSING')).toBe(false)
    })
  })
})
