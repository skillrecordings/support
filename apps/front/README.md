# apps/front

Front plugin app. Receives webhooks from Front, triggers Inngest workflows.

**Port**: 4101

## Routes

- `/api/front/webhook` - Main Front webhook handler
- `/api/webhooks/front` - Alternate webhook route
- `/api/inngest` - Inngest function serve endpoint
- `/api/cron` - Scheduled tasks (retention cleanup, etc.)

## Stack

- Next.js 15 (App Router)
- Front UI Kit (`@frontapp/ui-kit`)
- Inngest client

## Dev

```bash
bun run dev --filter=front
```

## Webhook Setup

Configure in Front developer settings:
- URL: `https://<domain>/api/front/webhook`
- Events: `inbound`, `outbound`, `comment`
