# Workflows (Inngest)

```typescript
import { inngest } from './client'

export const handleInboundMessage = inngest.createFunction(
  {
    id: 'handle-inbound-message',
    throttle: {
      key: 'event.data.conversationId',
      limit: 1,
      period: '10s',
    },
  },
  { event: 'front/inbound_received' },
  async ({ event, step }) => {
    const { conversationId, appId, senderEmail } = event.data

    const context = await step.run('gather-context', async () => {
      const [user, messages, app] = await Promise.all([
        appRegistry.get(appId).integration.lookupUser(senderEmail),
        front.conversations.listMessages(conversationId),
        appRegistry.get(appId),
      ])
      return { user, messages, app }
    })

    const agentResult = await step.run('agent-reasoning', async () => {
      return supportAgent.run({
        messages: [
          {
            role: 'user',
            content: `
              New support message received.

              Customer: ${context.user?.name || senderEmail}
              Email: ${senderEmail}
              Product: ${context.app.name}

              Purchase history:
              ${JSON.stringify(context.user?.purchases || [], null, 2)}

              Conversation:
              ${context.messages.map(m => `${m.author}: ${m.text}`).join('\n')}

              Determine the intent and propose an action.
            `,
          },
        ],
        context,
      })
    })

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

