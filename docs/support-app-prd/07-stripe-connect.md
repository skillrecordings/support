# Phase 5 - Stripe Connect

## Goal

Centralized refunds via Connect. The platform processes refunds on behalf of connected apps using Stripe's `Stripe-Account` header pattern.

## Background

Each Skill Recordings app (Total TypeScript, Pro Tailwind, etc.) has their own Stripe account. Rather than give the platform direct API keys, we use Stripe Connect OAuth to establish a secure connection. The platform can then issue refunds using its own API key + the connected account's `acct_xxx` ID.

## Integration Philosophy: Query, Don't Warehouse

**The platform is the "queen" - it orchestrates, it doesn't store everything.**

```
┌─────────────────────────────────────────────────────────────┐
│                    Support Platform                          │
│                    ("Queen of Hive")                         │
├─────────────────────────────────────────────────────────────┤
│  Queries on-demand            │  Apps notify us             │
│  via Stripe Connect           │  via SDK                    │
│  ─────────────────            │  ────────────               │
│  • Payment history            │  • Refund processed         │
│  • Subscription status        │  • Access revoked           │
│  • Customer details           │  • License transferred      │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
    Stripe API                    App Integration
    (connected acct)              (SDK handler)
```

**Why not ingest all Stripe events?**
1. **No historical context** - Event ingestion starts "now", missing past data
2. **Stripe is source of truth** - Query when needed, don't duplicate
3. **Apps know their domain** - They tell us what matters via SDK
4. **Simpler system** - Less state to manage, fewer failure modes

**What we DO monitor via webhooks:**
- `account.application.deauthorized` - Know when to clear connection
- `charge.dispute.created` - Disputes need immediate attention (optional)

**Everything else: Query on-demand**
- Agent tool calls Stripe API via connected account when it needs context
- `getPaymentHistory(customerId)` → queries Stripe directly
- `getSubscriptions(customerId)` → queries Stripe directly

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Support Platform                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  processRefund Tool                                                  │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ stripe.refunds.create(                                      │    │
│  │   { charge: 'ch_xxx' },                                     │    │
│  │   {                                                         │    │
│  │     stripeAccount: 'acct_xxx',  // Connected account        │    │
│  │     idempotencyKey: '...'       // Prevent duplicates       │    │
│  │   }                                                         │    │
│  │ )                                                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Connected Account (acct_xxx)                       │
│                    e.g., Total TypeScript's Stripe                    │
└──────────────────────────────────────────────────────────────────────┘
```

## Deliverables

### 1. OAuth Connect Flow

**Route: `apps/web/app/api/stripe/connect/`**

| Endpoint | Purpose |
|----------|---------|
| `GET /authorize` | Redirect to Stripe OAuth with state + prefill params |
| `GET /callback` | Exchange code for `stripe_user_id`, store in apps table |

**OAuth URL Parameters:**
```
https://connect.stripe.com/oauth/authorize
  ?response_type=code
  &client_id={STRIPE_CONNECT_CLIENT_ID}
  &scope=read_write
  &redirect_uri={CALLBACK_URL}
  &state={CSRF_TOKEN}
  &stripe_user[email]={prefill}
  &stripe_user[url]={prefill}
  &stripe_user[business_name]={prefill}
