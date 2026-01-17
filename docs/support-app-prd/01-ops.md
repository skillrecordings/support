# Phase 0 - Ops Readiness (No-Code Setup)

## Goal

All external accounts, keys, and access are ready so coding can proceed without pauses.

## Required Runbook (Step-by-Step)

### 1) Front
- Create a Front app with Webhooks + API access
- Generate webhook signing secret
- Create inboxes (one per product) + routing rules
- Create an API token with scopes for conversations, messages, tags, and drafts
- Capture: `FRONT_API_TOKEN`, `FRONT_WEBHOOK_SECRET`, inbox IDs per product

### 2) Slack
- Create Slack app + bot user
- Enable Interactivity & Shortcuts
- Enable Events API (as needed)
- Install app to workspace
- Create approval channel(s)
- Capture: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, approval channel ID

### 3) Stripe Connect
- Confirm platform account access
- Create Connect OAuth app
- Create webhook endpoint for Connect events
- Enable test mode
- Capture: `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_CLIENT_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`

### 4) Upstash Vector
- Create Vector DB (hybrid search defaults)
- Capture: `UPSTASH_VECTOR_URL`, `UPSTASH_VECTOR_TOKEN`

### 5) Axiom + Langfuse
- Axiom: create dataset + API token
- Langfuse: create project + keys
- Capture: `AXIOM_DATASET`, `AXIOM_TOKEN`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`

### 6) BetterAuth
- Create BetterAuth app
- Configure session cookie name + domain
- Configure OAuth providers if needed
- Capture: `BETTERAUTH_SECRET` + provider credentials

### 7) PlanetScale
- Create database + branch (prod + dev)
- Create least-privilege user
- Capture: `DATABASE_URL`

### 8) Cloudflare Workers / DO
- Create Cloudflare account + Workers project
- Create Durable Objects namespace
- Capture: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, DO namespace ID

### 9) Vercel
- Create Vercel projects (web, slack, front plugin)
- Set env var placeholders for all services
- Capture: project IDs for CI config

### 10) Secrets Storage
- Create KMS key for envelope encryption
- Ensure `app_secrets` table exists (see schema)
- Capture: `KMS_KEY_ID`

## PR-Ready Checklist

- All credentials stored in secret manager/ENV
- Validation: can hit Front/Slack/Stripe/Upstash with a test request

## Validation / Tests

- Smoke test each provider with minimal API call

