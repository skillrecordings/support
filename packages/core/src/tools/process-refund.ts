import { z } from 'zod'
import { createTool } from './create-tool'
import { IntegrationClient } from '@skillrecordings/sdk/client'
import { getApp } from '@skillrecordings/core/services/app-registry'

/**
 * Refund processing result.
 */
export interface RefundResult {
  /**
   * Stripe refund ID
   */
  refundId: string
  /**
   * Amount refunded in cents
   */
  amountRefunded: number
}

/**
 * Process a refund for a customer purchase.
 *
 * This tool processes refunds through Stripe Connect and revokes product access.
 * It has a built-in approval gate:
 * - Purchases within 30 days: auto-approve
 * - Purchases 30-45 days: requires human approval
 * - Purchases over 45 days: should be escalated (agent discretion)
 *
 * @example
 * ```typescript
 * const result = await processRefund.execute(
 *   { purchaseId: 'pur_123', appId: 'total-typescript', reason: 'Customer request' },
 *   context
 * )
 * ```
 */
export const processRefund = createTool({
  name: 'process_refund',
  description:
    'Process a refund for a customer purchase. Use only for eligible refund requests within policy.',
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

    // TODO(REMOVE-STUB): Replace with real Stripe Connect refund API call
    // Stub Stripe refund for testing HITL flow
    console.warn('[processRefund] Using STUB for Stripe Connect - implement real refund')
    console.log('[processRefund] Executing refund:', {
      purchaseId,
      appId,
      reason,
      approvalId: context.approvalId,
      traceId: context.traceId,
    })

    const stubRefundId = `re_stub_${Date.now()}`

    // Real implementation: Call revokeAccess via IntegrationClient
    try {
      const client = new IntegrationClient({
        baseUrl: app.integration_base_url,
        webhookSecret: app.webhook_secret,
      })

      const revokeResult = await client.revokeAccess({
        purchaseId,
        reason,
        refundId: stubRefundId,
      })

      if (!revokeResult.success) {
        throw new Error(revokeResult.message || 'Failed to revoke access')
      }

      return {
        refundId: stubRefundId,
        amountRefunded: 9900, // $99.00 stub
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error('Failed to revoke access')
    }
  },
})
