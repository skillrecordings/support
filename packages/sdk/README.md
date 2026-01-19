# packages/sdk

Integration contract for Skill Recordings products.

## Purpose

Apps (Total TypeScript, Pro Tailwind, etc.) implement this interface to integrate with the support platform.

## Interface

```typescript
interface SupportIntegration {
  appId: string
  name: string
  frontInboxId: string
  stripeConnectedAccountId?: string

  // Callbacks
  lookupUser(email: string): Promise<User | null>
  getKnowledgeBase(): Promise<KnowledgeEntry[]>
}
```

## Usage

```typescript
import { createSupportAdapter } from '@skillrecordings/sdk'

export const adapter = createSupportAdapter({
  appId: 'total-typescript',
  name: 'Total TypeScript',
  frontInboxId: 'inb_xxx',
  stripeConnectedAccountId: 'acct_xxx',

  async lookupUser(email) {
    return db.query.users.findFirst({ where: eq(users.email, email) })
  },

  async getKnowledgeBase() {
    return [...faqEntries, ...docEntries]
  }
})
```

## Webhook Handler

```typescript
import { createWebhookHandler } from '@skillrecordings/sdk'

export const POST = createWebhookHandler(adapter)
```
