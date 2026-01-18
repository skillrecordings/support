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
