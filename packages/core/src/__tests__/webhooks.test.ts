import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeSignature,
  parseSignatureHeader,
  verifySignature,
  verifyTimestamp,
  verifyWebhook,
} from '../webhooks/verify'
import type { VerificationOptions, WebhookHeaders } from '../webhooks/types'

describe('webhook verification', () => {
  const testSecret = 'whsec_test_secret'
  const testPayload = '{"event":"test","data":"payload"}'

  describe('parseSignatureHeader', () => {
    it('parses valid signature header', () => {
      const header = 't=[PHONE],v1=abc123,v1=def456'
      const result = parseSignatureHeader(header)

      expect(result).toEqual({
        timestamp: [PHONE],
        signatures: ['abc123', 'def456'],
      })
    })

    it('throws on missing timestamp', () => {
      const header = 'v1=abc123'
      expect(() => parseSignatureHeader(header)).toThrow(
        'Missing timestamp in signature header',
      )
    })

    it('throws on missing signatures', () => {
      const header = 't=[PHONE]'
      expect(() => parseSignatureHeader(header)).toThrow(
        'Missing signatures in signature header',
      )
    })

    it('throws on invalid timestamp', () => {
      const header = 't=notanumber,v1=abc123'
      expect(() => parseSignatureHeader(header)).toThrow(
        'Invalid timestamp in signature header',
      )
    })

    it('throws on malformed header', () => {
      const header = 'malformed'
      expect(() => parseSignatureHeader(header)).toThrow(
        'Invalid signature header format',
      )
    })

    it('ignores unknown keys for forward compatibility', () => {
      const header = 't=[PHONE],v1=abc123,v2=future,unknown=value'
      const result = parseSignatureHeader(header)

      expect(result).toEqual({
        timestamp: [PHONE],
        signatures: ['abc123'],
      })
    })
  })

  describe('computeSignature', () => {
    it('computes HMAC-SHA256 hex signature', () => {
      const payload = '[PHONE].{"test":"data"}'
      const signature = computeSignature(payload, testSecret)

      expect(signature).toMatch(/^[a-f0-9]{64}$/) // SHA256 hex is 64 chars
      expect(signature.length).toBe(64)
    })

    it('produces consistent signatures', () => {
      const payload = '[PHONE].{"test":"data"}'
      const sig1 = computeSignature(payload, testSecret)
      const sig2 = computeSignature(payload, testSecret)

      expect(sig1).toBe(sig2)
    })

    it('produces different signatures for different payloads', () => {
      const sig1 = computeSignature('payload1', testSecret)
      const sig2 = computeSignature('payload2', testSecret)

      expect(sig1).not.toBe(sig2)
    })

    it('produces different signatures for different secrets', () => {
      const payload = 'test'
      const sig1 = computeSignature(payload, 'secret1')
      const sig2 = computeSignature(payload, 'secret2')

      expect(sig1).not.toBe(sig2)
    })
  })

  describe('verifySignature', () => {
    it('verifies valid signature', () => {
      const payload = '[PHONE].{"test":"data"}'
      const signature = computeSignature(payload, testSecret)

      const result = verifySignature(payload, signature, testSecret)
      expect(result).toBe(true)
    })

    it('rejects invalid signature', () => {
      const payload = '[PHONE].{"test":"data"}'
      const wrongSignature = 'a'.repeat(64)

      const result = verifySignature(payload, wrongSignature, testSecret)
      expect(result).toBe(false)
    })

    it('rejects signature with wrong secret', () => {
      const payload = '[PHONE].{"test":"data"}'
      const signature = computeSignature(payload, 'wrong_secret')

      const result = verifySignature(payload, signature, testSecret)
      expect(result).toBe(false)
    })

    it('rejects signature with mismatched length', () => {
      const payload = '[PHONE].{"test":"data"}'
      const shortSignature = 'abc'

      const result = verifySignature(payload, shortSignature, testSecret)
      expect(result).toBe(false)
    })
  })

  describe('verifyTimestamp', () => {
    let nowSeconds: number

    beforeEach(() => {
      nowSeconds = Math.floor(Date.now() / 1000)
    })

    it('accepts recent timestamp', () => {
      const result = verifyTimestamp(nowSeconds)
      expect(result).toBe(true)
    })

    it('accepts timestamp within maxAge window', () => {
      const fourMinutesAgo = nowSeconds - 4 * 60
      const result = verifyTimestamp(fourMinutesAgo, 5 * 60 * 1000)
      expect(result).toBe(true)
    })

    it('rejects timestamp outside maxAge window', () => {
      const sixMinutesAgo = nowSeconds - 6 * 60
      const result = verifyTimestamp(sixMinutesAgo, 5 * 60 * 1000)
      expect(result).toBe(false)
    })

    it('rejects future timestamp beyond clock skew', () => {
      const tenSecondsInFuture = nowSeconds + 10
      const result = verifyTimestamp(tenSecondsInFuture)
      expect(result).toBe(false)
    })

    it('accepts small clock skew in future', () => {
      const threeSecondsInFuture = nowSeconds + 3
      const result = verifyTimestamp(threeSecondsInFuture)
      expect(result).toBe(true)
    })

    it('respects custom maxAge', () => {
      const twoMinutesAgo = nowSeconds - 2 * 60
      const result = verifyTimestamp(twoMinutesAgo, 1 * 60 * 1000)
      expect(result).toBe(false)
    })
  })

  describe('verifyWebhook', () => {
    let nowSeconds: number
    let validSignature: string
    let validHeaders: WebhookHeaders
    let validOptions: VerificationOptions

    beforeEach(() => {
      nowSeconds = Math.floor(Date.now() / 1000)
      const signedPayload = `${nowSeconds}.${testPayload}`
      validSignature = computeSignature(signedPayload, testSecret)
      validHeaders = {
        'x-support-signature': `t=${nowSeconds},v1=${validSignature}`,
      }
      validOptions = {
        secrets: [testSecret],
      }
    })

    it('verifies valid webhook', () => {
      const result = verifyWebhook(testPayload, validHeaders, validOptions)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('supports x-front-signature header', () => {
      const headers: WebhookHeaders = {
        'x-front-signature': `t=${nowSeconds},v1=${validSignature}`,
      }
      const options: VerificationOptions = {
        ...validOptions,
        signatureHeader: 'x-front-signature',
      }

      const result = verifyWebhook(testPayload, headers, options)

      expect(result.valid).toBe(true)
    })

    it('rejects missing signature header', () => {
      const result = verifyWebhook(testPayload, {}, validOptions)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Missing x-support-signature header')
    })

    it('rejects when no secrets provided', () => {
      const result = verifyWebhook(testPayload, validHeaders, { secrets: [] })

      expect(result.valid).toBe(false)
      expect(result.error).toBe('No webhook secrets provided')
    })

    it('rejects malformed signature header', () => {
      const headers: WebhookHeaders = {
        'x-support-signature': 'malformed',
      }

      const result = verifyWebhook(testPayload, headers, validOptions)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid signature header')
    })

    it('rejects expired timestamp', () => {
      const tenMinutesAgo = nowSeconds - 10 * 60
      const expiredSignedPayload = `${tenMinutesAgo}.${testPayload}`
      const expiredSignature = computeSignature(
        expiredSignedPayload,
        testSecret,
      )
      const headers: WebhookHeaders = {
        'x-support-signature': `t=${tenMinutesAgo},v1=${expiredSignature}`,
      }

      const result = verifyWebhook(testPayload, headers, validOptions)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timestamp outside acceptable window')
    })

    it('rejects invalid signature', () => {
      const wrongSignature = 'a'.repeat(64)
      const headers: WebhookHeaders = {
        'x-support-signature': `t=${nowSeconds},v1=${wrongSignature}`,
      }

      const result = verifyWebhook(testPayload, headers, validOptions)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('No valid signature found')
    })

    it('supports key rotation with multiple secrets', () => {
      const oldSecret = 'old_secret'
      const signedPayload = `${nowSeconds}.${testPayload}`
      const oldSignature = computeSignature(signedPayload, oldSecret)
      const headers: WebhookHeaders = {
        'x-support-signature': `t=${nowSeconds},v1=${oldSignature}`,
      }
      const options: VerificationOptions = {
        secrets: [testSecret, oldSecret], // Multiple secrets
      }

      const result = verifyWebhook(testPayload, headers, options)

      expect(result.valid).toBe(true)
    })

    it('supports multiple signatures in header', () => {
      const newSecret = 'new_secret'
      const signedPayload = `${nowSeconds}.${testPayload}`
      const newSignature = computeSignature(signedPayload, newSecret)
      const headers: WebhookHeaders = {
        'x-support-signature': `t=${nowSeconds},v1=${validSignature},v1=${newSignature}`,
      }
      const options: VerificationOptions = {
        secrets: [newSecret],
      }

      const result = verifyWebhook(testPayload, headers, options)

      expect(result.valid).toBe(true)
    })

    it('respects custom maxAge', () => {
      const threeMinutesAgo = nowSeconds - 3 * 60
      const signedPayload = `${threeMinutesAgo}.${testPayload}`
      const signature = computeSignature(signedPayload, testSecret)
      const headers: WebhookHeaders = {
        'x-support-signature': `t=${threeMinutesAgo},v1=${signature}`,
      }
      const options: VerificationOptions = {
        secrets: [testSecret],
        maxAgeMs: 2 * 60 * 1000, // 2 minutes
      }

      const result = verifyWebhook(testPayload, headers, options)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timestamp outside acceptable window')
    })
  })

  describe('integration: Stripe-style webhook flow', () => {
    it('verifies complete webhook flow', () => {
      // Simulate webhook sender (e.g., Front)
      const secret = 'whsec_production_key'
      const payload = JSON.stringify({
        type: 'conversation.inbound_received',
        conversation_id: 'cnv_123',
      })
      const timestamp = Math.floor(Date.now() / 1000)
      const signedPayload = `${timestamp}.${payload}`
      const signature = computeSignature(signedPayload, secret)

      // Simulate webhook receiver
      const headers: WebhookHeaders = {
        'x-front-signature': `t=${timestamp},v1=${signature}`,
      }
      const options: VerificationOptions = {
        secrets: [secret],
        signatureHeader: 'x-front-signature',
      }

      const result = verifyWebhook(payload, headers, options)

      expect(result.valid).toBe(true)
    })
  })
})
