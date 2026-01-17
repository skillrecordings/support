# Tech Stack + Deploy Targets

## Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Monorepo | Turborepo + Bun | Fast, modern, good DX |
| Build | typescript-go | 10x faster type checking |
| Lint | oxlint + oxlint-tsgolint + biome | Fast linting + TS diagnostics + formatting |
| Framework | Next.js + Turbopack | RSC, streaming, Vercel hosting |
| Agent | Mastra + AI SDK | TypeScript-native, good tooling story |
| Workflows | Inngest | Durable execution, retries, scheduling |
| State | Cloudflare Durable Objects | Real-time, low-latency conversation state |
| Database | PlanetScale | MySQL at edge |
| Vector DB | Upstash Vector | Serverless, hybrid search, simple API |
| Observability | Axiom + Langfuse | Logs/traces + LLM-specific observability |
| Auth | BetterAuth | App registration + team access |

## Deploy Targets

| Component | Runtime |
|-----------|---------|
| Webhook ingestion | Cloudflare Workers |
| Conversation cache | Durable Objects |
| Vector search | Upstash Vector |
| Workflows | Inngest + Vercel |
| Dashboard + CLI API + Front plugin | Next.js on Vercel |
| Slack bot | Vercel |
