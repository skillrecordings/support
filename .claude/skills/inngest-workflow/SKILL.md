---
name: inngest-workflow
description: Create Inngest workflows for durable execution. Use when building agent workflows, approval flows, scheduled tasks, or any multi-step async process.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Inngest Workflow Patterns

Inngest is the **only workflow engine** for this platform. All durable execution goes through Inngest.

## Core Pattern: Inbound Message Handler

```typescript
import { inngest } from './client'

export const handleInboundMessage = inngest.createFunction(
  {
    id: 'handle-inbound-message',
    // Throttle prevents duplicate processing
    throttle: {
      key: 'event.data.conversationId',
      limit: 1,
      period: '10s',
    },
  },
  { event: 'front/inbound_received' },
  async ({ event, step }) => {
    const { conversationId, appId, senderEmail } = event.data

    // Step 1: Gather context (retriable)
    const context = await step.run('gather-context', async () => {
      const [user, messages, app] = await Promise.all([
        appRegistry.get(appId).integration.lookupUser(senderEmail),
        front.conversations.listMessages(conversationId),
        appRegistry.get(appId),
      ])
      return { user, messages, app }
    })

    // Step 2: Agent reasoning (retriable)
    const agentResult = await step.run('agent-reasoning', async () => {
      return supportAgent.run({
        messages: [{ role: 'user', content: buildPrompt(context) }],
        context,
      })
    })

    // Step 3: Handle approval or execute
    if (agentResult.action?.requiresApproval) {
      await step.run('request-approval', async () => {
        await requestApproval({
          action: agentResult.action,
          conversationId,
          appId,
          agentReasoning: agentResult.reasoning,
        })
      })
    } else if (agentResult.action) {
      await step.run('execute-action', async () => {
        await executeAction(agentResult.action)
      })
    }

    // Step 4: Create draft response
    if (agentResult.draftResponse) {
      await step.run('create-draft', async () => {
        await front.conversations.createDraft(conversationId, {
          body: agentResult.draftResponse,
        })
      })
    }

    return { processed: true, action: agentResult.action }
  }
)
```

## Key Inngest Patterns

### Throttling (Dedupe)
```typescript
throttle: {
  key: 'event.data.conversationId',
  limit: 1,
  period: '10s',
}
```

### Wait for Event (Approval Flow)
```typescript
const approval = await step.waitForEvent('approval-received', {
  event: 'action/approved',
  match: 'data.actionId',
  timeout: '24h',
})
if (!approval) {
  await step.run('handle-timeout', () => expireAction(actionId))
}
```

### Sleep (Scheduled Tasks)
```typescript
await step.sleep('wait-for-send', '5m')
await step.run('auto-send', () => sendDraft(draftId))
```

### Invoke (Sub-workflows)
```typescript
await step.invoke('process-refund', {
  function: processRefundWorkflow,
  data: { purchaseId, reason },
})
```

## Event Naming Convention

```
{source}/{entity}.{action}

Examples:
- front/inbound_received
- front/outbound_sent
- action/approved
- action/rejected
- stripe/refund.completed
```

## Database Access in Workflows

**CRITICAL**: Use lazy initialization, not the singleton.

```typescript
// ❌ BAD - singleton creates pool at import time, fails in serverless
import { database, ActionsTable } from '@skillrecordings/database'

// ✅ GOOD - lazy init inside step function
import { getDb, ActionsTable } from '@skillrecordings/database'

await step.run('create-action', async () => {
  const db = getDb()  // Pool created here, at runtime
  await db.insert(ActionsTable).values({ ... })
})
```

Why: The `database` singleton calls `mysql.createPool()` at import time. In serverless/Turbopack builds, this fails because DATABASE_URL isn't available during static analysis.

## File Locations

- Inngest client: `packages/core/src/inngest/client.ts`
- Workflow definitions: `packages/core/src/inngest/workflows/`
- Event types: `packages/core/src/inngest/events.ts`

## Reference Docs

For full details, see:
- `docs/support-app-prd/65-workflows.md`
