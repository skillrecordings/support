# Environment

## Files
- `.env.local` at repo root for local development (gitignored)
- `.env.example` for documentation (committed)

## Required Variables

### Front (webhooks + API)
```bash
FRONT_WEBHOOK_SECRET=    # App signing key from Front developer settings
FRONT_API_TOKEN=         # API token for fetching conversation data
```

### Inngest (workflows)
```bash
INNGEST_SIGNING_KEY=     # signkey-prod-... from Inngest dashboard
INNGEST_EVENT_KEY=       # Event key from Inngest dashboard
```

### Slack (HITL approvals)
```bash
SLACK_BOT_TOKEN=           # Bot token from Slack app (xoxb-...)
SLACK_SIGNING_SECRET=      # Signing secret for verifying requests
SLACK_APPROVAL_CHANNEL=    # Channel ID for posting approvals (C...)
```

### Upstash Redis (trust scores, rules, cache)
```bash
UPSTASH_REDIS_REST_URL=    # https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=  # Token from Upstash console
```

### Upstash Vector (semantic search)
```bash
UPSTASH_VECTOR_REST_URL=   # https://xxx.upstash.io
UPSTASH_VECTOR_REST_TOKEN= # Token from Upstash console
```

### Database
```bash
DATABASE_URL=              # PlanetScale connection string
```

## Optional Variables

### Stripe (refunds via Connect)
```bash
STRIPE_SECRET_KEY=         # Platform secret key
STRIPE_CONNECT_CLIENT_ID=  # OAuth client ID (ca_xxx)
STRIPE_WEBHOOK_SECRET=     # Webhook endpoint secret
```

### Observability
```bash
AXIOM_TOKEN=               # Axiom API token for tracing
LANGFUSE_PUBLIC_KEY=       # Langfuse public key for LLM observability
LANGFUSE_SECRET_KEY=       # Langfuse secret key
```

### Auth
```bash
BETTERAUTH_SECRET=         # Generate with: openssl rand -base64 32
```

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
