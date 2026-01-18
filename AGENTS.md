# AGENTS

## Support app PRD
Primary product requirements live here:
- docs/support-app-prd/00-index.md

## Product intent
Agent-first support platform with human-in-the-loop approvals. Front is source of truth for conversations; the agent is the brain.

## Success criteria
- Reduce human touches by 80%
- Draft response within 60 seconds
- Full traceability for decisions/actions/approvals
- Add a new app via `skill init`

## Key decisions (from PRD)
- Workflow engine: Inngest only
- Vector search: Upstash defaults (hybrid, hosted embeddings)
- Auth: BetterAuth
- Database: PlanetScale
- Webhook signing: HMAC-SHA256, Stripe-style, 5-minute replay, key rotation
- Cache: Durable Objects per conversation, 7-day TTL

## System boundary (high level)
Inside repo:
- apps/web (Dashboard)
- apps/slack (Slack approvals bot)
- apps/front (Front plugin)
- packages/core (agent, tools, workflows, registry)
- packages/sdk (integration contract + adapters)
- packages/cli (skill CLI)

External systems:
- Front (source of truth for conversations)
- Stripe Connect (refunds)
- Slack (HITL approvals)
- Upstash Vector (hybrid retrieval)
- Axiom + Langfuse (observability)

## Tech stack + deploy targets
See the authoritative list in:
- docs/support-app-prd/61-stack-runtime.md

## Project rules
- Use official CLIs to generate/initialize standard config or scaffolds (tsconfig, turbo, tailwind, changesets, etc.).
- Avoid hand-editing or hand-adding package/tool boilerplate unless there is no CLI or it fails.
- TDD is mandatory: red → green → refactor. Add a failing test first, make it pass, then clean up.
- Use the `.claude/skills/tdd-red-green-refactor` skill for all testable changes.
- Keep docs current: update `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`, `docs/DECISIONS.md`, `docs/ENV.md`, `docs/BOUNDARIES.md`, `docs/GLOSSARY.md`, `docs/TESTING.md`, and `docs/DEV-COMMANDS.md` when behavior or structure changes.
