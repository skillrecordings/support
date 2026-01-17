# Agent + Tools

## Agent Core (Mastra)

```typescript
import { Agent } from '@mastra/core'
import { supportTools } from './tools'

export const supportAgent = new Agent({
  name: 'support-agent',
  instructions: `
    You are a support agent for Skill Recordings products.

    Your goal is to resolve customer issues quickly and empathetically.

    ## Authority Levels

    AUTO-APPROVE (do immediately):
    - Magic link requests
    - Password reset requests
    - Refunds within 30 days of purchase
    - Transfers within 14 days of purchase
    - Email/name updates

    REQUIRE-APPROVAL (draft action, wait for human):
    - Refunds 30-45 days after purchase
    - Transfers after 14 days
    - Bulk seat management
    - Account deletions

    ALWAYS-ESCALATE (flag for human, do not act):
    - Angry/frustrated customers (detect sentiment)
    - Legal language (lawsuit, lawyer, etc.)
    - Repeated failed interactions
    - Anything you're uncertain about

    ## Response Style
    - Be personal, use first names
    - Be concise, not verbose
    - Don't apologize excessively
    - Focus on resolution, not explanation
  `,
  model: { provider: 'anthropic', name: 'claude-sonnet-4-20250514' },
  tools: supportTools,
})
```

## Tools (Actions)

```typescript
import { createTool } from '@mastra/core'

export const supportTools = {
  lookupUser: createTool({
    name: 'lookup_user',
    description: 'Look up a user by email to get their account details and purchase history',
    parameters: z.object({
      email: z.string().email(),
      appId: z.string(),
    }),
    execute: async ({ email, appId }) => {
      const app = await appRegistry.get(appId)
      return app.integration.lookupUser(email)
    },
  }),

  processRefund: createTool({
    name: 'process_refund',
    description: 'Process a refund for a purchase. Use only within policy.',
    parameters: z.object({
      purchaseId: z.string(),
      appId: z.string(),
      reason: z.string(),
    }),
    requiresApproval: (params, context) => {
      const purchase = context.purchases.find(p => p.id === params.purchaseId)
      const daysSincePurchase = daysBetween(purchase.purchasedAt, new Date())
      return daysSincePurchase > 30
    },
    execute: async ({ purchaseId, appId, reason }, { approvalId }) => {
      const stripeRefund = await stripe.refunds.create({
        charge: purchase.stripeChargeId,
      }, {
        stripeAccount: app.stripeAccountId,
      })

      await app.integration.revokeAccess({
        purchaseId,
        reason,
        refundId: stripeRefund.id,
      })

      await auditLog.record({
        action: 'refund',
        purchaseId,
        appId,
        approvalId,
        stripeRefundId: stripeRefund.id,
      })

      return { success: true, refundId: stripeRefund.id }
    },
  }),

  generateMagicLink: createTool({
    name: 'generate_magic_link',
    description: 'Generate a magic login link for a user',
    parameters: z.object({
      email: z.string().email(),
      appId: z.string(),
    }),
    execute: async ({ email, appId }) => {
      const app = await appRegistry.get(appId)
      return app.integration.generateMagicLink({ email, expiresIn: 300 })
    },
  }),

  transferPurchase: createTool({
    name: 'transfer_purchase',
    description: 'Transfer a purchase from one user to another',
    parameters: z.object({
      purchaseId: z.string(),
      fromEmail: z.string().email(),
      toEmail: z.string().email(),
      appId: z.string(),
    }),
    requiresApproval: (params, context) => {
      const purchase = context.purchases.find(p => p.id === params.purchaseId)
      const daysSincePurchase = daysBetween(purchase.purchasedAt, new Date())
      return daysSincePurchase > 14
    },
    execute: async ({ purchaseId, fromEmail, toEmail, appId }) => {
      const app = await appRegistry.get(appId)
      return app.integration.transferPurchase({
        purchaseId,
        fromUserId: context.user.id,
        toEmail,
      })
    },
  }),

  draftResponse: createTool({
    name: 'draft_response',
    description: 'Draft a response to send to the customer via Front',
    parameters: z.object({
      conversationId: z.string(),
      body: z.string(),
      appId: z.string(),
    }),
    execute: async ({ conversationId, body, appId }) => {
      await front.conversations.createDraft(conversationId, {
        body,
        author_id: 'support-bot',
      })
      return { drafted: true }
    },
  }),

  escalateToHuman: createTool({
    name: 'escalate_to_human',
    description: 'Escalate this conversation to a human support agent',
    parameters: z.object({
      conversationId: z.string(),
      reason: z.string(),
      urgency: z.enum(['low', 'medium', 'high']),
    }),
    execute: async ({ conversationId, reason, urgency }) => {
      await front.conversations.addTag(conversationId, 'needs-human')

      await slack.postMessage({
        channel: SUPPORT_CHANNEL,
        text: `🚨 Escalation needed`,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Reason:* ${reason}\n*Urgency:* ${urgency}` },
          },
          {
            type: 'actions',
            elements: [
              { type: 'button', text: { type: 'plain_text', text: 'Open in Front' }, url: frontConversationUrl },
            ],
          },
        ],
      })

      return { escalated: true }
    },
  }),
}
```

