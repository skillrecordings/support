import type Stripe from 'stripe'
import { inngest } from '../client'
import { STRIPE_EVENT_RECEIVED } from '../events'
import { getDb, AppsTable, eq } from '@skillrecordings/database'

/**
 * Handle Stripe webhook events for reconciliation and cleanup.
 *
 * Handles:
 * - charge.refunded: Audit log refund confirmation
 * - account.application.deauthorized: Clear stripe_account_id from apps table
 *
 * Triggered by: stripe/event.received
 */
export const handleStripeEvent = inngest.createFunction(
  {
    id: 'handle-stripe-event',
    name: 'Handle Stripe Event',
  },
  { event: STRIPE_EVENT_RECEIVED },
  async ({ event, step }) => {
    const { type, data, accountId } = event.data

    // Handle refund confirmation (audit purposes)
    if (type === 'charge.refunded') {
      await step.run('log-refund', async () => {
        // Type narrow to Stripe.Charge for charge.refunded events
        const charge = data as Stripe.Charge
        console.log('[stripe-webhook] charge.refunded:', {
          chargeId: charge.id,
          amount: charge.amount_refunded,
          currency: charge.currency,
          accountId,
        })
      })
    }

    // Handle Stripe Connect deauthorization
    if (type === 'account.application.deauthorized') {
      await step.run('handle-deauth', async () => {
        if (!accountId) {
          console.warn('[stripe-webhook] account.application.deauthorized without accountId')
          return
        }

        const db = getDb()

        // Clear stripe_account_id for the deauthorized account
        await db
          .update(AppsTable)
          .set({
            stripe_account_id: null,
            stripe_connected: false,
          })
          .where(eq(AppsTable.stripe_account_id, accountId))

        console.log('[stripe-webhook] Cleared stripe_account_id for account:', accountId)
      })
    }

    return {
      type,
      handled: type === 'charge.refunded' || type === 'account.application.deauthorized',
    }
  }
)
