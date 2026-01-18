import { getApp } from '@skillrecordings/core/services/app-registry'
import { IntegrationClient } from '@skillrecordings/sdk'
import { z } from 'zod'
import { createTool } from './create-tool'

/**
 * Refund request result.
 */
export interface RefundRequestResult {
  /**
   * Whether the refund request was accepted by the app
   */
  accepted: boolean
  /**
   * Message from the app (e.g., "Refund processing", "Already refunded", error message)
   */
  message: string
  /**
   * Refund ID if available (app may return this immediately or via notification later)
   */
  refundId?: string
}

/**
 * Request a refund for a customer purchase.
 *
 * IMPORTANT: This tool does NOT process refunds directly. It requests the app
 * to process the refund via SDK. The app owns the Stripe integration and
 * executes the actual refund, then notifies us when complete.
 *
 * Architecture: Platform requests → App executes → App notifies platform
 *
 * Approval gate:
 * - Purchases within 30 days: auto-approve request
 * - Purchases 30-45 days: requires human approval
 * - Purchases over 45 days: should be escalated (agent discretion)
 *
 * @example
 * ```typescript
 * const result = await requestRefund.execute(
 *   { purchaseId: 'pur_123', appId: 'total-typescript', reason: 'Customer request' },
 *   context
 * )
 * ```
 */
export const processRefund = createTool({
  name: 'request_refund',
  description:
    'Request a refund for a customer purchase. This sends the request to the app which processes the actual refund. Use only for eligible refund requests within policy.',
  parameters: z.object({
    /**
     * Purchase ID to refund
     */
    purchaseId: z.string().min(1, 'Purchase ID is required'),
    /**
     * Application identifier
     */
    appId: z.string().min(1, 'App ID is required'),
    /**
     * Reason for the refund
     */
    reason: z.string().min(1, 'Refund reason is required'),
  }),

  /**
   * Approval gate: requires human approval for purchases older than 30 days
   */
  requiresApproval: (params, context) => {
    const purchase = context.purchases.find((p) => p.id === params.purchaseId)

    if (!purchase) {
      // No purchase found - require approval for safety
      return true
    }

    const daysSincePurchase =
      (Date.now() - purchase.purchasedAt.getTime()) / (1000 * 60 * 60 * 24)

    // Auto-approve within 30 days, require approval after
    return daysSincePurchase > 30
  },

  execute: async ({ purchaseId, appId, reason }, context) => {
    // Look up app configuration
    const app = await getApp(appId)
    if (!app) {
      throw new Error(`App not found: ${appId}`)
    }

    // Create SDK client to communicate with app
    const client = new IntegrationClient({
      baseUrl: app.integration_base_url,
      webhookSecret: app.webhook_secret,
    })

    // Request refund from the app
    // The app will:
    // 1. Validate the request
    // 2. Process the Stripe refund (they own the Stripe integration)
    // 3. Revoke access
    // 4. Notify us via SDK callback when complete
    try {
      const result = await client.revokeAccess({
        purchaseId,
        reason,
        refundId: `pending_${context.approvalId}`, // Placeholder until app confirms
      })

      if (!result.success) {
        return {
          accepted: false,
          message: result.error || 'App declined the refund request',
        }
      }

      return {
        accepted: true,
        message:
          'Refund request accepted. App will process and notify when complete.',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to request refund from app: ${message}`)
    }
  },
})
