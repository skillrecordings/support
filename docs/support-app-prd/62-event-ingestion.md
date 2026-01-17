# Event Ingestion

**Source**: Front webhooks, Stripe webhooks (via Connect), app-reported events

```typescript
export async function handleFrontWebhook(req: Request) {
  const verified = await verifySupportSignature(req)
  if (!verified) return new Response('Unauthorized', { status: 401 })

  const event = await parseFrontEvent(req)
  const app = await appRegistry.findByFrontInbox(event.inboxId)
  if (!app) return new Response('Unknown inbox', { status: 404 })

  await inngest.send({
    name: 'front/event.received',
    data: { event, appId: app.id }
  })

  return new Response('OK', { status: 200 })
}
```

**Front events**:
- `inbound_received` → classify, extract intent, propose response/action
- `outbound_sent` → log, update state, detect promises made
- `assignee_changed` → handoff context
- `tag_added` → trigger workflows (urgent → Slack escalation)

