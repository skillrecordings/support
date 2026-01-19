import { createHmac } from 'node:crypto'
import type {
  ActionResult,
  ClaimedSeat,
  ContentSearchRequest,
  ContentSearchResponse,
  Purchase,
  Subscription,
  SupportIntegration,
  User,
} from './integration'

/**
 * Client for calling app integration endpoints with HMAC-signed requests.
 *
 * Used by core to call app-specific support actions (lookupUser, getPurchases, etc.)
 * with Stripe-style HMAC-SHA256 signature verification.
 *
 * @example
 * ```typescript
 * import { IntegrationClient } from '@skillrecordings/sdk/client'
 *
 * const client = new IntegrationClient({
 *   baseUrl: 'https://totaltypescript.com',
 *   webhookSecret: 'whsec_abc123',
 * })
 *
 * const user = await client.lookupUser('test@example.com')
 * ```
 */
export class IntegrationClient implements SupportIntegration {
  private readonly baseUrl: string
  private readonly webhookSecret: string

  constructor(config: { baseUrl: string; webhookSecret: string }) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.webhookSecret = config.webhookSecret
  }

  /**
   * Generate HMAC-SHA256 signature for request body.
   * Format: `t=<timestamp>,v1=<signature>`
   *
   * Signature is computed as: HMAC-SHA256(timestamp + "." + body, secret)
   */
  private generateSignature(body: string): string {
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${body}`
    const signature = createHmac('sha256', this.webhookSecret)
      .update(signedPayload)
      .digest('hex')

    return `t=${timestamp},v1=${signature}`
  }

  /**
   * Make signed POST request to app integration endpoint.
   */
  private async request<T>(endpoint: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload)
    const signature = this.generateSignature(body)

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Support-Signature': signature,
      },
      body,
    })

    if (!response.ok) {
      // Try to extract error message from response body
      let errorMessage: string | undefined
      try {
        const errorBody = (await response.json()) as { error?: string }
        if (errorBody?.error) {
          errorMessage = errorBody.error
        }
      } catch {
        // If JSON parsing fails, ignore and use status text
      }

      if (errorMessage) {
        throw new Error(errorMessage)
      }
      throw new Error(
        `Integration request failed: ${response.status} ${response.statusText}`
      )
    }

    return (await response.json()) as T
  }

  async lookupUser(email: string): Promise<User | null> {
    return this.request('/api/support/lookup-user', { email })
  }

  async getPurchases(userId: string): Promise<Purchase[]> {
    return this.request('/api/support/get-purchases', { userId })
  }

  async getSubscriptions(userId: string): Promise<Subscription[]> {
    return this.request('/api/support/get-subscriptions', { userId })
  }

  async revokeAccess(params: {
    purchaseId: string
    reason: string
    refundId: string
  }): Promise<ActionResult> {
    return this.request('/api/support/revoke-access', params)
  }

  async transferPurchase(params: {
    purchaseId: string
    fromUserId: string
    toEmail: string
  }): Promise<ActionResult> {
    return this.request('/api/support/transfer-purchase', params)
  }

  async generateMagicLink(params: {
    email: string
    expiresIn: number
  }): Promise<{ url: string }> {
    return this.request('/api/support/generate-magic-link', params)
  }

  async updateEmail(params: {
    userId: string
    newEmail: string
  }): Promise<ActionResult> {
    return this.request('/api/support/update-email', params)
  }

  async updateName(params: {
    userId: string
    newName: string
  }): Promise<ActionResult> {
    return this.request('/api/support/update-name', params)
  }

  async getClaimedSeats(bulkCouponId: string): Promise<ClaimedSeat[]> {
    return this.request('/api/support/get-claimed-seats', { bulkCouponId })
  }

  async searchContent(
    request: ContentSearchRequest
  ): Promise<ContentSearchResponse> {
    return this.request('/api/support/search-content', request)
  }
}
