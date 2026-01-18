# Architecture

## Intent
Agent-first support platform with human approvals. Front is source of truth for conversations.

## High-level flow (happy path)
1. Front webhook delivers conversation event.
2. Inngest workflow ingests and hydrates context.
3. Agent selects tools and drafts a response.
4. If approval is required, Slack approval flow gates execution.
5. Actions run (Stripe/Front/etc.), audit logged, response drafted in Front.

## System boundary
Inside repo:
- apps/web (Dashboard)
- apps/slack (Slack approvals bot)
- apps/front (Front plugin)
- packages/core (agent, tools, workflows, registry)
- packages/sdk (integration contract + adapters)
- packages/cli (skill CLI)

External:
- Front (source of truth for conversations)
- Stripe Connect (refunds)
- Slack (HITL approvals)
- Upstash Vector (hybrid retrieval)
- Axiom + Langfuse (observability)

## Source of truth
- Conversations + message state: Front
- Approvals: Slack
- Execution + audit: core workflows/tools

## Key constraints
- Workflow engine: Inngest only
- Vector search: Upstash defaults
- Auth: BetterAuth
- DB: PlanetScale
- Webhook signing: HMAC-SHA256, 5-minute replay, key rotation
- Cache: Durable Objects per conversation, 7-day TTL

## SDK Integration Flow

The SDK enables secure communication between the support platform and app integrations (Total TypeScript, Pro Tailwind, etc.).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Support Platform (core)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐    │
│  │ Agent Tool   │────►│ App Registry │────►│ IntegrationClient    │    │
│  │ (lookupUser) │     │ (getApp)     │     │ (signed requests)    │    │
│  └──────────────┘     └──────────────┘     └──────────┬───────────┘    │
│                                                       │                 │
└───────────────────────────────────────────────────────│─────────────────┘
                                                        │
                                              HTTPS + HMAC-SHA256
                                              timestamp=...,v1=...
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        App Integration (e.g., Total TypeScript)         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────┐     ┌──────────────────────────────────┐     │
│  │ createSupportHandler │────►│ SupportIntegration implementation │     │
│  │ (signature verify)   │     │ (lookupUser, revokeAccess, etc.) │     │
│  └──────────────────────┘     └──────────────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### SDK Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `SupportIntegration` | `@skillrecordings/sdk/integration` | Interface that apps implement |
| `IntegrationClient` | `@skillrecordings/sdk/client` | HTTP client with HMAC signing |
| `createSupportHandler` | `@skillrecordings/sdk/handler` | Request handler with signature verification |
| App Registry | `@skillrecordings/core/services/app-registry` | App config lookup with 5-min TTL cache |

### HMAC Signature Format

Requests are signed using HMAC-SHA256 with the app's `webhook_secret`:

```
x-signature: timestamp=[PHONE],v1=<hex_signature>
```

Payload to sign: `${timestamp}.${JSON.stringify(body)}`

### SupportIntegration Methods

**Required:**
- `lookupUser(email)` - Look up user by email
- `getPurchases(userId)` - Get user's purchases
- `revokeAccess({purchaseId, reason, refundId})` - Revoke access after refund
- `transferPurchase({purchaseId, fromUserId, toEmail})` - Transfer purchase
- `generateMagicLink({email, expiresIn})` - Generate login link

**Optional:**
- `getSubscriptions(userId)` - Get recurring subscriptions
- `updateEmail({userId, newEmail})` - Change email
- `updateName({userId, newName})` - Change name
- `getClaimedSeats(bulkCouponId)` - Team seat management
