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

## Skills
Skills live under @.claude/skills/*/SKILL.md. If a task matches a skill, read it before acting. Use the skills.

## Critical Anti-Patterns (learned the hard way)

### Testing
- **Use Vitest via Turborepo** - `bun run test`, not `bun test`
- Never convert tests to `bun:test` - different API, CI uses Vitest

### TypeScript
- **Use `zod/v4`** not `zod` with AI SDK v6 (prevents TS2589)
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
