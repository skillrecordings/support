# Architecture

## Intent
Agent-first support platform with human approvals. Front is source of truth for conversations.

## High-level flow (happy path)
1. Front webhook delivers conversation event.
2. Inngest workflow ingests and hydrates context.
3. Agent selects tools and drafts a response.
4. If approval is required, Slack approval flow gates execution.
5. Actions run (Stripe/Front/etc.), audit logged, response drafted in Front.

## System boundary
Inside repo:
- apps/web (Dashboard)
- apps/slack (Slack approvals bot)
- apps/front (Front plugin)
- packages/core (agent, tools, workflows, registry)
- packages/sdk (integration contract + adapters)
- packages/cli (skill CLI)

External:
- Front (source of truth for conversations)
- Stripe Connect (refunds)
- Slack (HITL approvals)
- Upstash Vector (hybrid retrieval)
- Axiom + Langfuse (observability)

## Source of truth
- Conversations + message state: Front
- Approvals: Slack
- Execution + audit: core workflows/tools

## Key constraints
- Workflow engine: Inngest only
- Vector search: Upstash defaults
- Auth: BetterAuth
- DB: PlanetScale
- Webhook signing: HMAC-SHA256, 5-minute replay, key rotation
- Cache: Durable Objects per conversation, 7-day TTL
