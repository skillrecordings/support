# Phase 5 - Stripe Connect

## Goal

Connect to app Stripe accounts for **querying** payment and subscription data. The platform is the "queen" - it orchestrates and provides context, but does NOT execute financial actions.

## Critical Architecture: Query, Don't Execute

**The platform provides intelligence. Apps execute actions.**

```
┌─────────────────────────────────────────────────────────────┐
│                    Support Platform                          │
│                    ("Queen of Hive")                         │
├─────────────────────────────────────────────────────────────┤
│  We QUERY via Connect       │  Apps NOTIFY us via SDK       │
│  ───────────────────        │  ─────────────────────        │
│  • Payment history          │  • Refund processed           │
│  • Subscription status      │  • Access revoked             │
│  • Customer details         │  • License transferred        │
│  • Charge/refund lookup     │  • Purchase created           │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
    Stripe API                    App Integration
    (connected acct)              (SDK webhook)
```

**What we DO with Stripe Connect:**
- Query payment history for a customer
- Check subscription status
- Look up charge details for agent context
- Verify refund status (after app notifies us)

**What we DON'T do:**
- Process refunds (apps do this via their own Stripe integration)
- Create charges
- Modify subscriptions
- Any financial mutations

**Why this architecture?**
1. **Apps own financial operations** - They have the business logic, policies, edge cases
2. **Apps notify us via SDK** - When they refund, revoke access, transfer, etc.
3. **We provide intelligence** - Context for support agents, decision support
4. **Clear boundaries** - Platform can't accidentally charge/refund wrong account
5. **Simpler system** - Query-only = fewer failure modes, no idempotency concerns

## Background

Each Skill Recordings app (Total TypeScript, Pro Tailwind, etc.) has their own Stripe account. We use Stripe Connect OAuth to establish a secure connection for **read access**. The platform can then query their Stripe data using its own API key + the connected account's `acct_xxx` ID.

## Deliverables

### 1. OAuth Connect Flow

**Route: `apps/web/app/api/stripe/connect/`**

| Endpoint | Purpose |
|----------|---------|
| `GET /authorize` | Redirect to Stripe OAuth with state + CSRF protection |
| `GET /callback` | Exchange code for `stripe_user_id`, store in apps table |

**OAuth URL Parameters:**
```
https://connect.stripe.com/oauth/authorize
  ?response_type=code
  &client_id={STRIPE_CONNECT_CLIENT_ID}
  &scope=read_write
  &redirect_uri={CALLBACK_URL}
  &state={CSRF_TOKEN}
```

**Callback stores:**
- `stripe_account_id` (acct_xxx)
- `stripe_connected` = true

### 2. Query Tools for Agent Context

Agent tools that query Stripe Connect for context:

| Tool | Purpose | Returns |
|------|---------|---------|
| `getPaymentHistory` | Fetch charges for a customer | List of charges with amounts, dates, refund status |
| `getSubscriptionStatus` | Check subscription state | Status, period end, cancel status |
| `lookupCharge` | Get charge details by ID | Full charge object |
| `verifyRefund` | Verify refund after app notification | Refund status and amount |

**Example usage in agent:**
```typescript
// Agent needs payment context for support conversation
const history = await tools.getPaymentHistory({
  stripeAccountId: app.stripe_account_id,
  customerEmail: customer.email,
})

// Agent can now see: purchases, amounts, refund history
```

### 3. Webhook Monitoring (Minimal)

**Route: `apps/web/app/api/stripe/webhooks/route.ts`**

Per our "query, don't warehouse" philosophy, we only monitor events that require action:

| Event | Purpose | Action |
|-------|---------|--------|
| `account.application.deauthorized` | App disconnected from Connect | Clear `stripe_account_id` from apps table |
| `charge.dispute.created` | Dispute opened (optional) | Alert via Slack, flag conversation |

**We do NOT monitor:**
- `charge.refunded` - Apps notify us via SDK when they refund
- `customer.subscription.*` - Query on-demand when needed
- `payment_intent.*` - Not our concern

### 4. SDK Integration for App Notifications

Apps notify us of actions via SDK (see Phase 4):

```typescript
// In app (e.g., Total TypeScript)
await supportSDK.notify('refund.processed', {
  purchaseId: 'pur_xxx',
  refundId: 're_xxx',
  amount: 9900,
  reason: 'requested_by_customer',
})
```

Platform receives notification, can verify via Stripe if needed, updates conversation state.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Platform's secret key (sk_live_xxx) for Connect API |
| `STRIPE_CONNECT_CLIENT_ID` | OAuth client ID (ca_xxx) from Connect settings |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (for deauth only) |

## Database

The `apps` table stores connection:

```sql
-- After OAuth callback
UPDATE apps
SET stripe_account_id = 'acct_xxx', stripe_connected = true
WHERE slug = 'total-typescript';
```

## Connected Apps

| App | Account ID | Status |
|-----|------------|--------|
| Total TypeScript | `acct_1LFP5yAozSgJZBRP` | ✓ Connected |

## Error Handling

| Error | Action |
|-------|--------|
| `invalid_grant` | Code expired/used - restart OAuth |
| `access_denied` | User denied - show message |
| Permission errors | Account not connected - re-auth |

## PR-Ready Checklist

- [x] OAuth flow: `/api/stripe/connect/authorize` redirects to Stripe
- [x] OAuth callback: `/api/stripe/connect/callback` stores `stripe_account_id`
- [x] State verification prevents CSRF
- [ ] Query tools: `getPaymentHistory`, `getSubscriptionStatus`
- [ ] Deauth webhook handler clears connection
- [ ] SDK notification handlers for refund/revoke events

## Validation / Tests

### Unit Tests
- OAuth URL generation with correct params
- Callback code exchange (mocked)
- Query tool response mapping

### Integration Tests
- Stripe webhook signature verification
- Connected account query works

## Files to Create/Modify

| File | Action |
|------|--------|
| `apps/web/app/api/stripe/connect/authorize/route.ts` | Done |
| `apps/web/app/api/stripe/connect/callback/route.ts` | Done |
| `apps/web/app/api/stripe/webhooks/route.ts` | Create (deauth only) |
| `packages/core/src/tools/lookup-stripe.ts` | Create (query tools) |

## Reference

- Skill: `.claude/skills/stripe-connect/SKILL.md`
- SDK: `.claude/skills/sdk-adapter/SKILL.md`
- Stripe OAuth Docs: https://docs.stripe.com/connect/oauth-reference
