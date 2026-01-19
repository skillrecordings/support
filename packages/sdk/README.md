# packages/sdk

Integration contract for Skill Recordings products.

## Purpose

Apps (Total TypeScript, Pro Tailwind, etc.) implement `SupportIntegration` interface. The support platform calls these methods via HTTP with HMAC auth.

## Interface

```typescript
interface SupportIntegration {
  lookupUser(email: string): Promise<User | null>
  getPurchases(userId: string): Promise<Purchase[]>
  getSubscriptions?(userId: string): Promise<Subscription[]>
  revokeAccess(params: { purchaseId, reason, refundId }): Promise<ActionResult>
  transferPurchase(params: { purchaseId, fromUserId, toEmail }): Promise<ActionResult>
  generateMagicLink(params: { email, expiresIn }): Promise<{ url: string }>
  updateEmail?(params: { userId, newEmail }): Promise<ActionResult>
  updateName?(params: { userId, newName }): Promise<ActionResult>
  getClaimedSeats?(bulkCouponId: string): Promise<ClaimedSeat[]>
}
```

## Exports

- `integration.ts` - SupportIntegration interface + types
- `handler.ts` - Webhook handler factory
- `client.ts` - IntegrationClient for calling apps
- `adapter.ts` - Adapter utilities
- `types.ts` - Shared types (User, Purchase, etc.)
