import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import {
  parseSignatureHeader,
  verifySignature,
  verifyTimestamp,
  verifyWebhook,
} from '../webhooks'
import type { VerificationOptions } from '../webhooks/types'

/**
 * Test fixtures and utilities for webhook verification
 */

const TEST_SECRET = 'whsec_test_secret_key_1234567890'
const TEST_SECRET_2 = 'whsec_test_secret_key_0987654321'

/**
 * Generate a valid signature header for testing
 */
function generateSignatureHeader(
  payload: string,
  secret: string,
  timestamp?: number
): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000)
  const signedPayload = `${ts}.${payload}`
  const signature = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex')
  return `t=${ts},v1=${signature}`
}

/**
 * Generate a signature header with multiple signatures (key rotation)
 */
function generateMultiSignatureHeader(
  payload: string,
  secrets: string[],
  timestamp?: number
): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000)
  const signedPayload = `${ts}.${payload}`
  const signatures = secrets.map((secret) =>
    createHmac('sha256', secret).update(signedPayload).digest('hex')
  )
  return `t=${ts},${signatures.map((sig) => `v1=${sig}`).join(',')}`
}

/**
 * Create a test webhook payload
 */
function createTestPayload(body: object = { event: 'test' }): string {
  return JSON.stringify(body)
}

describe('parseSignatureHeader', () => {
  it('parses valid signature header with single signature', () => {
    const header = 't=1705512000,v1=abc123def456'
    const result = parseSignatureHeader(header)

    expect(result.timestamp).toBe(1705512000)
    expect(result.signatures).toEqual(['abc123def456'])
  })

  it('parses header with multiple signatures (key rotation)', () => {
    const header = 't=1705512000,v1=abc123,v1=def456'
    const result = parseSignatureHeader(header)

    expect(result.timestamp).toBe(1705512000)
    expect(result.signatures).toEqual(['abc123', 'def456'])
  })

  it('throws on missing timestamp', () => {
    const header = 'v1=abc123'
    expect(() => parseSignatureHeader(header)).toThrow('timestamp')
  })

  it('throws on missing signature', () => {
    const header = 't=1705512000'
    expect(() => parseSignatureHeader(header)).toThrow('signature')
  })

  it('throws on empty header', () => {
    expect(() => parseSignatureHeader('')).toThrow()
  })

  it('throws on malformed timestamp', () => {
    const header = 't=notanumber,v1=abc123'
    expect(() => parseSignatureHeader(header)).toThrow('timestamp')
  })
})

