# Environment

## Files
- `.env.local` at repo root for local development (gitignored)
- `.env.example` for documentation (committed)

## Current Variables (Phase 1)

### Front (webhooks)
```bash
FRONT_WEBHOOK_SECRET=    # App signing key from Front developer settings
FRONT_API_TOKEN=         # API token for fetching conversation data
```

### Inngest (workflows)
```bash
INNGEST_SIGNING_KEY=     # signkey-prod-... from Inngest dashboard
INNGEST_EVENT_KEY=       # Event key from Inngest dashboard
```

## Planned Variables (Future Phases)

### Slack (HITL approvals)
- `SLACK_BOT_TOKEN` - Bot token from Slack app (xoxb-...)
- `SLACK_SIGNING_SECRET` - Signing secret for verifying requests
- `SLACK_APPROVAL_CHANNEL` - Channel ID for posting approvals (C...)

### Stripe (refunds)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

### Upstash (vector search)
- `UPSTASH_VECTOR_URL`
- `UPSTASH_VECTOR_TOKEN`

### Observability
- `AXIOM_TOKEN`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`

### Database
- `DATABASE_URL` (PlanetScale)

### Auth
- `BETTERAUTH_SECRET`

## Syncing Local → Vercel

Use the Vercel CLI to push local env vars to production:

```bash
# Push a single var (MUST use echo -n to avoid newlines!)
echo -n 'your-value' | vercel env add VAR_NAME production

# Pull all production vars to local
vercel env pull .env.local
```

See `.claude/skills/vercel-cli/SKILL.md` for full documentation.

## Validation
Use `docs/SETUP-GUIDE.md` for service-specific validation commands.
