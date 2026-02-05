import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type KeyProvenance,
  _setProvenanceForTesting,
} from './config-loader.js'
import { CLIError, EXIT_CODES } from './errors.js'
import {
  WRITE_GATED_KEYS,
  isWriteGatedKey,
  requirePersonalKey,
} from './write-gate.js'

describe('write-gate', () => {
  describe('WRITE_GATED_KEYS', () => {
    it('includes expected keys', () => {
      expect(WRITE_GATED_KEYS).toContain('LINEAR_API_KEY')
      expect(WRITE_GATED_KEYS).toContain('STRIPE_SECRET_KEY')
      expect(WRITE_GATED_KEYS).toContain('FRONT_API_TOKEN')
      expect(WRITE_GATED_KEYS).toContain('INNGEST_EVENT_KEY')
    })

    it('is a const array', () => {
      // TypeScript enforces readonly at compile time
      // Runtime: it's a regular array, but we treat it as immutable
      expect(Array.isArray(WRITE_GATED_KEYS)).toBe(true)
      expect(WRITE_GATED_KEYS.length).toBeGreaterThan(0)
    })
  })

  describe('isWriteGatedKey', () => {
    it('returns true for write-gated keys', () => {
      expect(isWriteGatedKey('LINEAR_API_KEY')).toBe(true)
      expect(isWriteGatedKey('STRIPE_SECRET_KEY')).toBe(true)
    })

    it('returns false for non-gated keys', () => {
      expect(isWriteGatedKey('SOME_OTHER_KEY')).toBe(false)
      expect(isWriteGatedKey('DATABASE_URL')).toBe(false)
    })
  })

  describe('requirePersonalKey', () => {
    afterEach(() => {
      _setProvenanceForTesting(new Map())
    })

    it('succeeds when key is from user config', () => {
      _setProvenanceForTesting(new Map([['LINEAR_API_KEY', 'user']]))
      expect(() => requirePersonalKey('LINEAR_API_KEY')).not.toThrow()
    })

    it('throws CLIError when key is from shipped defaults', () => {
      _setProvenanceForTesting(new Map([['LINEAR_API_KEY', 'shipped']]))

      expect(() => requirePersonalKey('LINEAR_API_KEY')).toThrow(CLIError)

      try {
        requirePersonalKey('LINEAR_API_KEY')
      } catch (error) {
        expect(error).toBeInstanceOf(CLIError)
        expect((error as CLIError).exitCode).toBe(EXIT_CODES.auth)
        expect((error as CLIError).userMessage).toContain('personal API key')
        expect((error as CLIError).suggestion).toContain('skill keys add')
      }
    })

    it('throws CLIError when key is undefined', () => {
      _setProvenanceForTesting(new Map())

      expect(() => requirePersonalKey('LINEAR_API_KEY')).toThrow(CLIError)

      try {
        requirePersonalKey('LINEAR_API_KEY')
      } catch (error) {
        expect(error).toBeInstanceOf(CLIError)
        expect((error as CLIError).exitCode).toBe(EXIT_CODES.auth)
      }
    })

    it('includes helpful error message components', () => {
      _setProvenanceForTesting(new Map([['STRIPE_SECRET_KEY', 'shipped']]))

      try {
        requirePersonalKey('STRIPE_SECRET_KEY')
      } catch (error) {
        const cliError = error as CLIError
        expect(cliError.userMessage).toContain('STRIPE_SECRET_KEY')
        expect(cliError.userMessage).toContain('Write operations')
        expect(cliError.suggestion).toContain('skill keys add')
      }
    })
  })
})
