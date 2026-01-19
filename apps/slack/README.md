# apps/slack

Slack bot for HITL approvals. Receives Slack interactions (button clicks), routes to Inngest.

**Port**: 4102

## Routes

- `/api/slack/events` - Slack Events API handler
- `/api/slack/interactions` - Button clicks, modal submissions

## Interactions

- Approve/reject draft buttons
- Rating buttons (thumbs up/down) for trust feedback
- Edit button opens modal for draft revision

## Stack

- Next.js 16 (App Router)
- Slack Web API (`@slack/web-api`)

## Dev

```bash
bun run dev --filter=slack
```

## Slack App Setup

Configure in Slack API dashboard:
- Interactivity URL: `https://<domain>/api/slack/interactions`
- Events URL: `https://<domain>/api/slack/events`
