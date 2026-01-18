import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies a Slack request signature using HMAC-SHA256.
 *
 * Algorithm:
 * 1. Get X-Slack-Request-Timestamp and X-Slack-Signature headers
 * 2. Construct basestring: v0:{timestamp}:{rawBody}
 * 3. Compute HMAC: 'v0=' + HMAC-SHA256(SLACK_SIGNING_SECRET, basestring).hex
 * 4. Compare using timingSafeEqual to prevent timing attacks
 * 5. Reject if timestamp > 5 minutes old (replay protection)
 *
 * @param opts - Verification options
 * @param opts.signature - X-Slack-Signature header value (format: v0=hash)
 * @param opts.timestamp - X-Slack-Request-Timestamp header value (unix seconds)
 * @param opts.body - Raw request body string
 * @param opts.secret - Signing secret (defaults to process.env.SLACK_SIGNING_SECRET)
 * @returns true if signature is valid and fresh, false otherwise
 * @throws Error if secret is not provided and env var is missing
 */
export function verifySlackSignature(opts: {
  signature: string
  timestamp: string
  body: string
  secret?: string
}): boolean {
  const { signature, timestamp, body, secret = process.env.SLACK_SIGNING_SECRET } = opts

  // Validate secret exists
  if (!secret) {
    throw new Error('SLACK_SIGNING_SECRET is required')
  }

  // Validate signature format
  if (!signature || !signature.startsWith('v0=')) {
    return false
  }

  // Replay protection: reject requests older than 5 minutes
  const requestTimestamp = parseInt(timestamp, 10)
  const currentTimestamp = Math.floor(Date.now() / 1000)
  const fiveMinutesInSeconds = 5 * 60

  if (isNaN(requestTimestamp) || currentTimestamp - requestTimestamp > fiveMinutesInSeconds) {
    return false
  }

  // Construct basestring
  const basestring = `v0:${timestamp}:${body}`

  // Compute expected signature
  const expectedSignature = 'v0=' + createHmac('sha256', secret).update(basestring).digest('hex')

  // Timing-safe comparison to prevent timing attacks
  try {
    // Both signatures must be same length for timingSafeEqual
    if (signature.length !== expectedSignature.length) {
      return false
    }

    const signatureBuffer = Buffer.from(signature, 'utf8')
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8')

    return timingSafeEqual(signatureBuffer, expectedBuffer)
  } catch {
    return false
  }
}
