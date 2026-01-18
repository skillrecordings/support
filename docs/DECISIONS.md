# Decisions

Record non-trivial decisions here. Keep entries short and dated.

## 2026-01-17
- Workflow engine is Inngest only.
- Vector search defaults to Upstash (hybrid, hosted embeddings).
- Auth is BetterAuth.
- Database is PlanetScale.
- Webhook signing: HMAC-SHA256, 5-minute replay, key rotation.
- Cache: Durable Objects per conversation, 7-day TTL.
- UI libraries: `apps/front` uses `@frontapp/ui-kit`, `apps/web` uses shadcn/ui + Tailwind, `apps/slack` has no UI.

## 2026-01-18
- Lazy database init: `getDb()` over `database` singleton in Inngest workflows. Singleton triggers MySQL pool creation at import time, fails in serverless builds.
- Drizzle operators re-exported from `@skillrecordings/database` to avoid version conflicts between packages.
- t3-env `skipValidation` enabled for test environments (VITEST, NODE_ENV=test).
- AI SDK v6: Use `inputSchema` not `parameters`, `stopWhen: stepCountIs(n)` not `maxSteps`, `ModelMessage` not `CoreMessage`. Skill at `.claude/skills/ai-sdk/`.
- Added Phase 8 for routing + caching + canned responses + evals to reduce inference costs and enforce quality gates.
- tsconfig: Migrated to `@total-typescript/tsconfig` with bundler module resolution. No `.js` extensions needed.
- **Stripe integration philosophy: Query on-demand, don't warehouse events.**
  - Platform is the "queen" (orchestrator), not a data warehouse.
  - Query Stripe Connect API on-demand when agent needs payment history.
  - Apps notify us of their actions via SDK integration (refunds, transfers, etc.).
  - Minimal webhook monitoring: only `account.application.deauthorized` (cleanup) and optionally `charge.dispute.created` (urgent).
  - No bulk event ingestion - we'd miss historical data anyway, and Stripe is the source of truth.
  - Agent tools query connected accounts directly for context (e.g., `getPaymentHistory`).
