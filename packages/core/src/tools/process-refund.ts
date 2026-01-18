import { z } from 'zod'
import Stripe from 'stripe'
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

    // Validate app has Stripe Connect account
    if (!app.stripe_account_id) {
      throw new Error(`App ${appId} is not connected to Stripe`)
    }

    // Find the purchase to get Stripe charge ID
    const purchase = context.purchases.find((p) => p.id === purchaseId)
    if (!purchase) {
      throw new Error(`Purchase not found: ${purchaseId}`)
    }
    if (!purchase.stripeChargeId) {
      throw new Error(`Purchase ${purchaseId} has no Stripe charge ID`)
    }

    // Initialize Stripe client
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-02-24.acacia',
    })

    // Generate deterministic idempotency key
    const idempotencyKey = `refund:${purchaseId}:${context.approvalId}`

    // Execute Stripe refund via Connect
    let refund: Stripe.Refund
    try {
      refund = await stripe.refunds.create(
        {
          charge: purchase.stripeChargeId,
          reason: 'requested_by_customer',
        },
        {
          stripeAccount: app.stripe_account_id,
          idempotencyKey,
        }
      )
    } catch (err) {
      // Handle Stripe errors
      if (err && typeof err === 'object' && 'type' in err) {
        const stripeError = err as { type: string; code?: string; message?: string }

        if (stripeError.type === 'StripeInvalidRequestError') {
          if (stripeError.code === 'charge_already_refunded') {
            // Idempotent: charge already refunded
            // Fetch the existing refund to get the amount
            const charge = await stripe.charges.retrieve(purchase.stripeChargeId, {
              stripeAccount: app.stripe_account_id,
            })
            refund = {
              id: `re_already_${purchaseId}`,
              amount: charge.amount_refunded,
            } as Stripe.Refund
          } else {
            throw new Error(`Stripe refund failed: ${stripeError.message}`)
          }
        } else if (stripeError.type === 'StripePermissionError') {
          throw new Error(`Not authorized to refund for app ${appId}`)
        } else {
          throw err
        }
      } else {
        throw err
      }
    }

    // Revoke access via IntegrationClient
    try {
      const client = new IntegrationClient({
        baseUrl: app.integration_base_url,
        webhookSecret: app.webhook_secret,
      })

      const revokeResult = await client.revokeAccess({
        purchaseId,
        reason,
        refundId: refund.id,
      })

      if (!revokeResult.success) {
        throw new Error(revokeResult.error || 'Failed to revoke access')
      }

      return {
        refundId: refund.id,
        amountRefunded: refund.amount,
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error('Failed to revoke access')
    }
  },
})
