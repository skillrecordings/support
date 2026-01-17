---
name: ops-setup
description: Guide user through support platform setup. Use when user says "set up", "configure", "I'm on step X", or provides API keys/credentials.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Ops Setup Skill

You are guiding the user through setting up the support platform. Your job is to **maximize autonomy** - do everything you can automatically, only ask for human input when absolutely necessary.

## Your Capabilities

**You CAN do automatically:**
- Create/update .env files
- Validate API connections
- Run database migrations
- Configure webhook URLs via API
- Generate secrets
- Update configuration files
- Run smoke tests

**You NEED human to:**
- Create accounts (Front, Slack, Stripe, etc.)
- Copy API keys from dashboards
- Approve OAuth permissions

## Setup State Tracking

Track progress in `.env.local`. Check which vars are set:

```bash
# Check setup progress
cat .env.local 2>/dev/null | grep -v "^#" | grep -v "^$" | cut -d= -f1
```

## Interactive Flow

### When user provides a key/credential:

1. Immediately validate it:
```typescript
// Front
const res = await fetch('https://api2.frontapp.com/me', {
  headers: { Authorization: `Bearer ${token}` }
})

// Slack
const res = await fetch('https://slack.com/api/auth.test', {
  headers: { Authorization: `Bearer ${token}` }
})

// Stripe
const res = await fetch('https://api.stripe.com/v1/balance', {
  headers: { Authorization: `Basic ${btoa(key + ':')}` }
})

// Upstash
const res = await fetch(`${url}/info`, {
  headers: { Authorization: `Bearer ${token}` }
})
```

2. If valid, write to `.env.local`
3. Report what's next
4. If all keys for a service are present, run full validation

### When user says "I'm on step X" or "help with X":

1. Read the current `.env.local` to see what's configured
2. Give them ONLY the minimal human steps (create account, copy key)
3. Tell them to paste the key and you'll handle the rest

## Service Setup Scripts

Run these to validate and configure services:

### Front Validation
```bash
bun scripts/setup/validate-front.ts
```

### Slack Validation
```bash
bun scripts/setup/validate-slack.ts
```

### Stripe Validation
```bash
bun scripts/setup/validate-stripe.ts
```

### Full Validation
```bash
bun scripts/setup/validate-all.ts
```

## Webhook Auto-Configuration

Once Vercel URLs are known, auto-configure webhooks:

### Slack (via API)
```typescript
// Update interactivity URL
await fetch('https://slack.com/api/apps.manifest.update', {
  method: 'POST',
  headers: { Authorization: `Bearer ${configToken}` },
  body: JSON.stringify({
    manifest: {
      interactivity: { request_url: vercelUrl }
    }
  })
})
```

### Stripe (via API)
```typescript
const stripe = new Stripe(secretKey)
await stripe.webhookEndpoints.create({
  url: `${vercelUrl}/api/stripe/webhook`,
  enabled_events: ['charge.refunded', 'refund.created']
})
```

## Conversation Patterns

**User:** "Let's set up the platform"
**You:** Check .env.local, identify what's missing, start with first incomplete service. Give minimal human instructions.

**User:** "Here's my Front API token: fra_xxxxx"
**You:** Validate immediately, write to .env.local, ask for webhook secret next.

**User:** "I finished Slack setup"
**You:** Run validation script, report results, auto-configure if possible.

**User:** "What's left?"
**You:** Read .env.local, list unconfigured services, estimate remaining human steps.

## Priority Order

Set up services in this order (dependencies matter):

1. **PlanetScale** (database needed for everything)
2. **Front** (source of truth)
3. **Slack** (approvals)
4. **Stripe** (refunds)
5. **Upstash** (vector search)
6. **Cloudflare** (edge compute)
7. **Axiom + Langfuse** (observability)
8. **Vercel** (hosting - do last, then update webhook URLs)
9. **BetterAuth** (just needs secret generation)

## Quick Commands

Give users these to speed things up:

```bash
# Generate BetterAuth secret
openssl rand -base64 32

# Check what's configured
bun scripts/setup/status.ts

# Validate everything
bun scripts/setup/validate-all.ts

# Run migrations
bun db:migrate
```
