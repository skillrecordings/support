import { timingSafeEqual } from 'crypto'
import type { SupportIntegration } from './integration'
import type { ContentSearchRequest, ContentSearchResponse } from './types'

/**
 * Configuration for createSupportHandler
 */
export interface SupportHandlerConfig {
  integration: SupportIntegration
  webhookSecret: string
}

/**
 * Request body for webhook actions
 */
interface WebhookRequest {
  action: string
  [key: string]: unknown
}

/**
 * Creates a Next.js API route handler for SupportIntegration.
 * Verifies HMAC-SHA256 signature and routes actions to integration methods.
 *
 * Signature format: timestamp=1234567890,v1=hex_signature
 * Payload to sign: timestamp.JSON.stringify(body)
 * Replay protection: 5 minute window
 *
 * @example
 * ```typescript
 * import { createSupportHandler } from '@skillrecordings/sdk/handler'
 * import { integration } from './integration'
 *
 * export const POST = createSupportHandler({
 *   integration,
 *   webhookSecret: process.env.SUPPORT_WEBHOOK_SECRET!,
 * })
 * ```
 */
export function createSupportHandler(
  config: SupportHandlerConfig
): (request: Request) => Promise<Response> {
  const { integration, webhookSecret } = config

  return async function handler(request: Request): Promise<Response> {
    try {
      // 1. Extract signature header
      const signatureHeader = request.headers.get('x-support-signature')
      if (!signatureHeader) {
        return jsonResponse({ error: 'Missing signature header' }, 401)
      }

      // 2. Parse signature header (format: timestamp=1234567890,v1=hex_signature)
      const parts = signatureHeader.split(',')
      const timestampPart = parts.find((p) => p.startsWith('timestamp='))
      const signaturePart = parts.find((p) => p.startsWith('v1='))

      if (!timestampPart || !signaturePart) {
        return jsonResponse({ error: 'Invalid signature format' }, 401)
      }

      const timestampValue = timestampPart.split('=')[1]
      const signatureValue = signaturePart.split('=')[1]

      if (!timestampValue || !signatureValue) {
        return jsonResponse({ error: 'Invalid signature format' }, 401)
      }

      const timestamp = parseInt(timestampValue, 10)
      const receivedSignature = signatureValue

      // 3. Verify timestamp (replay protection - 5 minute window)
      const now = Math.floor(Date.now() / 1000)
      const maxAge = 300 // 5 minutes in seconds
      if (now - timestamp > maxAge) {
        return jsonResponse({ error: 'Signature expired' }, 401)
      }

      // 4. Read and parse body
      const bodyText = await request.text()
      let body: WebhookRequest

      try {
        body = JSON.parse(bodyText)
      } catch (err) {
        return jsonResponse({ error: 'Invalid JSON body' }, 400)
      }

      // 5. Compute expected signature
      const crypto = await import('crypto')
      const payload = `${timestamp}.${bodyText}`
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex')

      // 6. Timing-safe comparison to prevent timing attacks
      if (
        !timingSafeEqual(
          Buffer.from(receivedSignature),
          Buffer.from(expectedSignature)
        )
      ) {
        return jsonResponse({ error: 'Invalid signature' }, 401)
      }

      // 7. Extract action field
      const { action } = body
      if (!action || typeof action !== 'string') {
        return jsonResponse({ error: 'Missing action field' }, 400)
      }

      // 8. Route to integration method
      const result = await routeAction(integration, action, body)
      return jsonResponse(result.data, result.status)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return jsonResponse({ error: `Internal error: ${message}` }, 500)
    }
  }
}

/**
 * Routes action to appropriate integration method
 */
async function routeAction(
  integration: SupportIntegration,
  action: string,
  body: WebhookRequest
): Promise<{ data: unknown; status: number }> {
  try {
    switch (action) {
      case 'lookupUser': {
        const email = (body as unknown as { email: string }).email
        const result = await integration.lookupUser(email)
        return { data: result, status: 200 }
      }

      case 'getPurchases': {
        const userId = (body as unknown as { userId: string }).userId
        const result = await integration.getPurchases(userId)
        return { data: result, status: 200 }
      }

      case 'revokeAccess': {
        const params = body as unknown as {
          purchaseId: string
          reason: string
          refundId: string
        }
        const result = await integration.revokeAccess({
          purchaseId: params.purchaseId,
          reason: params.reason,
          refundId: params.refundId,
        })
        return { data: result, status: 200 }
      }

      case 'transferPurchase': {
        const params = body as unknown as {
          purchaseId: string
          fromUserId: string
          toEmail: string
        }
        const result = await integration.transferPurchase({
          purchaseId: params.purchaseId,
          fromUserId: params.fromUserId,
          toEmail: params.toEmail,
        })
        return { data: result, status: 200 }
      }

      case 'generateMagicLink': {
        const params = body as unknown as {
          email: string
          expiresIn: number
        }
        const result = await integration.generateMagicLink({
          email: params.email,
          expiresIn: params.expiresIn,
        })
        return { data: result, status: 200 }
      }

      // Optional methods
      case 'getSubscriptions': {
        if (!integration.getSubscriptions) {
          return {
            data: { error: 'Method not implemented: getSubscriptions' },
            status: 501,
          }
        }
        const userId = (body as unknown as { userId: string }).userId
        const result = await integration.getSubscriptions(userId)
        return { data: result, status: 200 }
      }

      case 'updateEmail': {
        if (!integration.updateEmail) {
          return {
            data: { error: 'Method not implemented: updateEmail' },
            status: 501,
          }
        }
        const params = body as unknown as {
          userId: string
          newEmail: string
        }
        const result = await integration.updateEmail({
          userId: params.userId,
          newEmail: params.newEmail,
        })
        return { data: result, status: 200 }
      }

      case 'updateName': {
        if (!integration.updateName) {
          return {
            data: { error: 'Method not implemented: updateName' },
            status: 501,
          }
        }
        const params = body as unknown as {
          userId: string
          newName: string
        }
        const result = await integration.updateName({
          userId: params.userId,
          newName: params.newName,
        })
        return { data: result, status: 200 }
      }

      case 'getClaimedSeats': {
        if (!integration.getClaimedSeats) {
          return {
            data: { error: 'Method not implemented: getClaimedSeats' },
            status: 501,
          }
        }
        const bulkCouponId = (body as unknown as { bulkCouponId: string })
          .bulkCouponId
        const result = await integration.getClaimedSeats(bulkCouponId)
        return { data: result, status: 200 }
      }

      case 'searchContent': {
        if (!integration.searchContent) {
          return {
            data: { error: 'Method not implemented: searchContent' },
            status: 501,
          }
        }
        const params = body as unknown as ContentSearchRequest
        const result: ContentSearchResponse =
          await integration.searchContent(params)
        return { data: result, status: 200 }
      }

      default:
        return {
          data: { error: `Unknown action: ${action}` },
          status: 400,
        }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return {
      data: { error: message },
      status: 500,
    }
  }
}

/**
 * Helper to create JSON responses
 */
function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}
