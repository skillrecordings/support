import Stripe from 'stripe'
import { z } from 'zod'
import { createTool } from './create-tool'

/**
 * Formatted charge information for payment history.
 */
export interface PaymentCharge {
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
   * Unix timestamp of charge creation
   */
  created: number
  /**
   * Charge description
   */
  description: string | null
}

/**
 * Payment history result.
 */
export interface PaymentHistoryResult {
  /**
   * List of formatted charges
   */
  charges: PaymentCharge[]
}

/**
 * Get payment/charge history for a customer via Stripe Connect.
 *
 * IMPORTANT: This is a QUERY-ONLY tool. It does NOT execute financial actions.
 * We use Stripe Connect to query payment data from the app's connected account.
 *
 * Architecture: Platform queries for context → Apps execute actions
 *
 * Use cases:
 * - Agent needs payment context for support conversation
 * - Verifying purchase history
 * - Checking refund status
 *
 * @example
 * ```typescript
 * const history = await getPaymentHistory.execute(
 *   { customerEmail: 'customer@example.com', limit: 10 },
 *   context
 * )
 * ```
 */
export const getPaymentHistory = createTool({
  name: 'get_payment_history',
  description:
    'Query payment/charge history for a customer from Stripe Connect. Read-only - provides context for support conversations. Returns charge list with amounts, dates, refund status.',
  parameters: z.object({
    /**
     * Customer email to lookup charges
     */
    customerEmail: z.string().email('Valid email required'),
    /**
     * Maximum number of charges to return (default: 25, max: 100)
     */
    limit: z
      .number()
      .int()
      .positive()
      .max(100, 'Limit cannot exceed 100')
      .optional()
      .default(25),
  }),

  execute: async ({ customerEmail, limit = 25 }, context) => {
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
      // Query charges from connected account
      // Using stripeAccount header to query the connected app's Stripe account
      const charges = await stripe.charges.list(
        {
          customer: customerEmail,
          limit,
        },
        {
          stripeAccount: context.appConfig.stripeAccountId,
        }
      )

      // Format charges for agent context
      const formattedCharges: PaymentCharge[] = charges.data.map((charge) => ({
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        status: charge.status,
        refunded: charge.refunded,
        created: charge.created,
        description: charge.description,
      }))

      return {
        charges: formattedCharges,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to fetch payment history: ${message}`)
    }
  },
})
