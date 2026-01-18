import { z } from 'zod'
import { createTool } from './create-tool'

/**
 * Refund processing result.
 */
export interface RefundResult {
  /**
   * Whether the refund was processed successfully
   */
  success: boolean
  /**
   * Stripe refund ID if processed
   */
  refundId?: string
  /**
   * Amount refunded in cents
   */
  amountRefunded?: number
  /**
   * Error message if failed
   */
  error?: string
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
    // TODO: Integrate with Stripe Connect
    // const app = await appRegistry.get(appId)
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    //
    // const purchase = context.purchases.find(p => p.id === purchaseId)
    // if (!purchase?.stripeChargeId) {
    //   return { success: false, error: 'No Stripe charge found for purchase' }
    // }
    //
    // const refund = await stripe.refunds.create({
    //   charge: purchase.stripeChargeId,
    // }, {
    //   stripeAccount: app.stripeAccountId,
    //   idempotencyKey: `refund-${context.approvalId || purchaseId}`,
    // })
    //
    // await app.integration.revokeAccess({
    //   purchaseId,
    //   reason,
    //   refundId: refund.id,
    // })

    // TODO(REMOVE-STUB): Replace with real Stripe Connect refund API call
    // Stub implementation for testing HITL flow
    console.warn('[processRefund] Using STUB - implement Stripe Connect')
    console.log('[processRefund] Executing refund:', {
      purchaseId,
      appId,
      reason,
      approvalId: context.approvalId,
      traceId: context.traceId,
    })

    const result: RefundResult = {
      success: true,
      refundId: `re_stub_${Date.now()}`,
      amountRefunded: 9900, // $99.00 stub
    }

    return result
  },
})
