/**
 * Webhook verification module
 *
 * Provides HMAC-SHA256 webhook signature verification with replay protection.
 * Supports Stripe-style signature headers with key rotation.
 *
 * @example
 * ```typescript
 * import { verifyWebhook } from './webhooks'
 *
 * const result = verifyWebhook(
 *   rawBody,
 *   { 'x-support-signature': 't=1705512000,v1=abc123...' },
 *   { secrets: [process.env.WEBHOOK_SECRET] }
 * )
 *
 * if (!result.valid) {
 *   throw new Error(`Webhook verification failed: ${result.error}`)
 * }
 * ```
 */

export type {
  ParsedSignature,
  VerificationOptions,
  VerificationResult,
  WebhookHeaders,
  WebhookPayload,
} from './types'

export {
  computeSignature,
  parseSignatureHeader,
  verifySignature,
  verifyTimestamp,
  verifyWebhook,
} from './verify'
