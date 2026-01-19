# SDK + Adapter

## SupportIntegration Interface

```typescript
export interface SupportIntegration {
  lookupUser(email: string): Promise<User | null>
  getPurchases(userId: string): Promise<Purchase[]>
  getSubscriptions?(userId: string): Promise<Subscription[]>

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

  generateMagicLink(params: {
    email: string
    expiresIn: number
  }): Promise<{ url: string }>

  updateEmail?(params: {
    userId: string
    newEmail: string
  }): Promise<ActionResult>

  updateName?(params: {
    userId: string
    newName: string
  }): Promise<ActionResult>

  getClaimedSeats?(bulkCouponId: string): Promise<ClaimedSeat[]>

  /** Search product content (SDK 0.3.0+) */
  searchContent?(request: ContentSearchRequest): Promise<ContentSearchResponse>
}
```

## Next.js Adapter

```typescript
import { createSupportHandler } from './handler'
import type { SupportIntegration } from '../types'

export function createSupportRoutes(
  integration: SupportIntegration,
  options: { webhookSecret: string }
) {
  const handler = createSupportHandler(integration, options)

  return {
    GET: handler,
    POST: handler,
  }
}
```

