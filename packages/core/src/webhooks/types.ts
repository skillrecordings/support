/**
 * Webhook verification types
 *
 * Supports Stripe-style HMAC-SHA256 webhook signature verification
 * with replay protection and key rotation.
 */

/**
 * Raw webhook payload received from external service
 */
export interface WebhookPayload {
  /** Raw body string (pre-parsed) */
  body: string
  /** Headers from the webhook request */
  headers: WebhookHeaders
}

/**
 * Headers expected in webhook requests
 */
export interface WebhookHeaders {
  /** Signature header in format: t=<timestamp>,v1=<sig1>,v1=<sig2>,... */
  'x-support-signature'?: string
  /** Alternative header name for Front-specific webhooks */
  'x-front-signature'?: string
  [key: string]: string | undefined
}

/**
 * Parsed signature header components
 */
export interface ParsedSignature {
  /** Unix timestamp in seconds when signature was generated */
  timestamp: number
  /** Array of signature strings (hex-encoded) for key rotation support */
  signatures: string[]
}

/**
 * Result of webhook verification
 */
export interface VerificationResult {
  /** Whether the webhook passed all verification checks */
  valid: boolean
  /** Reason for verification failure (if any) */
  error?: string
}

/**
 * Options for webhook verification
 */
export interface VerificationOptions {
  /** Maximum age of webhook in milliseconds (default: 300000 = 5 minutes) */
  maxAgeMs?: number
  /** Webhook secrets to try (supports key rotation) */
  secrets: string[]
  /** Signature header name to use (default: x-support-signature) */
  signatureHeader?: 'x-support-signature' | 'x-front-signature'
}
