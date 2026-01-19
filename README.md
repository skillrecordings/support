# Skill Recordings Support Platform

Agent-first customer support for Skill Recordings products (Total TypeScript, Pro Tailwind, etc). Front is the conversation source of truth. AI agent drafts responses, humans approve via Slack or dashboard.

## Architecture

```
apps/
  front/     Front plugin - receives webhooks, triggers workflows (port 4101)
  slack/     HITL approvals bot - Slack interactions (port 4102)
  web/       Dashboard - approval queue, trust scores, audit logs (port 4100)
  docs/      Documentation site (port 4103)

packages/
  core/      Agent, router, tools, workflows, trust scoring, vector search
  database/  Drizzle ORM + PlanetScale schema
  sdk/       Integration contract for product apps
  cli/       Skill scaffolding CLI
  ui/        Shared React components
  eslint-config/  Shared lint rules
```

## Tech Stack

- **Runtime**: Bun workspaces, Turborepo
- **Framework**: Next.js 15 (App Router)
- **Database**: PlanetScale (MySQL) via Drizzle
- **Workflows**: Inngest (durable execution)
- **Vector**: Upstash Vector (hybrid search)
- **Cache/KV**: Upstash Redis
- **LLM**: Claude via AI SDK (Haiku for classification, Sonnet for responses)
- **Auth**: BetterAuth
- **Observability**: Axiom (traces), Langfuse (LLM)

## Commands

```bash
bun run dev           # All apps
bun run test          # Vitest via Turborepo
bun run check-types   # TypeScript
bun run lint          # Biome + ESLint
bun run format        # Biome format

# Targeted
bun run dev --filter=web
bun run test --filter=packages/core

# Database
bun run db:generate   # Generate migrations
bun run db:migrate    # Run migrations
bun run db:studio     # Drizzle Studio
```

## Key Flows

1. **Inbound message** - Front webhook -> Inngest workflow -> classify -> agent draft -> Slack approval
2. **Approval** - Slack button -> Inngest -> send via Front API -> update trust score
3. **Auto-send** - High trust + high confidence = skip approval, send immediately

## Docs

- PRD: `docs/support-app-prd/00-index.md`
- Conventions: `docs/CONVENTIONS.md`
- Testing: `docs/TESTING.md`
- Environment: `docs/ENV.md`
