import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { verifySlackSignature } from './verify-signature'

describe('verifySlackSignature', () => {
  const MOCK_SECRET = 'test-signing-secret-12345'
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.SLACK_SIGNING_SECRET
    process.env.SLACK_SIGNING_SECRET = MOCK_SECRET
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SLACK_SIGNING_SECRET
    } else {
      process.env.SLACK_SIGNING_SECRET = originalEnv
    }
  })

  describe('valid signatures', () => {
    it('should return true for valid signature with default secret from env', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = JSON.stringify({ type: 'event_callback', event: { type: 'app_mention' } })
      const basestring = `v0:${timestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', MOCK_SECRET).update(basestring).digest('hex')

      const result = verifySlackSignature({
        signature,
        timestamp,
        body,
      })

      expect(result).toBe(true)
    })

    it('should return true for valid signature with explicit secret', () => {
      const customSecret = 'custom-secret-xyz'
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = '{"test":"data"}'
      const basestring = `v0:${timestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', customSecret).update(basestring).digest('hex')

      const result = verifySlackSignature({
        signature,
        timestamp,
        body,
        secret: customSecret,
      })

      expect(result).toBe(true)
    })
  })

  describe('invalid signatures', () => {
    it('should return false for invalid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = '{"test":"data"}'
      const signature = 'v0=invalid_signature_hash'

      const result = verifySlackSignature({
        signature,
        timestamp,
        body,
      })

      expect(result).toBe(false)
    })

    it('should return false for signature with tampered body', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const originalBody = '{"test":"data"}'
      const tamperedBody = '{"test":"tampered"}'
      const basestring = `v0:${timestamp}:${originalBody}`
      const signature = 'v0=' + createHmac('sha256', MOCK_SECRET).update(basestring).digest('hex')

      const result = verifySlackSignature({
        signature,
        timestamp,
        body: tamperedBody,
      })

      expect(result).toBe(false)
    })

    it('should return false for signature with wrong secret', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = '{"test":"data"}'
      const basestring = `v0:${timestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', 'wrong-secret').update(basestring).digest('hex')

      const result = verifySlackSignature({
        signature,
        timestamp,
        body,
      })

      expect(result).toBe(false)
    })
  })

  describe('replay protection', () => {
    it('should return false for timestamp older than 5 minutes', () => {
      const fiveMinutesOneSecondAgo = Math.floor(Date.now() / 1000) - 301
      const timestamp = fiveMinutesOneSecondAgo.toString()
      const body = '{"test":"data"}'
      const basestring = `v0:${timestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', MOCK_SECRET).update(basestring).digest('hex')

      const result = verifySlackSignature({
        signature,
        timestamp,
        body,
      })

      expect(result).toBe(false)
    })

    it('should return true for timestamp exactly 5 minutes old', () => {
      const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300
      const timestamp = fiveMinutesAgo.toString()
      const body = '{"test":"data"}'
      const basestring = `v0:${timestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', MOCK_SECRET).update(basestring).digest('hex')

      const result = verifySlackSignature({
        signature,
        timestamp,
        body,
      })

      expect(result).toBe(true)
    })

    it('should return true for recent timestamp within 5 minutes', () => {
      const thirtySecondsAgo = Math.floor(Date.now() / 1000) - 30
      const timestamp = thirtySecondsAgo.toString()
      const body = '{"test":"data"}'
      const basestring = `v0:${timestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', MOCK_SECRET).update(basestring).digest('hex')

      const result = verifySlackSignature({
        signature,
        timestamp,
        body,
      })

      expect(result).toBe(true)
    })
  })

  describe('missing secret', () => {
    it('should throw error when secret is not provided and env var is missing', () => {
      delete process.env.SLACK_SIGNING_SECRET

      expect(() =>
        verifySlackSignature({
          signature: 'v0=test',
          timestamp: '1234567890',
          body: '{}',
        })
      ).toThrow('SLACK_SIGNING_SECRET is required')
    })
  })

  describe('malformed input', () => {
    it('should return false for signature without v0= prefix', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = '{"test":"data"}'
      const basestring = `v0:${timestamp}:${body}`
      const signatureHash = createHmac('sha256', MOCK_SECRET).update(basestring).digest('hex')
      const signature = signatureHash // Missing v0= prefix

      const result = verifySlackSignature({
        signature,
        timestamp,
        body,
      })

      expect(result).toBe(false)
    })

    it('should return false for empty signature', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = '{"test":"data"}'

      const result = verifySlackSignature({
        signature: '',
        timestamp,
        body,
      })

      expect(result).toBe(false)
    })
  })
})
