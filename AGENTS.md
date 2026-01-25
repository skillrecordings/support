# AGENTS

Support platform monorepo (agent-first, Front is source of truth, HITL approvals).

## Package manager
- bun workspaces (no npm/pnpm)

## Core commands
- dev: `bun run dev`
- test: `bun run test`
- typecheck: `bun run check-types`
- lint: `bun run lint`
- format: `bun run format`

## Start here (progressive disclosure)
- Product/PRD: @docs/support-app-prd/00-index.md
- Conventions: @docs/CONVENTIONS.md
- Testing: @docs/TESTING.md
- Dev commands: @docs/DEV-COMMANDS.md
- Env/setup: @docs/ENV.md and @.claude/skills/ops-setup/SKILL.md

## Production URLs

| App | URL | Purpose |
|-----|-----|---------|
| Front Plugin | https://skill-support-agent-front.vercel.app | Inngest workflows, webhooks, cron |
| Web Dashboard | https://skill-support-agent-web.vercel.app | Admin UI, Stripe connect |
| Slack Bot | https://skill-support-agent-slack.vercel.app | Slack integration |

### Vercel Access

All apps deployed to **skillrecordings** org on Vercel.

```bash
# List projects
vercel project ls --scope skillrecordings

# List deployments for a specific app
vercel ls skill-support-agent-front --scope skillrecordings

# Inspect a deployment
vercel inspect <deployment-url> --scope skillrecordings

# View logs
vercel logs <deployment-url> --scope skillrecordings

# Pull env vars (from app directory)
cd apps/front && vercel env pull .env.local --scope skillrecordings
```

### API Endpoints

**Cron (refreshes Inngest function registration):**
```bash
curl https://skill-support-agent-front.vercel.app/api/cron
```
Runs automatically every 5 minutes via Vercel Crons. Call manually after deploying new workflows.

**Inngest:**
- Dev UI: https://skill-support-agent-front.vercel.app/api/inngest (PUT to register)
- Cloud dashboard: https://app.inngest.com (skillrecordings workspace)

## Adding a New Product (App)

1. **Get Front inbox ID** - Convert URL ID to API ID (see `@.claude/skills/front-id-converter/SKILL.md`)
2. **Run wizard** - `bun packages/cli/src/index.ts wizard`
3. **Insert into DB** - Use generated SQL or `bun run db:studio`
4. **Connect Stripe** - Visit `https://skill-support-agent-web.vercel.app/api/stripe/connect/authorize?appSlug=<slug>`
5. **Implement SDK** - Add handler in the product's codebase (see `@docs/support-app-prd/67-sdk.md`)

## CLI (`skill` command)

Run from `packages/cli` to pick up env vars:

```bash
cd packages/cli
bun src/index.ts <command>
```

Key commands:
- `skill tools list` - list registered apps
- `skill tools search <app> <query>` - test content search
- `skill tools lookup <app> <email>` - test user lookup
- `skill dataset build --output data.json` - build eval dataset from Front
- `skill front conversation <id>` - inspect Front conversation
- `skill responses list` - list recent agent responses

## Skills
Skills live under @.claude/skills/*/SKILL.md. If a task matches a skill, read it before acting. Use the skills.

## AI SDK / Vercel AI Gateway

Model references are **just strings** — no provider setup needed:

```typescript
import { generateObject, generateText } from 'ai'

// Just pass the model string directly
const { object } = await generateObject({
  model: 'anthropic/claude-haiku-4-5',  // ← string, not a provider call
  schema: mySchema,
  prompt: '...',
})
```

### Model Names (STRICT)

**ALWAYS use versionless names. No date suffixes. Nothing else.**

| Model | Use Case |
|-------|----------|
| `anthropic/claude-haiku-4-5` | Fast, cheap (evals, classification) |
| `anthropic/claude-sonnet-4-5` | Balanced (drafting, general) |
| `anthropic/claude-opus-4-5` | Best quality (complex reasoning) |

❌ **Never:** `claude-sonnet-4-20250514`, `claude-3-5-sonnet-latest`, etc.
✅ **Always:** `claude-sonnet-4-5`, `claude-haiku-4-5`, `claude-opus-4-5`

### Auth

The Vercel AI Gateway uses `AI_GATEWAY_API_KEY` (stable token, in `packages/cli/.env.local`).
- OIDC tokens (`VERCEL_OIDC_TOKEN`) expire and need refresh — avoid for scripts
- Pull env: `cd packages/cli && vercel env pull .env.local`

## Critical Anti-Patterns (learned the hard way)

### Testing
- **Use Vitest via Turborepo** - `bun run test`, not `bun test`
- Never convert tests to `bun:test` - different API, CI uses Vitest

### TypeScript
- **Zod 4.x** - repo uses Zod 4.3.5+ directly (`import { z } from 'zod'`)
- Don't reach for `@ts-ignore` first - find proper type solutions

### Package Structure
- **No barrel files** - use package.json subpath exports
- **Lazy DB init** - `getDb()` not `database` singleton in workflows

### Front Webhooks
- Webhooks send **previews only** - must fetch full data via API
- Handle URL verification challenge during webhook setup

### Inngest
- **Match field alignment** - `waitForEvent` match must align with triggering event data
- Check both producer and consumer use same field names

### Deployment
- **Git integration** for Vercel monorepo deploys
- **`echo -n`** when piping env vars (heredocs add newlines)

### HITL
- Always add approval gates for drafts before sending
- Don't auto-send without trust + confidence thresholds met
