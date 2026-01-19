# apps/web

Dashboard for support operations. Approval queue, trust scores, audit logs.

**Port**: 4100

## Routes

- `/` - Dashboard home
- `/api/stripe/connect/authorize` - Start Stripe Connect OAuth
- `/api/stripe/connect/callback` - OAuth callback
- `/api/stripe/webhooks` - Stripe webhook receiver

## Stack

- Next.js 16 (App Router)
- Shared UI from `packages/ui`

## Dev

```bash
bun run dev --filter=web
```
