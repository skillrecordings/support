# Phase 5 - Stripe Connect

## Goal

Centralized refunds via Connect. The platform processes refunds on behalf of connected apps using Stripe's `Stripe-Account` header pattern.

## Background

Each Skill Recordings app (Total TypeScript, Pro Tailwind, etc.) has their own Stripe account. Rather than give the platform direct API keys, we use Stripe Connect OAuth to establish a secure connection. The platform can then issue refunds using its own API key + the connected account's `acct_xxx` ID.

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

### 4. Webhook Ingestion

**Route: `apps/web/app/api/stripe/webhooks/route.ts`**

Events to handle:
- `charge.refunded` - Reconciliation (backup to our initiated refunds)
- `account.application.deauthorized` - App disconnected

**Pattern: Inngest for durable processing**

```typescript
// Verify signature
const event = stripe.webhooks.constructEvent(body, sig, webhookSecret)

// Send to Inngest
await inngest.send({
  name: 'stripe/event.received',
  data: { type: event.type, data: event.data.object, accountId: event.account }
})
```

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
