---
name: front-webhook
description: Handle Front webhook events for the support platform. Use when implementing conversation ingestion, message handlers, Front API integrations, or webhook signature verification.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Front Webhook Handler

Front is the **source of truth for all conversations**. Every support interaction starts with a Front webhook.

## Webhook Signature Verification

Use HMAC-SHA256 with Stripe-style format and replay protection:

```typescript
// Header format: x-support-signature: t=[PHONE],v1=5257a869...,v1=oldkeysig...

function verifySignature(payload: string, header: string, secrets: string[]): boolean {
  const { timestamp, signatures } = parseHeader(header)

  // 5-minute replay protection
  if (Date.now() - timestamp > 5 * 60 * 1000) return false

  const signedPayload = `${timestamp}.${payload}`

  // Support multiple signatures for key rotation
  return secrets.some(secret =>
    signatures.some(sig =>
      timingSafeEqual(hmacSha256(signedPayload, secret), Buffer.from(sig, 'hex'))
    )
  )
}
```

## Webhook Handler Pattern

```typescript
export async function handleFrontWebhook(req: Request) {
  // 1. Verify signature
  const verified = await verifySupportSignature(req)
  if (!verified) return new Response('Unauthorized', { status: 401 })

  // 2. Parse event and find app
  const event = await parseFrontEvent(req)
  const app = await appRegistry.findByFrontInbox(event.inboxId)
  if (!app) return new Response('Unknown inbox', { status: 404 })

  // 3. Dispatch to Inngest for durable processing
  await inngest.send({
    name: 'front/event.received',
    data: { event, appId: app.id }
  })

  return new Response('OK', { status: 200 })
}
```

## Front Event Types

| Event | Trigger | Action |
|-------|---------|--------|
| `inbound_received` | New customer message | Classify, extract intent, propose response/action |
| `outbound_sent` | Agent sends message | Log, update state, detect promises made |
| `assignee_changed` | Conversation reassigned | Handoff context to new agent |
| `tag_added` | Tag applied | Trigger workflows (e.g., "urgent" → Slack escalation) |

## File Locations

- Webhook handler: `apps/front/app/api/front/webhook/route.ts`
- Event types: `packages/core/src/types/front.ts`
- Signature verification: `packages/core/src/webhooks/verify.ts`

## Reference Docs

For full details, see:
- `docs/support-app-prd/62-event-ingestion.md`
- `docs/support-app-prd/63-webhook-signing.md`
