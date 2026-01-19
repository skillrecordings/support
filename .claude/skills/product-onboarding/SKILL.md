# Product Onboarding Skill

Add a new Skill Recordings product to the support platform. Use when user says "add product", "new app", "onboard [product name]", or similar.

## Prerequisites

- Product has a Front inbox
- Product has a Stripe account (for refund processing)
- Product codebase is accessible

## Step 1: Get Front Inbox ID

Front uses base-36 encoded IDs with prefixes. Convert the numeric URL ID to API ID.

From a Front URL like:
```
https://app.frontapp.com/inboxes/teams/folders/7256583/unassigned/...
```

The inbox ID (7256583) converts to:
```javascript
'inb_' + (7256583).toString(36)  // => "inb_4bj7r"
```

See `@.claude/skills/front-id-converter/SKILL.md` for full reference.

## Step 2: Generate App Config

Run the wizard or generate manually:

```bash
bun packages/cli/src/index.ts wizard
```

Or generate directly:
```javascript
const crypto = require('crypto')
const id = 'app_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
const webhookSecret = crypto.randomBytes(32).toString('hex')
```

## Step 3: Insert into Database

```sql
INSERT INTO SUPPORT_apps (
  id, slug, name, front_inbox_id,
  integration_base_url, webhook_secret,
  capabilities, auto_approve_refund_days, auto_approve_transfer_days
)
VALUES (
  'app_xxxxxxxxxxxxxxxx',    -- Generated app ID
  'product-slug',            -- URL-friendly slug
  'Product Name',            -- Display name
  'inb_xxxxx',               -- Front inbox ID (base-36)
  'https://product.com/api/support',  -- SDK endpoint base URL
  'xxxxxxxx...',             -- 64-char hex webhook secret
  '["lookupUser","getPurchases","revokeAccess","transferPurchase","generateMagicLink"]',
  30,                        -- Auto-approve refunds within N days
  14                         -- Auto-approve transfers within N days
);
```

Or use Drizzle Studio: `bun run db:studio`

## Step 4: Connect Stripe via OAuth

After the app record exists, connect its Stripe account:

```
https://skill-support-agent-web.vercel.app/api/stripe/connect/authorize?appSlug=<slug>
```

This redirects to Stripe, authorizes the account, and stores `stripe_account_id` automatically.

## Step 5: Implement SDK in Product

### 5.1 Install SDK

```bash
# In product codebase
pnpm add @skillrecordings/sdk
# or
bun add @skillrecordings/sdk
```

### 5.2 Add Environment Variable

```bash
# .env.local
SUPPORT_WEBHOOK_SECRET=<webhook-secret-from-step-2>
```

### 5.3 Create Integration File

Create `app/api/support/integration.ts`:

```typescript
import type {
  ActionResult,
  Purchase,
  SupportIntegration,
  User,
} from '@skillrecordings/sdk/integration'

export const integration: SupportIntegration = {
  async lookupUser(email: string): Promise<User | null> {
    const user = await db.user.findUnique({ where: { email } })
    if (!user) return null
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? undefined,
      createdAt: user.createdAt,
    }
  },

  async getPurchases(userId: string): Promise<Purchase[]> {
    const purchases = await db.purchase.findMany({
      where: { userId },
      include: { product: true },
    })
    return purchases.map((p) => ({
      id: p.id,
      productId: p.productId,
      productName: p.product.name,
      purchasedAt: p.createdAt,
      amount: p.totalAmount,  // in cents
      currency: 'USD',
      stripeChargeId: p.chargeIdentifier ?? undefined,
      status: p.status as 'active' | 'refunded' | 'transferred',
    }))
  },

  async revokeAccess({ purchaseId, reason, refundId }): Promise<ActionResult> {
    await db.purchase.update({
      where: { id: purchaseId },
      data: { status: 'refunded', refundReason: reason }
    })
    return { success: true }
  },

  async transferPurchase({ purchaseId, fromUserId, toEmail }): Promise<ActionResult> {
    let toUser = await db.user.findUnique({ where: { email: toEmail } })
    if (!toUser) {
      toUser = await db.user.create({ data: { email: toEmail } })
    }
    await db.purchase.update({
      where: { id: purchaseId },
      data: { userId: toUser.id }
    })
    return { success: true }
  },

  async generateMagicLink({ email, expiresIn }): Promise<{ url: string }> {
    const token = await createMagicLinkToken(email, expiresIn)
    return { url: `${process.env.NEXT_PUBLIC_URL}/api/auth/magic?token=${token}` }
  },

  // Optional methods:
  // async updateEmail({ userId, newEmail }): Promise<ActionResult>
  // async updateName({ userId, newName }): Promise<ActionResult>
  // async getSubscriptions(userId: string): Promise<Subscription[]>
  // async getClaimedSeats(bulkCouponId: string): Promise<ClaimedSeat[]>
}
```

### 5.4 Create Route Handler

Create `app/api/support/[...action]/route.ts`:

```typescript
import { createSupportHandler } from '@skillrecordings/sdk/handler'
import { integration } from '../integration'

const handler = createSupportHandler({
  integration,
  webhookSecret: process.env.SUPPORT_WEBHOOK_SECRET!,
})

export { handler as POST }
```

### 5.5 Add to Env Schema (if using t3-env or similar)

```typescript
// env.mjs
server: {
  // ...existing vars
  SUPPORT_WEBHOOK_SECRET: z.string().optional(),
},
runtimeEnv: {
  // ...existing vars
  SUPPORT_WEBHOOK_SECRET: process.env.SUPPORT_WEBHOOK_SECRET,
},
```

## Step 6: Verify Integration

Test the endpoint is reachable:
```bash
curl -X POST https://product.com/api/support/health
```

Or use the CLI:
```bash
bun packages/cli/src/index.ts health --app product-slug
```

## Course-Builder Apps

For apps built on course-builder (like AI Hero), the schema is standardized:

- **Users**: `users` table with `id`, `email`, `name`, `createdAt`
- **Purchases**: `purchases` table with `userId`, `productId`, `totalAmount`, `status`, `merchantChargeId`
- **Products**: `products` table with `id`, `name`
- **Charges**: `merchantCharge` table with `identifier` (Stripe charge ID)
- **Transfers**: `purchaseUserTransfer` table for license transfers
- **Auth**: `courseBuilderAdapter.createVerificationToken()` for magic links

Import from:
```typescript
import { db, courseBuilderAdapter } from '@/db'
import { users, purchases, products, merchantCharge, purchaseUserTransfer } from '@/db/schema'
```

## Checklist

- [ ] Front inbox ID converted (base-36)
- [ ] App record inserted in SUPPORT_apps
- [ ] Stripe Connect OAuth completed
- [ ] SDK installed in product
- [ ] SUPPORT_WEBHOOK_SECRET in product's .env
- [ ] Integration file implements required methods
- [ ] Route handler created at `/api/support/[...action]`
- [ ] Env schema updated (if applicable)
- [ ] Endpoint tested

## Production URLs

| App | URL |
|-----|-----|
| Web (dashboard, Stripe) | https://skill-support-agent-web.vercel.app |
| Front Plugin | https://skill-support-agent-front.vercel.app |
| Slack Bot | https://skill-support-agent-slack.vercel.app |
