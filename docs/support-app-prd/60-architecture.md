# Architecture + Boundaries

## System Boundary

```
Support Platform (Turborepo)
- apps/web: Dashboard
- apps/slack: Slack approvals bot
- apps/front: Front plugin
- packages/core: agent, tools, workflows, registry
- packages/sdk: integration contract + adapters
- packages/cli: skill CLI

External:
- Front (source of truth for conversations)
- Stripe Connect (refunds)
- Slack (HITL approvals)
- Upstash Vector (hybrid retrieval)
- Axiom + Langfuse (observability)
```

## Vision

Every support interaction is an opportunity for an agent to help. The agent handles the high-volume, brain-dead stuff automatically. Humans approve edge cases via Slack or dashboard. Front remains the source of truth for conversations, but the agent is the brain.

## Success Criteria

1. Reduce human touches by 80%
2. Sub-minute response time (draft within 60s)
3. Full traceability (every decision/action/approval logged)
4. Multi-app robustness (adding a new app is a `skill init` away)

