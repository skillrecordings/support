# AGENTS

## Support app PRD
Primary product requirements live here:
- docs/support-app-prd/00-index.md

## Product intent
Agent-first support platform with human-in-the-loop approvals. Front is source of truth for conversations; the agent is the brain.

## Critical Architecture: Platform as Orchestrator

**The platform is the "queen of the hive" - it orchestrates, it doesn't execute financial actions.**

```
┌─────────────────────────────────────────────────────────────┐
│                    Support Platform                          │
│                    ("Queen of Hive")                         │
├─────────────────────────────────────────────────────────────┤
│  We QUERY via Connect       │  Apps NOTIFY us via SDK       │
│  ───────────────────        │  ─────────────────────        │
│  • Payment history          │  • Refund processed           │
│  • Subscription status      │  • Access revoked             │
│  • Customer details         │  • License transferred        │
│  • Charge/refund lookup     │  • Purchase created           │
└─────────────────────────────────────────────────────────────┘
```

**Platform responsibilities:**
- Provide context/intelligence to support agents
- Draft responses based on customer data
- Request HITL approval for actions
- Route requests to apps via SDK

**App responsibilities (via SDK):**
- Execute refunds (their Stripe, their policies)
- Revoke/grant access
- Transfer licenses
- Notify platform when actions complete

**Why?**
- Apps own their financial operations and business logic
- Platform provides intelligence, not execution
- Clear boundaries = safer, simpler system

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
- **Stripe integration: Query on-demand, don't warehouse events. Platform queries via Connect, apps notify us of actions via SDK. Platform does NOT process refunds.**

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
- Stripe Connect (query payment/subscription data - NOT for mutations)
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
- Use the @.claude/skills/tdd-red-green-refactor/SKILL.md skill for all testable changes.
- Keep docs current: update @docs/ARCHITECTURE.md, @docs/CONVENTIONS.md, @docs/DECISIONS.md, @docs/ENV.md, @docs/BOUNDARIES.md, @docs/GLOSSARY.md, @docs/TESTING.md, and @docs/DEV-COMMANDS.md when behavior or structure changes.

## WE USE VITEST NOT BUN:TEST

See @docs/TESTING.md and @.claude/skills/tdd-red-green-refactor/SKILL.md.

## NO BARREL FILES - Use Package Exports

**This is a hard mandate. No exceptions.**

See @docs/CONVENTIONS.md and @docs/TESTING.md.

### What is a barrel file?
An `index.ts` that just re-exports from other files:
```typescript
// BAD - barrel file
export * from './foo'
export * from './bar'
export { thing } from './baz'
```

### Why we avoid them
1. **Bundle size** - Tree-shaking fails, you get the whole module
2. **Circular deps** - Barrels create hidden dependency cycles
3. **Slower builds** - More files to parse on every import
4. **IDE confusion** - Autocomplete shows the barrel, not the source
5. **Test isolation** - Mocking through barrels is painful

### What to do instead: Package exports

Use `package.json` exports field to define public API:

```json
{
  "name": "@skillrecordings/core",
  "exports": {
    "./agent": "./src/agent/config.ts",
    "./tools": "./src/tools/create-tool.ts",
    "./tools/*": "./src/tools/*.ts",
    "./inngest": "./src/inngest/client.ts",
    "./inngest/workflows": "./src/inngest/workflows/index.ts"
  }
}
```

Then import directly:
```typescript
// GOOD - direct import via package exports
import { supportAgent } from '@skillrecordings/core/agent'
import { createTool } from '@skillrecordings/core/tools'
import { lookupUser } from '@skillrecordings/core/tools/lookup-user'
```

### When index.ts IS allowed
1. **Workflow aggregation** - `inngest/workflows/index.ts` that collects functions for serve()
2. **Internal module boundary** - Within a package, for logical grouping (not cross-package)
3. **Framework requirements** - Next.js route handlers, etc.

### Migration path
Existing barrels should be migrated to package exports when touched. Don't bulk-refactor, but don't add new barrels.

## Stub Markers

When adding temporary stubs or mocks for testing, mark them clearly:

```typescript
// TODO(REMOVE-STUB): Replace with real implementation
// Description of what this stub does
console.warn('[functionName] Using STUB - implement real thing')
return { stubbed: true }
```

Find all stubs:
```bash
grep -r "TODO(REMOVE-STUB)" packages/
```

**Rules:**
- Every stub gets `TODO(REMOVE-STUB)` comment
- Add `console.warn` so it's visible in logs
- Include brief description of what real implementation needs
