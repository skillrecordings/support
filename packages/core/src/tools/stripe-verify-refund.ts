import Stripe from 'stripe'
import { z } from 'zod'
import { createTool } from './create-tool'

/**
 * Refund details from Stripe.
 */
export interface RefundDetails {
  /**
   * Stripe refund ID
   */
  id: string
  /**
   * Refund status (succeeded, pending, failed, canceled)
   */
  status: string
  /**
   * Amount refunded in cents
   */
  amount: number
  /**
   * ID of the charge that was refunded
   */
  chargeId: string | null
  /**
   * Reason for refund (requested_by_customer, duplicate, fraudulent, etc.)
   */
  reason: string | null
  /**
   * Unix timestamp of refund creation
   */
  created: number
}

/**
 * Verify refund status via Stripe Connect.
 *
 * IMPORTANT: This is a QUERY-ONLY tool. It does NOT execute financial actions.
 * We use Stripe Connect to query refund data from the app's connected account.
 *
 * Architecture: Platform queries for context → Apps execute actions
 *
 * Use cases:
 * - Agent needs to verify a refund was processed
 * - Checking refund status for support conversation
 * - Confirming refund details (amount, reason, timing)
 *
 * @example
 * ```typescript
 * const refund = await verifyRefund.execute(
 *   { refundId: 're_1ABC123' },
 *   context
 * )
 * ```
 */
export const verifyRefund = createTool({
  name: 'verify_refund',
  description:
    'Verify refund status from Stripe Connect. Read-only - provides context for support conversations. Returns refund details including status, amount, charge ID, and reason.',
  parameters: z.object({
    /**
     * Stripe refund ID to verify (e.g., re_1ABC123)
     */
    refundId: z.string().min(1, 'Refund ID required'),
  }),

  execute: async ({ refundId }, context) => {
    // Verify Stripe account is connected
    if (!context.appConfig.stripeAccountId) {
      throw new Error(
        `Stripe account not connected for app: ${context.appConfig.id}`
      )
    }

    // Initialize Stripe client
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-02-24.acacia',
    })

    try {
      // Query refund from connected account
      // Using stripeAccount header to query the connected app's Stripe account
      const refund = await stripe.refunds.retrieve(refundId, {
        stripeAccount: context.appConfig.stripeAccountId,
      })

      // Format refund details for agent context
      const refundDetails: RefundDetails = {
        id: refund.id,
        status: refund.status ?? 'unknown',
        amount: refund.amount,
        chargeId: typeof refund.charge === 'string' ? refund.charge : null,
        reason: refund.reason,
        created: refund.created,
      }

      return refundDetails
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to verify refund: ${message}`)
    }
  },
})
