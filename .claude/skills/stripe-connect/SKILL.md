---
name: stripe-connect
description: Implement Stripe Connect OAuth and refund processing. Use when onboarding apps to Connect, processing refunds via connected accounts, or handling Stripe webhooks.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Stripe Connect Integration

Stripe Connect enables the platform to process refunds on behalf of connected apps (Total TypeScript, Pro Tailwind, etc.). Each app has their own Stripe account that connects to our platform via OAuth.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Support Platform                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ processRefund│───►│ Stripe API   │───►│ Connected Account    │  │
│  │ Tool         │    │ + Stripe-    │    │ (acct_xxx)           │  │
│  │              │    │ Account hdr  │    │                      │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## OAuth Flow (Standard Accounts)

### Step 1: Generate Authorization URL

```typescript
// Build OAuth URL with state for CSRF protection
function buildConnectAuthUrl(appSlug: string): string {
  const state = crypto.randomUUID() // Store in session for verification

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.STRIPE_CONNECT_CLIENT_ID!,
    scope: 'read_write',
    redirect_uri: `${process.env.NEXT_PUBLIC_URL}/api/stripe/connect/callback`,
    state,
    // Prefill for better UX (optional)
    'stripe_user[email]': '[EMAIL]',
    'stripe_user[url]': 'https://totaltypescript.com',
    'stripe_user[business_name]': 'Total TypeScript',
    'stripe_user[product_description]': 'TypeScript courses and workshops',
  })

  return `https://connect.stripe.com/oauth/authorize?${params}`
}
```

### Step 2: Handle OAuth Callback

```typescript
// app/api/stripe/connect/callback/route.ts
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  // Handle user denial
  if (error === 'access_denied') {
    return Response.redirect('/settings/integrations?error=denied')
  }

  // Verify state matches session (CSRF protection)
  const savedState = await getSessionState()
  if (state !== savedState) {
    return Response.redirect('/settings/integrations?error=invalid_state')
  }

  try {
    // Exchange code for account ID
    const response = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code: code!,
    })

    const stripeAccountId = response.stripe_user_id

    // Store in apps table
    await db.update(appsTable)
      .set({ stripe_account_id: stripeAccountId })
      .where(eq(appsTable.slug, appSlug))

    return Response.redirect('/settings/integrations?success=connected')
  } catch (err) {
    console.error('Stripe OAuth error:', err)
    return Response.redirect('/settings/integrations?error=oauth_failed')
  }
}
```

### Step 3: Process Refunds via Connected Account

```typescript
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

interface RefundParams {
  chargeId: string          // ch_xxx from the original charge
  stripeAccountId: string   // acct_xxx from apps table
  amount?: number           // Optional: partial refund in cents
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent'
  idempotencyKey: string    // Required for safety
}

async function processConnectRefund(params: RefundParams) {
  const { chargeId, stripeAccountId, amount, reason, idempotencyKey } = params

  const refund = await stripe.refunds.create(
    {
      charge: chargeId,
      amount,  // Omit for full refund
      reason: reason ?? 'requested_by_customer',
    },
    {
      stripeAccount: stripeAccountId,  // Critical: routes to connected account
      idempotencyKey,                   // Prevents duplicate refunds
    }
  )

  return {
    refundId: refund.id,            // re_xxx
    amount: refund.amount,          // Amount in cents
    status: refund.status,          // succeeded, pending, failed
    chargeId: refund.charge,
  }
}
```

## Idempotency Keys

**CRITICAL**: All Stripe mutations MUST use idempotency keys to prevent duplicate operations.

```typescript
// Generate deterministic idempotency key
function generateIdempotencyKey(params: {
  action: 'refund' | 'transfer'
  purchaseId: string
  approvalId: string
}): string {
  return `${params.action}:${params.purchaseId}:${params.approvalId}`
}

// Usage in tool
const idempotencyKey = generateIdempotencyKey({
  action: 'refund',
  purchaseId: params.purchaseId,
  approvalId: context.approvalId,
})

