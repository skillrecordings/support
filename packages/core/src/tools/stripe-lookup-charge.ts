import Stripe from 'stripe'
import { z } from 'zod'
import { createTool } from './create-tool'

/**
 * Formatted charge information.
 */
export interface ChargeDetails {
  /**
   * Stripe charge ID
   */
  id: string
  /**
   * Amount in cents
   */
  amount: number
  /**
   * Currency code (e.g., 'usd')
   */
  currency: string
  /**
   * Charge status
   */
  status: string
  /**
   * Whether the charge has been refunded
   */
  refunded: boolean
  /**
   * Stripe customer ID
   */
  customer: string | null
  /**
   * Charge description
   */
  description: string | null
  /**
   * Unix timestamp of charge creation
   */
  created: number
}

/**
 * Lookup a specific charge by ID via Stripe Connect.
 *
 * IMPORTANT: This is a QUERY-ONLY tool. It does NOT execute financial actions.
 * We use Stripe Connect to query charge data from the app's connected account.
 *
 * Architecture: Platform queries for context → Apps execute actions
 *
 * Use cases:
 * - Agent needs charge details for support conversation
 * - Verifying charge status
 * - Checking refund status for a specific charge
 *
 * @example
 * ```typescript
 * const charge = await lookupCharge.execute(
 *   { chargeId: 'ch_abc123' },
 *   context
 * )
 * ```
 */
export const lookupCharge = createTool({
  name: 'lookup_charge',
  description:
    'Lookup a specific charge by ID from Stripe Connect. Read-only - provides context for support conversations. Returns charge details including amount, status, and refund information.',
  parameters: z.object({
    /**
     * Stripe charge ID to lookup (format: ch_...)
     */
    chargeId: z
      .string()
      .min(1, 'Charge ID required')
      .regex(/^ch_/, 'Charge ID must start with ch_'),
  }),

  execute: async ({ chargeId }, context) => {
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
      // Query charge from connected account
      // Using stripeAccount header to query the connected app's Stripe account
      const charge = await stripe.charges.retrieve(chargeId, {
        stripeAccount: context.appConfig.stripeAccountId,
      })

      // Format charge for agent context
      const chargeDetails: ChargeDetails = {
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        status: charge.status,
        refunded: charge.refunded,
        customer: typeof charge.customer === 'string' ? charge.customer : null,
        description: charge.description,
        created: charge.created,
      }

      return chargeDetails
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to lookup charge: ${message}`)
    }
  },
})
