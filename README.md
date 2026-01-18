# Skill Recordings Support Platform

Agent-first support platform with human-in-the-loop approvals. Front is the source of truth for conversations; the agent is the brain.

## Docs
- `docs/README.md` (index)
- `docs/support-app-prd/00-index.md` (PRD)
- `AGENTS.md` (agent rules)

## Apps
- `apps/web`: Dashboard
- `apps/slack`: Slack approvals bot
- `apps/front`: Front plugin
- `apps/docs`: Docs site (optional)

## Packages
- `packages/core`: agent + tools + workflows
- `packages/sdk`: integration contract + adapters
- `packages/cli`: skill CLI
- `packages/database`: DB layer
- `packages/ui`: shared primitives

## Commands
```bash
bun run dev
bun run test
bun run lint
```
