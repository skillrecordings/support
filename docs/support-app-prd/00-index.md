# Support Platform PRD (Overview)

> Agent-first customer support platform with human-in-the-loop for Skill Recordings products.

## Purpose

This is the overview and index. Start here. Detailed implementation instructions live in phase and reference docs.

## Vision

Every support interaction is an opportunity for an agent to help. The agent handles the high-volume, brain-dead stuff automatically. Humans approve edge cases via Slack or dashboard. Front remains the source of truth for conversations, but the agent is the brain.

## Success Criteria

1. Reduce human touches by 80%
2. Sub-minute response time (draft within 60s)
3. Full traceability (every decision/action/approval logged)
4. Multi-app robustness (adding a new app is a `skill init` away)

## Locked Decisions (Summary)

- Inbox model: one inbox per product
- Workflow engine: Inngest only
- Vector search: Upstash defaults (hybrid, hosted embeddings)
- Auth: BetterAuth
- Database: PlanetScale
- Webhook signing: HMAC-SHA256, Stripe-style, 5-minute replay, key rotation
- Draft diff: token overlap with cleanup
- Trust decay: exponential, 30-day half-life
- Cache: Durable Objects per conversation, 7-day TTL
- Context strategy: minimal live context, retrieval-first, structured data in DB, everything else behind search
- **Stripe integration: Query on-demand, don't warehouse events.** Platform is the "queen" - orchestrates via Stripe Connect API queries. Apps notify us of actions via SDK. Minimal webhook monitoring (deauth, disputes only).

## System Boundary (High Level)

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

## Implementation Index (PRD Format)

Phases are PR-ready units. Use the phase docs to execute.

- Phase 0: Ops Readiness (No-Code Setup)
  - ./phases/01-ops.md
- Phase 0.5: Bedrock Repo
  - ./phases/02-bedrock.md
- Phase 1: Registry + Ingestion
  - ./phases/03-registry-ingestion.md
- Phase 2: Agent Core + Actions
  - ./phases/04-agent-actions.md
- Phase 3: HITL Surfaces
  - ./phases/05-hitl-surfaces.md
- Phase 4: SDK + First App
  - ./phases/06-sdk-first-app.md
- Phase 5: Stripe Connect
  - ./phases/07-stripe-connect.md
- Phase 6: Vector + Trust + Auto-send
  - ./phases/08-vector-trust.md
- Phase 7: Polish + Ops
  - ./phases/09-polish-ops.md
- Phase 8: Routing + Caching + Canned Responses + Evals
  - ./phases/10-routing-caching-evals.md

## Reference Index

Use these for detailed implementation and policies.

- Docs Index: ../README.md
- Repo Architecture (agent-friendly): ../ARCHITECTURE.md
- Repo Conventions: ../CONVENTIONS.md
- Decisions Log: ../DECISIONS.md
- Environment Setup Notes: ../ENV.md
- Boundaries: ../BOUNDARIES.md
- Glossary: ../GLOSSARY.md
- Testing: ../TESTING.md
- Dev Commands: ../DEV-COMMANDS.md
- Architecture + Boundaries: ./60-architecture.md
- Tech Stack + Deploy Targets: ./61-stack-runtime.md
- Event Ingestion: ./62-event-ingestion.md
- Webhook Signing: ./63-webhook-signing.md
- Agent + Tools: ./64-agent-tools.md
- Workflows (Inngest): ./65-workflows.md
- HITL (Slack/Front/Dashboard): ./66-hitl.md
- SDK + Adapter: ./67-sdk.md
- CLI (skill): ./68-cli.md
- Data Model: ./69-data-model.md
- Observability: ./70-observability.md
- Vector Search: ./71-vector-search.md
- Agent Context Strategy: ./72-context-strategy.md
- Secrets + Encryption: ./73-secrets.md
- Defaults (Retention, SLAs, Policies): ./74-defaults.md
- Distributed Systems Patterns: ./75-distributed-patterns.md
- Front Integration + Webhooks: ./76-front-integration.md
