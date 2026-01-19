# Do / Don't

## Workflows & Data
- Do keep workflows in Inngest
- Do keep Front as conversation source of truth
- Do use `getDb()` in workflow steps, not `database` singleton
- Don't add alternative workflow engines
- Don't bypass approval gates for risky actions
- Don't import `drizzle-orm` directly in packages that consume `@skillrecordings/database`

## Testing
- Do use Vitest via Turborepo (`bun run test`)
- Do use Turborepo filters for targeted tests (`bun run test --filter=core`)
- Don't use `bun:test` (Bun's built-in test runner) - it has different APIs
- Don't convert existing Vitest tests to bun:test

## Package Exports
- Do use subpath exports in package.json for module boundaries
- Do import from subpaths (`@skillrecordings/core/agent`)
- Don't create barrel files (index.ts that re-exports everything)
- Don't use main entry point exports for monorepo packages

## TypeScript
- Do find proper type solutions (generics, assertions, narrowing)
- Do simplify complex generic chains when hitting TS2589
- Don't use `@ts-ignore` or `@ts-expect-error` as first resort
- Don't leave type gymnastics without a comment explaining why

## Front Integration
- Do fetch full message content via Front API (webhooks only send previews)
- Do handle URL verification challenges in webhook handlers
- Don't assume webhook payloads contain full message bodies

## HITL & Approvals
- Do add approval gates for drafts before sending
- Do require human review for any customer-facing response
- Don't auto-send without trust + confidence thresholds met

## Inngest Events
- Do ensure `waitForEvent` match fields align with triggering event data
- Do use consistent field names across event producer and consumer
- Don't assume event shapes without checking both sides

## Deployment
- Do use Git integration for Vercel monorepo deploys
- Do use `echo -n` when piping env vars to Vercel CLI
- Don't upload app directories directly (misses workspace dependencies)
- Don't use heredocs for Vercel env vars (adds trailing newlines)
