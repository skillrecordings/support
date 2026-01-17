---
name: agent-tool
description: Define tools for the support agent. Use when adding new capabilities like refund processing, license transfer, knowledge lookup, or any agent action.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Agent Tool Definition

Tools are the agent's hands. Every action the agent can take is a tool with defined parameters, approval requirements, and execution logic.

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

## Tool Definition Pattern

```typescript
import { createTool } from '@mastra/core'
import { z } from 'zod'

export const processRefund = createTool({
  name: 'process_refund',
  description: 'Process a refund for a purchase. Use only within policy.',

  // Zod schema for parameters
  parameters: z.object({
    purchaseId: z.string(),
    appId: z.string(),
    reason: z.string(),
  }),

  // Dynamic approval requirement based on context
  requiresApproval: (params, context) => {
    const purchase = context.purchases.find(p => p.id === params.purchaseId)
    const daysSincePurchase = daysBetween(purchase.purchasedAt, new Date())
    return daysSincePurchase > 30  // Auto-approve within 30 days
  },

  // Execution logic
  execute: async ({ purchaseId, appId, reason }, { approvalId }) => {
    const app = await appRegistry.get(appId)
    const purchase = await app.integration.getPurchase(purchaseId)

    // Process via Stripe Connect
    const stripeRefund = await stripe.refunds.create({
      charge: purchase.stripeChargeId,
    }, {
      stripeAccount: app.stripeAccountId,
    })

    // Revoke access in the app
    await app.integration.revokeAccess({
      purchaseId,
      reason,
      refundId: stripeRefund.id,
    })

    // Audit log
    await auditLog.record({
      action: 'refund',
      purchaseId,
      appId,
      approvalId,
      stripeRefundId: stripeRefund.id,
    })

    return { success: true, refundId: stripeRefund.id }
  },
})
```

## Standard Tools

| Tool | Description | Approval |
|------|-------------|----------|
| `lookup_user` | Get user details and purchase history | Never |
| `process_refund` | Issue a refund via Stripe Connect | >30 days |
| `generate_magic_link` | Create login link for user | Never |
| `transfer_purchase` | Move purchase to another user | >14 days |
| `draft_response` | Create draft reply in Front | Never |
| `escalate_to_human` | Flag for human review | Never |

## Tool Examples

### Lookup User (No Approval)
```typescript
export const lookupUser = createTool({
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
})
```

### Escalate to Human
```typescript
export const escalateToHuman = createTool({
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
      text: `Escalation needed`,
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
})
```

## File Locations

- Agent definition: `packages/core/src/agent/index.ts`
- Tool definitions: `packages/core/src/tools/`
- Tool types: `packages/core/src/types/tools.ts`

## Reference Docs

For full details, see:
- `docs/support-app-prd/64-agent-tools.md`
