---
name: sdk-adapter
description: Create SDK adapters for new app integrations. Use when onboarding a new Skill Recordings product, implementing the SupportIntegration interface, or scaffolding a new app.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# SDK + Adapter Pattern

Adding a new app should be **"a `skill init` away"**. Each app implements the `SupportIntegration` interface.

## SupportIntegration Interface

```typescript
export interface SupportIntegration {
  // Required: User lookup
  lookupUser(email: string): Promise<User | null>
  getPurchases(userId: string): Promise<Purchase[]>

  // Optional: Subscriptions
  getSubscriptions?(userId: string): Promise<Subscription[]>

  // Required: Access management
  revokeAccess(params: {
    purchaseId: string
    reason: string
    refundId: string
  }): Promise<ActionResult>

  transferPurchase(params: {
    purchaseId: string
    fromUserId: string
    toEmail: string
  }): Promise<ActionResult>

  // Required: Auth
  generateMagicLink(params: {
    email: string
    expiresIn: number
  }): Promise<{ url: string }>

  // Optional: Profile updates
  updateEmail?(params: {
    userId: string
    newEmail: string
  }): Promise<ActionResult>

  updateName?(params: {
    userId: string
    newName: string
  }): Promise<ActionResult>

  // Optional: Team features
  getClaimedSeats?(bulkCouponId: string): Promise<ClaimedSeat[]>
}
```

## Type Definitions

```typescript
export interface User {
  id: string
  email: string
  name?: string
  createdAt: Date
}

export interface Purchase {
  id: string
  productId: string
  productName: string
  purchasedAt: Date
  amount: number
  currency: string
  stripeChargeId?: string
  status: 'active' | 'refunded' | 'transferred'
}

export interface RefundRequest {
  purchaseId: string
  reason: string
  amount?: number  // Partial refund
}

export interface RefundResult {
  success: boolean
  refundId?: string
  error?: string
}
```

## Next.js Route Adapter

```typescript
import { createSupportHandler } from '@support/sdk'
import type { SupportIntegration } from '@support/sdk'

// Implement integration for your app
const integration: SupportIntegration = {
  async lookupUser(email) {
    return db.user.findUnique({ where: { email } })
  },
  async getPurchases(userId) {
    return db.purchase.findMany({ where: { userId } })
  },
  async revokeAccess({ purchaseId, reason, refundId }) {
    await db.purchase.update({
      where: { id: purchaseId },
      data: { status: 'refunded', refundReason: reason, stripeRefundId: refundId }
    })
    return { success: true }
  },
  async transferPurchase({ purchaseId, fromUserId, toEmail }) {
    const toUser = await db.user.findUnique({ where: { email: toEmail } })
    await db.purchase.update({
      where: { id: purchaseId },
      data: { userId: toUser.id }
    })
    return { success: true }
  },
  async generateMagicLink({ email, expiresIn }) {
    const token = await createMagicToken(email, expiresIn)
    return { url: `${APP_URL}/auth/magic?token=${token}` }
  },
}

// Create route handlers
export const { GET, POST } = createSupportRoutes(integration, {
  webhookSecret: process.env.SUPPORT_WEBHOOK_SECRET!,
})
```

## App Registration

Each app needs an entry in the `apps` table:

```typescript
{
  slug: 'total-typescript',
  name: 'Total TypeScript',
  front_inbox_id: 'inb_xxx',
  stripe_account_id: 'acct_xxx',
  integration_base_url: 'https://totaltypescript.com/api/support',
  webhook_secret: 'whsec_xxx',
  capabilities: ['refund', 'transfer', 'magic_link'],
  auto_approve_refund_days: 30,
  auto_approve_transfer_days: 14,
  escalation_slack_channel: 'C0XXXXXXX',
}
```

## File Locations

- SDK types: `packages/sdk/src/types.ts`
- Adapter interface: `packages/sdk/src/adapter.ts`
- CLI scaffolding: `packages/cli/src/commands/init.ts`

## Reference Docs

For full details, see:
- `docs/support-app-prd/67-sdk.md`