const refund = await stripe.refunds.create(
  { charge: chargeId },
  {
    stripeAccount: accountId,
    idempotencyKey,  // Same key = same result, no duplicate
  }
)
```

## Webhook Handling

Stripe sends events to your webhook endpoint. Use Inngest for durable processing.

### Webhook Route

```typescript
// app/api/stripe/webhooks/route.ts
import Stripe from 'stripe'
import { inngest } from '@/lib/inngest'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(request: Request) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return new Response('Invalid signature', { status: 400 })
  }

  // Send to Inngest for durable processing
  await inngest.send({
    name: 'stripe/event.received',
    data: {
      type: event.type,
      data: event.data.object,
      accountId: event.account,  // Connected account ID if applicable
    },
  })

  return new Response('OK', { status: 200 })
}
```

### Inngest Workflow for Refund Events

```typescript
// packages/core/src/inngest/workflows/stripe-refund.ts
import { inngest } from '../client'

export const handleStripeRefund = inngest.createFunction(
  { id: 'handle-stripe-refund' },
  { event: 'stripe/event.received' },
  async ({ event, step }) => {
    if (event.data.type !== 'charge.refunded') return

    const charge = event.data.data as Stripe.Charge

    // Find related purchase
    const purchase = await step.run('find-purchase', async () => {
      return db.query.purchases.findFirst({
        where: eq(purchases.stripeChargeId, charge.id),
      })
    })

    if (!purchase) {
      console.warn('No purchase found for charge:', charge.id)
      return
    }

    // Notify app to revoke access (if not already done)
    await step.run('notify-app', async () => {
      // This is handled by processRefund tool, but webhook
      // provides backup reconciliation
    })

    // Audit log
    await step.run('audit-log', async () => {
      await db.insert(auditLogs).values({
        action: 'refund_confirmed',
        purchaseId: purchase.id,
        stripeRefundId: charge.refunds?.data[0]?.id,
        source: 'stripe_webhook',
      })
    })
  }
)
```

## Environment Variables

```bash
# Platform's Stripe keys
STRIPE_SECRET_KEY=sk_live_xxx           # Platform secret key
STRIPE_PUBLISHABLE_KEY=pk_live_xxx      # Platform publishable key

# Connect OAuth
STRIPE_CONNECT_CLIENT_ID=ca_xxx         # From Connect settings

# Webhooks
STRIPE_WEBHOOK_SECRET=whsec_xxx         # From webhook endpoint config
```

## Database Schema

The `apps` table stores the connected account ID:

```typescript
// packages/database/src/schema.ts
export const appsTable = pgTable('apps', {
  id: text('id').primaryKey(),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  stripe_account_id: text('stripe_account_id'),  // acct_xxx from OAuth
  // ... other fields
})
```

## Error Handling

```typescript
try {
  const refund = await stripe.refunds.create(
    { charge: chargeId },
    { stripeAccount: accountId, idempotencyKey }
  )
} catch (err) {
  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    // Charge already refunded, invalid charge, etc.
    if (err.code === 'charge_already_refunded') {
      // Idempotent: treat as success
      return { alreadyRefunded: true }
    }
    throw new Error(`Invalid refund request: ${err.message}`)
  }

  if (err instanceof Stripe.errors.StripePermissionError) {
    // Not authorized for this connected account
    throw new Error('Not authorized to refund this account')
  }

  throw err
}
```

## OAuth Error Codes Reference

| Error | Meaning |
|-------|---------|
| `access_denied` | User denied authorization |
| `invalid_scope` | Bad scope parameter |
| `invalid_redirect_uri` | Redirect URI not whitelisted |
| `invalid_grant` | Code expired/used/invalid |

## Deauthorization

When an app disconnects:

```typescript
await stripe.oauth.deauthorize({
  client_id: process.env.STRIPE_CONNECT_CLIENT_ID!,
  stripe_user_id: 'acct_xxx',
})

// Update database
await db.update(appsTable)
  .set({ stripe_account_id: null })
  .where(eq(appsTable.id, appId))
```

## Testing

Use Stripe test mode:
- Test charges: `tok_visa` creates refundable charges
- Test accounts: Use development `client_id` for OAuth
- Test webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhooks`

## File Locations

| File | Purpose |
|------|---------|
| `apps/web/app/api/stripe/connect/` | OAuth callback routes |
| `apps/web/app/api/stripe/webhooks/` | Webhook ingestion |
| `packages/core/src/tools/process-refund.ts` | Refund tool with Connect |
| `packages/core/src/inngest/workflows/stripe-*.ts` | Webhook workflows |

## Reference Docs

- PRD Phase 5: `docs/support-app-prd/07-stripe-connect.md`
- Stripe Connect OAuth: https://docs.stripe.com/connect/oauth-reference
- Stripe Idempotency: https://docs.stripe.com/api/idempotent_requests
