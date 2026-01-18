/**
 * Webhook signature verification
 *
 * HMAC-SHA256 verification with replay protection per PRD 63-webhook-signing.
 * Format: x-support-signature: t=<timestamp>,v1=<signature>,v1=<signature>,...
 *
 * Verifies: HMAC-SHA256(timestamp + "." + rawBody, webhookSecret)
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  ParsedSignature,
  VerificationOptions,
  VerificationResult,
  WebhookHeaders,
} from './types'

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Parse signature header into components
 *
 * @param header - Signature header in format: t=<timestamp>,v1=<sig1>,v1=<sig2>,...
 * @returns Parsed timestamp and signatures
 * @throws Error if header format is invalid
 */
export function parseSignatureHeader(header: string): ParsedSignature {
  const parts = header.split(',')
  let timestamp: number | undefined
  const signatures: string[] = []

  for (const part of parts) {
    const [key, value] = part.split('=')
    if (!key || !value) {
      throw new Error('Invalid signature header format')
    }

    if (key === 't') {
      timestamp = Number.parseInt(value, 10)
      if (Number.isNaN(timestamp)) {
        throw new Error('Invalid timestamp in signature header')
      }
    } else if (key === 'v1') {
      signatures.push(value)
    }
    // Ignore unknown keys for forward compatibility
  }

  if (timestamp === undefined) {
    throw new Error('Missing timestamp in signature header')
  }

  if (signatures.length === 0) {
    throw new Error('Missing signatures in signature header')
  }

  return { timestamp, signatures }
}

/**
 * Compute HMAC-SHA256 signature for webhook payload
 *
 * @param payload - String to sign (format: "<timestamp>.<body>")
 * @param secret - Webhook secret
 * @returns Hex-encoded signature
 */
export function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Verify a single signature against payload using timing-safe comparison
 *
 * @param payload - Signed payload (format: "<timestamp>.<body>")
 * @param signature - Expected signature (hex-encoded)
 * @param secret - Webhook secret
 * @returns True if signature matches
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = computeSignature(payload, secret)
  const expectedBuf = Buffer.from(expected, 'hex')
  const signatureBuf = Buffer.from(signature, 'hex')

  // Protect against length mismatch (timingSafeEqual requires equal lengths)
  if (expectedBuf.length !== signatureBuf.length) {
    return false
  }

  return timingSafeEqual(expectedBuf, signatureBuf)
}

/**
 * Verify timestamp is within acceptable age window (replay protection)
 *
 * @param timestamp - Unix timestamp in seconds
 * @param maxAgeMs - Maximum age in milliseconds (default: 300000 = 5 minutes)
 * @returns True if timestamp is recent enough
 */
export function verifyTimestamp(
  timestamp: number,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const ageSeconds = nowSeconds - timestamp

  // Reject if timestamp is in the future (allow 5 second clock skew)
  if (ageSeconds < -5) {
    return false
  }

  // Reject if timestamp is too old
  const maxAgeSeconds = Math.floor(maxAgeMs / 1000)
  return ageSeconds <= maxAgeSeconds
}

/**
 * Verify webhook signature and timestamp (combined verification)
 *
 * This is the main entry point for webhook verification. It:
 * 1. Extracts signature header
 * 2. Parses timestamp and signatures
 * 3. Verifies timestamp (replay protection)
 * 4. Verifies at least one signature matches with one secret (key rotation)
 *
 * @param payload - Raw webhook body string
 * @param headers - Webhook request headers
 * @param options - Verification options (secrets and optional settings)
 * @returns Verification result with success flag and optional error
 */
export function verifyWebhook(
  payload: string,
  headers: WebhookHeaders,
  options: VerificationOptions,
): VerificationResult {
  const { maxAgeMs = DEFAULT_MAX_AGE_MS, secrets, signatureHeader } = options

  if (secrets.length === 0) {
    return {
      valid: false,
      error: 'No webhook secrets provided',
    }
  }

  // Extract signature header (support both x-support-signature and x-front-signature)
  const headerName = signatureHeader ?? 'x-support-signature'
  const signatureHeaderValue = headers[headerName]

  if (!signatureHeaderValue) {
    return {
      valid: false,
      error: `Missing ${headerName} header`,
    }
  }

  // Parse signature header
  let parsed: ParsedSignature
  try {
    parsed = parseSignatureHeader(signatureHeaderValue)
  } catch (error) {
    return {
      valid: false,
      error:
        error instanceof Error ? error.message : 'Invalid signature header',
    }
  }

  // Verify timestamp (replay protection)
  if (!verifyTimestamp(parsed.timestamp, maxAgeMs)) {
    return {
      valid: false,
      error: 'Webhook timestamp outside acceptable window (replay protection)',
    }
  }

  // Build signed payload: "<timestamp>.<body>"
  const signedPayload = `${parsed.timestamp}.${payload}`

  // Verify at least one signature matches with one secret (supports key rotation)
  const isValid = secrets.some((secret) =>
    parsed.signatures.some((signature) =>
      verifySignature(signedPayload, signature, secret),
    ),
  )

  if (!isValid) {
    return {
      valid: false,
      error: 'No valid signature found',
    }
  }

  return { valid: true }
}
