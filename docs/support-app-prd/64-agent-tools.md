# Agent + Tools

## Agent Core (AI SDK v6)

```typescript
import { generateText, tool, stepCountIs, type ModelMessage } from 'ai'
import { z } from 'zod'

// Agent is invoked via generateText with tools
export async function runSupportAgent(context: AgentContext): Promise<AgentResult> {
  const result = await generateText({
    model: anthropic('claude-sonnet-4-[PHONE]'),
    messages: context.messages,
    system: SUPPORT_AGENT_PROMPT, // See packages/core/src/agent/config.ts
    tools: supportTools,
    stopWhen: stepCountIs(10),
  })
  return result
}

// System prompt (excerpt):
const SUPPORT_AGENT_PROMPT = `
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
`
```

## Tools (Actions)

Tools use AI SDK v6's `tool()` helper with Zod schemas:

```typescript
import { tool } from 'ai'
import { z } from 'zod'

export const supportTools = {
  lookupUser: tool({
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

  processRefund: tool({
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

  generateMagicLink: tool({
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

  transferPurchase: tool({
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

  draftResponse: tool({
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

  escalateToHuman: tool({
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

  // SDK 0.3.0+ - Search product content
  searchProductContent: tool({
    description: 'Search product content to find relevant resources to share with customers',
    inputSchema: z.object({
      query: z.string().describe('What the customer is looking for'),
      types: z.array(z.enum(['course', 'lesson', 'article', 'resource', 'social'])).optional(),
      limit: z.number().optional().default(5),
    }),
    execute: async ({ query, types, limit }, context) => {
      const app = await getApp(context.appId)
      const client = new IntegrationClient({
        baseUrl: app.integration_base_url,
        webhookSecret: app.webhook_secret,
      })
      return cachedContentSearch(app.id, { query, types, limit }, () =>
        client.searchContent({ query, types, limit })
      )
    },
  }),
}
```

