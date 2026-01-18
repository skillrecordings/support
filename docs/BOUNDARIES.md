# Boundaries

## Source of truth
- Conversations and message state: Front
- Approvals: Slack

## Non-negotiable tech choices
- Workflows: Inngest only
- Vector search: Upstash defaults
- Auth: BetterAuth
- Database: PlanetScale
- Webhook signing: HMAC-SHA256, 5-minute replay, key rotation
- Cache: Durable Objects per conversation, 7-day TTL

## Do / Don’t
- Do route approvals through HITL
- Don’t bypass approval gates for risky actions
- Do keep integrations behind `packages/sdk`
- Don’t add alternate workflow engines