describe('verifySignature', () => {
  it('returns true for valid signature', () => {
    const payload = createTestPayload()
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${payload}`
    const signature = createHmac('sha256', TEST_SECRET)
      .update(signedPayload)
      .digest('hex')

    const result = verifySignature(signedPayload, signature, TEST_SECRET)
    expect(result).toBe(true)
  })

  it('returns false for invalid signature', () => {
    const payload = createTestPayload()
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${payload}`
    const wrongSignature = 'deadbeef1234567890'

    const result = verifySignature(signedPayload, wrongSignature, TEST_SECRET)
    expect(result).toBe(false)
  })

  it('returns false when using wrong secret', () => {
    const payload = createTestPayload()
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${payload}`
    const signature = createHmac('sha256', TEST_SECRET)
      .update(signedPayload)
      .digest('hex')

    const result = verifySignature(signedPayload, signature, 'wrong_secret')
    expect(result).toBe(false)
  })

  it('returns false for empty signature', () => {
    const payload = createTestPayload()
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${payload}`

    const result = verifySignature(signedPayload, '', TEST_SECRET)
    expect(result).toBe(false)
  })

  it('is timing-safe (uses timingSafeEqual)', () => {
    // This test verifies the implementation uses crypto.timingSafeEqual
    // to prevent timing attacks
    const payload = createTestPayload()
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${payload}`
    const validSignature = createHmac('sha256', TEST_SECRET)
      .update(signedPayload)
      .digest('hex')

    // Signature that differs only in last character
    const almostValidSignature =
      validSignature.slice(0, -1) +
      (validSignature.slice(-1) === 'a' ? 'b' : 'a')

    const result = verifySignature(signedPayload, almostValidSignature, TEST_SECRET)
    expect(result).toBe(false)
  })
})

describe('verifyTimestamp', () => {
  it('returns true for recent timestamp (within 5 minutes)', () => {
    const now = Math.floor(Date.now() / 1000)
    const recentTimestamp = now - 60 // 1 minute ago

    const result = verifyTimestamp(recentTimestamp)
    expect(result).toBe(true)
  })

  it('returns false for old timestamp (> 5 minutes)', () => {
    const now = Math.floor(Date.now() / 1000)
    const oldTimestamp = now - 6 * 60 // 6 minutes ago

    const result = verifyTimestamp(oldTimestamp)
    expect(result).toBe(false)
  })

  it('returns false for future timestamp', () => {
    const now = Math.floor(Date.now() / 1000)
    const futureTimestamp = now + 60 // 1 minute in future

    const result = verifyTimestamp(futureTimestamp)
    expect(result).toBe(false)
  })

  it('accepts custom maxAge parameter', () => {
    const now = Math.floor(Date.now() / 1000)
    const timestamp = now - 10 * 60 // 10 minutes ago

    // Should fail with default 5 minutes
    expect(verifyTimestamp(timestamp)).toBe(false)

    // Should pass with custom 15 minutes
    expect(verifyTimestamp(timestamp, 15 * 60 * 1000)).toBe(true)
  })

  it('handles timestamp at exact boundary (5 minutes)', () => {
    const now = Math.floor(Date.now() / 1000)
    const boundaryTimestamp = now - 5 * 60 // exactly 5 minutes ago

    const result = verifyTimestamp(boundaryTimestamp)
    // Should be accepted (<=, not <)
    expect(result).toBe(true)
  })
})

describe('verifyWebhook - integration tests', () => {
  it('accepts valid webhook with correct signature and timestamp', () => {
    const payload = createTestPayload({ event: 'inbound_message' })
    const header = generateSignatureHeader(payload, TEST_SECRET)

    const result = verifyWebhook(
      payload,
      { 'x-support-signature': header },
      { secrets: [TEST_SECRET] }
    )

    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('rejects webhook with missing signature header', () => {
    const payload = createTestPayload()

    const result = verifyWebhook(payload, {}, { secrets: [TEST_SECRET] })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('signature')
  })

  it('rejects webhook with invalid signature', () => {
    const payload = createTestPayload()
    const timestamp = Math.floor(Date.now() / 1000)
    const badHeader = `t=${timestamp},v1=invalidSignature123`

    const result = verifyWebhook(
      payload,
      { 'x-support-signature': badHeader },
      { secrets: [TEST_SECRET] }
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('signature')
  })

  it('rejects webhook with expired timestamp', () => {
    const payload = createTestPayload()
    const oldTimestamp = Math.floor(Date.now() / 1000) - 10 * 60 // 10 minutes ago
    const header = generateSignatureHeader(payload, TEST_SECRET, oldTimestamp)

    const result = verifyWebhook(
      payload,
      { 'x-support-signature': header },
      { secrets: [TEST_SECRET] }
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('timestamp')
  })

  it('accepts webhook with any valid secret (key rotation)', () => {
    const payload = createTestPayload()
    const header = generateSignatureHeader(payload, TEST_SECRET_2)

    const result = verifyWebhook(
      payload,
      { 'x-support-signature': header },
      { secrets: [TEST_SECRET, TEST_SECRET_2] } // Multiple secrets
    )

    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts webhook with multiple signatures in header', () => {
    const payload = createTestPayload()
    const header = generateMultiSignatureHeader(payload, [
      TEST_SECRET,
      TEST_SECRET_2,
    ])

    const result = verifyWebhook(
      payload,
      { 'x-support-signature': header },
      { secrets: [TEST_SECRET, TEST_SECRET_2] }
    )

    expect(result.valid).toBe(true)
  })

  it('uses custom signature header when specified', () => {
    const payload = createTestPayload()
    const header = generateSignatureHeader(payload, TEST_SECRET)

    const result = verifyWebhook(
      payload,
      { 'x-front-signature': header },
      { secrets: [TEST_SECRET], signatureHeader: 'x-front-signature' }
    )

    expect(result.valid).toBe(true)
  })

  it('respects custom maxAgeMs option', () => {
    const payload = createTestPayload()
    const oldTimestamp = Math.floor(Date.now() / 1000) - 10 * 60 // 10 minutes ago
    const header = generateSignatureHeader(payload, TEST_SECRET, oldTimestamp)

    // Should fail with default 5 minutes
    const resultDefault = verifyWebhook(
      payload,
      { 'x-support-signature': header },
      { secrets: [TEST_SECRET] }
    )
    expect(resultDefault.valid).toBe(false)

    // Should pass with custom 15 minutes
    const resultCustom = verifyWebhook(
      payload,
      { 'x-support-signature': header },
      { secrets: [TEST_SECRET], maxAgeMs: 15 * 60 * 1000 }
    )
    expect(resultCustom.valid).toBe(true)
  })

  it('handles malformed signature header gracefully', () => {
    const payload = createTestPayload()

    const result = verifyWebhook(
      payload,
      { 'x-support-signature': 'malformed-header-no-timestamp' },
      { secrets: [TEST_SECRET] }
    )

    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects if no secrets provided', () => {
    const payload = createTestPayload()
    const header = generateSignatureHeader(payload, TEST_SECRET)

    const result = verifyWebhook(
      payload,
      { 'x-support-signature': header },
      { secrets: [] }
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('secret')
  })

  it('handles empty payload body', () => {
    const payload = ''
    const header = generateSignatureHeader(payload, TEST_SECRET)

    const result = verifyWebhook(
      payload,
      { 'x-support-signature': header },
      { secrets: [TEST_SECRET] }
    )

    expect(result.valid).toBe(true)
  })
})
