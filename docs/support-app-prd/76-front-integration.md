# Front Integration & Webhooks

## Webhook Architecture

Front offers two distinct webhook mechanisms with different tradeoffs:

### Application Webhooks (Production)

- **Use case**: Production deployment with live server
- **Requires**: Accessible public URL (Vercel deployment)
- **Signature**: HMAC-SHA256
- **Retries**: Yes (exponential backoff, multiple attempts)
- **Setup**: Configure webhook endpoint after Vercel deployment
- **Secret**: Obtained from Front App settings post-creation

Events supported: `inbound`, `outbound`, `conversation_assigned`, `tag_added`

### Rule Webhooks (Development/Testing)

- **Use case**: Local development, testing without ngrok
- **Requires**: No live server upfront (rule triggers webhook)
- **Signature**: HMAC-SHA1
- **Retries**: No (fire-and-forget)
- **Setup**: Front rule configured in UI
- **Limitation**: No automated replay, one-shot delivery

## Local Development Strategy

Don't use ngrok. Instead, build a polling-to-webhook bridge:

```
Front API (polling) → Transform to webhook payload → POST to localhost handler
```

**Benefits**:
- Control over event flow and replay
- Can test webhook handler without public URL
- Same code path as production webhooks
- Works offline
- Deterministic testing of retries and failures

### Implementation Pattern

Create `scripts/dev/front-poller.ts`:

```typescript
import { Inngest } from 'inngest'
import { createFrontClient } from '@/lib/front'

const inngest = new Inngest({ id: 'support-app' })
const front = createFrontClient(process.env.FRONT_API_TOKEN)

/**
 * Polling bridge: fetches new conversations from Front API
 * and emits webhook-like events to localhost handler
 */
export async function startFrontPoller() {
  const pollInterval = 5000 // 5 seconds for development

  setInterval(async () => {
    try {
      // Fetch recent conversations
      const conversations = await front.conversations.list({
        limit: 10,
        statuses: ['open'],
      })

      for (const conversation of conversations) {
        // Get latest message in conversation
        const messages = await front.messages.list({
          conversation_id: conversation.id,
          limit: 1,
        })

        const latestMessage = messages[0]

        // Emit as webhook payload
        if (latestMessage) {
          const payload = {
            type: latestMessage.author_id ? 'inbound_received' : 'outbound_sent',
            data: {
              conversation_id: conversation.id,
              message_id: latestMessage.id,
              author_id: latestMessage.author_id,
              body: latestMessage.body,
              created_at: latestMessage.created_at,
            },
          }

          // POST to local webhook handler
          await fetch('http://localhost:3000/api/webhooks/front', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-front-webhook-signature': generateDevSignature(payload),
            },
            body: JSON.stringify(payload),
          })
        }
      }
    } catch (error) {
      console.error('Front poller error:', error)
    }
  }, pollInterval)
}

function generateDevSignature(payload: unknown): string {
  // Dev mode: simplified signature for testing
  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify(payload)
  const hmac = createHmac('sha256', 'dev-secret')
  hmac.update(`${timestamp}.${body}`)
  return `t=${timestamp},v1=${hmac.digest('hex')}`
}
```

Run alongside webhook handler:
```bash
# Terminal 1: webhook handler
npm run dev

# Terminal 2: polling bridge
tsx scripts/dev/front-poller.ts
```

## Implementation Plan

### Phase 1: Production Setup

1. Deploy to Vercel
2. Create Front App (obtains webhook secret)
3. Configure Application Webhook endpoint:
   ```
   POST https://<vercel-url>/api/webhooks/front
   ```
4. Register webhook secret in environment (`FRONT_WEBHOOK_SECRET`)
5. Enable event subscriptions: `inbound`, `outbound`, `conversation_assigned`, `tag_added`

### Phase 2: Local Development

1. Create `scripts/dev/front-poller.ts` (see pattern above)
2. Front API token must have scopes (see API Scopes below)
3. Run poller alongside dev server
4. Webhook handler uses same signature verification code (works with dev-secret)

### Phase 3: Webhook Handler

Location: `apps/web/src/pages/api/webhooks/front.ts`

```typescript
import { verifySupportSignature } from '@/lib/webhooks'
import { handleFrontEvent } from '@/lib/front/event-handler'

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Verify signature (works for both prod Application Webhook and dev poller)
  const verified = await verifySupportSignature(req)
  if (!verified) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Parse and route to handler
  const event = await req.json()
  await handleFrontEvent(event)

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
```

## Front API Token Scopes

Token must have these scopes for full integration:

| Scope | Purpose |
|-------|---------|
| `shared:conversations` | Read/list conversations |
| `shared:messages` | Read/list messages |
| `shared:tags` | Read tags, add tags to conversations |
| `shared:contacts` | Read contact info (email, name) |
| `kb` | Access knowledge base for context retrieval |
| `tim:571743` | Team/workspace access (Front-specific ID) |

## Webhook Events for Production

These events should be configured in Application Webhook settings:

1. **`inbound`** - New inbound message
   - Used for: classification, intent extraction, response proposal
   - Triggers: agent analysis via Inngest

2. **`outbound`** - Message sent by agent/human
   - Used for: state tracking, promise detection
   - Triggers: logging, workflow state updates

3. **`conversation_assigned`** - Assignment changed
   - Used for: handoff context, routing decisions
   - Triggers: context refresh, reassignment logic

4. **`tag_added`** - Tag applied to conversation
   - Used for: workflow triggers (e.g., urgent → Slack escalation)
   - Triggers: conditional workflows

## Secret Management

- **Production**: Store `FRONT_WEBHOOK_SECRET` in Vercel environment
- **Development**: Use hardcoded `dev-secret` in poller and handler (not in .env)
- **Key Rotation**: Front supports multiple signatures in webhook header; rotate by adding new secret to verification list before removing old

## Testing Checklist

- [ ] Application Webhook configured post-deployment
- [ ] Webhook secret stored in Vercel env
- [ ] Local poller runs without errors
- [ ] Webhook handler receives and processes events
- [ ] Signature verification passes for both prod and dev
- [ ] Event routing to Inngest works
- [ ] Conversation context available in agent
- [ ] Tag-based workflow triggers (urgent escalation)
