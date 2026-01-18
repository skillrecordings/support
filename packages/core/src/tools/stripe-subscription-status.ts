import Stripe from 'stripe'
import { z } from 'zod'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Parameters for subscription status query
 */
const GetSubscriptionStatusParams = z.object({
  /**
   * Stripe customer ID
   */
  customerId: z.string(),
  /**
   * Stripe Connect account ID
   */
  stripeAccountId: z.string(),
})

/**
 * Subscription status result
 */
export interface SubscriptionStatus {
  id: string
  status: string
  currentPeriodEnd: number
  cancelAtPeriodEnd: boolean
  planName: string
}

/**
 * Agent tool to check subscription status via Stripe Connect.
 *
 * Queries the connected Stripe account for customer subscriptions and returns
 * the status, plan details, and cancellation info. Returns null if no subscription found.
 *
 * @example
 * ```typescript
 * const status = await getSubscriptionStatus.execute({
 *   customerId: 'cus_123',
 *   stripeAccountId: 'acct_1LFP5yAozSgJZBRP',
 * }, context)
 * ```
 */
export const getSubscriptionStatus = createTool({
  name: 'get_subscription_status',
  description:
    'Check subscription status for a customer via Stripe Connect. Returns subscription details or null if no subscription found.',
  parameters: GetSubscriptionStatusParams,

  execute: async (
    params,
    context: ExecutionContext
  ): Promise<SubscriptionStatus | null> => {
    // Initialize Stripe client
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2025-02-24.acacia',
    })

    // Query subscriptions for the customer on the connected account
    const subscriptions = await stripe.subscriptions.list(
      {
        customer: params.customerId,
        status: 'all',
      },
      {
        stripeAccount: params.stripeAccountId,
      }
    )

    // Return null if no subscriptions found
    const subscription = subscriptions.data[0]
    if (!subscription) {
      return null
    }

    // Extract plan name from subscription items
    const planName = subscription.items.data[0]?.plan?.nickname || 'Unknown'

    return {
      id: subscription.id,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      planName,
    }
  },
})