```

**Callback Response:**
- `code` - Exchange for account ID (expires in 5 min, single use)
- `state` - Verify matches session for CSRF protection

**Token Exchange:**
```typescript
const response = await stripe.oauth.token({
  grant_type: 'authorization_code',
  code: authCode,
})
const stripeAccountId = response.stripe_user_id  // acct_xxx
```

### 2. Refund Processing with Connect

**Update `packages/core/src/tools/process-refund.ts`:**

Replace the Stripe stub with real Connect refund:

```typescript
const refund = await stripe.refunds.create(
  {
    charge: purchase.stripeChargeId,
    reason: 'requested_by_customer',
  },
  {
    stripeAccount: app.stripe_account_id,  // Critical
    idempotencyKey: `refund:${purchaseId}:${context.approvalId}`,
  }
)
```

### 3. Idempotency Keys

**MANDATORY** for all Stripe mutations. Pattern:

```typescript
// Deterministic key based on action + entity + approval
const idempotencyKey = `${action}:${purchaseId}:${approvalId}`
```

This ensures:
- Retry-safe: Same request = same result
- Approval-scoped: New approval = new key = can retry
- No duplicate refunds

### 4. Webhook Monitoring (Minimal)

**Route: `apps/web/app/api/stripe/webhooks/route.ts`**

Per our "query, don't warehouse" philosophy, we only monitor events that require action:

| Event | Purpose | Action |
|-------|---------|--------|
| `account.application.deauthorized` | App disconnected from Connect | Clear `stripe_account_id` from apps table |
| `charge.dispute.created` | Dispute opened (optional) | Alert via Slack, flag conversation |

**Note:** We do NOT ingest `charge.refunded` for general tracking. If we initiate a refund, our workflow knows the result. If the app refunds independently, they notify us via SDK.

**Pattern: Inngest for durable processing**

```typescript
// Verify signature
const event = stripe.webhooks.constructEvent(body, sig, webhookSecret)

// Only process events we care about
if (event.type === 'account.application.deauthorized') {
  await inngest.send({
    name: 'stripe/event.received',
    data: { type: event.type, data: event.data.object, accountId: event.account }
  })
}
```

### 5. On-Demand Stripe Queries (Future)

Agent tools that query Stripe Connect directly:

| Tool | Purpose |
|------|---------|
| `getPaymentHistory` | Fetch charges for a customer via connected account |
| `getSubscriptionStatus` | Check subscription state via connected account |
| `getDisputes` | List open disputes for a customer |

These provide context without storing event history.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Platform's secret key (sk_live_xxx) |
| `STRIPE_CONNECT_CLIENT_ID` | OAuth client ID (ca_xxx) from Connect settings |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (whsec_xxx) |

## Database Changes

The `apps` table already has `stripe_account_id` column. OAuth callback populates it:

```sql
UPDATE apps SET stripe_account_id = 'acct_xxx' WHERE slug = 'total-typescript';
```

## Error Handling

| Error | Action |
|-------|--------|
| `charge_already_refunded` | Treat as success (idempotent) |
| `invalid_grant` | Code expired/used - restart OAuth |
| `access_denied` | User denied - show message |
| Permission errors | Account not connected - re-auth |

## PR-Ready Checklist

- [ ] OAuth flow: `/api/stripe/connect/authorize` redirects to Stripe
- [ ] OAuth callback: `/api/stripe/connect/callback` stores `stripe_account_id`
- [ ] State verification prevents CSRF
- [ ] `processRefund` uses real Stripe API with `stripeAccount` header
- [ ] Idempotency keys on all Stripe mutations
- [ ] Webhook route verifies Stripe signature
- [ ] Inngest workflow handles `charge.refunded` events
- [ ] Audit log records refund with `stripeRefundId`
- [ ] `revokeAccess` called after successful refund (already done in Phase 4)

## Validation / Tests

### Unit Tests
- OAuth URL generation with correct params
- Callback code exchange mocked
- Idempotency key generation deterministic
- Refund error handling (already refunded, permission denied)

### Integration Tests
- Stripe webhook signature verification
- Inngest workflow processes refund event

### E2E Tests (Test Mode)
- Full OAuth flow with test `client_id`
- Create test charge → refund → verify refund created
- Webhook received and processed

## Files to Create/Modify

| File | Action |
|------|--------|
| `apps/web/app/api/stripe/connect/authorize/route.ts` | Create |
| `apps/web/app/api/stripe/connect/callback/route.ts` | Create |
| `apps/web/app/api/stripe/webhooks/route.ts` | Create |
| `packages/core/src/tools/process-refund.ts` | Modify (remove stub) |
| `packages/core/src/inngest/workflows/stripe-refund.ts` | Create |

## Reference

- Skill: `.claude/skills/stripe-connect/SKILL.md`
- Stripe OAuth Docs: https://docs.stripe.com/connect/oauth-reference
- Stripe Idempotency: https://docs.stripe.com/api/idempotent_requests
