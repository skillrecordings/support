/**
 * Stripe webhook ingestion endpoint.
 *
 * Receives Stripe webhook events, verifies the signature,
 * and queues them to Inngest for durable processing.
 *
 * @see https://docs.stripe.com/webhooks/signatures
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { inngest } from '@skillrecordings/core/inngest'

/**
 * Get or create Stripe client instance.
 * Lazy initialization to avoid errors when env vars are not set during tests.
 */
function getStripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  })
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
  let event: Stripe.Event

  try {
    const stripe = getStripeClient()
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Send to Inngest for durable processing
  await inngest.send({
    name: 'stripe/event.received',
    data: {
      type: event.type,
      data: event.data.object,
      accountId: event.account,
    },
  })

  return NextResponse.json({ received: true }, { status: 200 })
}
