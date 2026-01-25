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

The `skill` CLI is for investigating support issues, debugging workflows, and managing the platform.

**Run from packages/cli** (picks up env vars):
```bash
cd packages/cli
bun src/index.ts <command>
```

**Or use the global alias** (if installed):
```bash
skill <command>
```

### Key Commands

**Inngest (workflow debugging):**
```bash
skill inngest events --after 1h           # Recent events
skill inngest event <id>                  # Event + triggered runs
skill inngest run <id>                    # Run status/output
skill inngest failures --after 2h         # Aggregate failure analysis
skill inngest stats --after 1d            # Stats + anomaly detection
skill inngest inspect <event-id>          # Deep dive: event + runs + results
skill inngest trace <run-id>              # Full workflow trace
skill inngest search "email@example"      # Search event data
```

**Front (conversation data):**
```bash
skill front message <id>                  # Full message with body
skill front conversation <id> -m          # Conversation + history
```

**Apps & integrations:**
```bash
skill tools list                          # List registered apps
skill tools search <app> <query>          # Test content search
skill tools lookup <app> <email>          # Test user lookup
skill health <app-slug>                   # Check integration health
skill wizard                              # Interactive app setup
```

**Responses & evals:**
```bash
skill responses list                      # Recent agent responses
skill responses list --rating bad         # Only bad-rated
skill responses get <id> --context        # Response + conversation
skill dataset build --output data.json    # Build eval dataset from Front
skill eval routing dataset.json           # Run routing eval
```

All commands support `--json` for machine-readable output.

**Full CLI docs:** `@.claude/skills/skill-cli/SKILL.md`

## Skills

Skills live under `@.claude/skills/*/SKILL.md`. Claude auto-activates them based on description matching. **Read the skill before acting.**

| Skill | Use When |
|-------|----------|
| `skill-cli` | Investigating issues, debugging workflows, inspecting Front/Inngest data |
| `front-api` | Working with Front REST API (conversations, messages, drafts, templates) |
| `front-webhook` | Handling inbound webhooks from Front |
| `front-plugin` | Building Front sidebar/composer plugins |
| `front-id-converter` | Converting Front URL IDs to API IDs |
| `inngest-workflow` | Creating/debugging Inngest workflows |
| `hitl-approval` | Human-in-the-loop approval flows, Slack review queue |
| `agent-tool` | Defining agent tools (refunds, license transfers, etc.) |
| `sdk-adapter` | SDK adapters, SupportIntegration, onboarding new apps |
| `stripe-connect` | Stripe Connect OAuth, refunds, charges |
| `vector-search` | RAG, semantic search, embeddings |
| `ai-sdk` | Vercel AI SDK (generateText, streamText, tools) |
| `ops-setup` | Environment setup, credentials, API keys |
| `vercel-cli` | Deploying, env vars, domains |
| `tdd-red-green-refactor` | Test-driven development with Vitest |
| `react-best-practices` | React/Next.js components, performance |
| `data-refresh-eval` | Refreshing eval datasets |

**Skills index:** `@.claude/skills/README.md`

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

❌ **Never:** `claude-sonnet-4-[PHONE]`, `claude-3-5-sonnet-latest`, etc.
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
