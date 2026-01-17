# Support Platform Setup Guide

> Interactive setup guide for the support platform. Work through this with Claude - say "I'm on step X" and Claude will guide you through it.

## Prerequisites

- [ ] GitHub repo access (skillrecordings/support)
- [ ] Admin access to Skill Recordings Slack workspace
- [ ] Stripe platform account access
- [ ] Domain for the dashboard (e.g., support.skillrecordings.com)

---

## Phase 0: External Services Setup

### Step 1: Front Setup

**Goal:** Create Front app with webhooks and API access.

**What you need:**
- Front admin access
- Webhook endpoint URL (we'll use a placeholder, update later)

**Instructions:**

1. Go to Front Settings → Developers → API tokens
2. Click "Create API token"
   - Name: `support-platform`
   - Scopes: Select all of these:
     - `conversation:read`
     - `conversation:write`
     - `message:read`
     - `message:write`
     - `tag:read`
     - `tag:write`
     - `draft:read`
     - `draft:write`
     - `inbox:read`
   - Click "Create"
   - **Copy the token immediately** (you won't see it again)

3. Go to Front Settings → Developers → Webhooks
4. Click "Create webhook"
   - URL: `https://YOUR_DOMAIN/api/front/webhook` (placeholder for now)
   - Events: Select:
     - `inbound` (new inbound message)
     - `outbound` (message sent)
     - `conversation_assigned`
     - `tag_added`
   - Click "Create"
   - **Copy the webhook signing secret**

5. Note your inbox IDs:
   - Go to Settings → Inboxes
   - Click each inbox, copy the ID from the URL (format: `inb_xxxxx`)
   - You need one inbox per product (Total TypeScript, Pro Tailwind, etc.)

**Capture these values:**
```
FRONT_API_TOKEN=<your-api-token>
FRONT_WEBHOOK_SECRET=<your-webhook-signing-secret>
FRONT_INBOX_TOTAL_TYPESCRIPT=inb_xxxxx
FRONT_INBOX_PRO_TAILWIND=inb_xxxxx
# Add more inboxes as needed
```

**Validation:** Run this to test (replace token):
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" https://api2.frontapp.com/me
```
Should return your user info.

---

### Step 2: Slack App Setup

**Goal:** Create Slack app for approval notifications and interactions.

**What you need:**
- Slack workspace admin access
- Vercel project URL (placeholder for now)

**Instructions:**

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
   - App Name: `Support Approvals`
   - Workspace: Select your Skill Recordings workspace
   - Click "Create App"

3. **Basic Information** (left sidebar):
   - Scroll to "App Credentials"
   - **Copy the Signing Secret**

4. **OAuth & Permissions** (left sidebar):
   - Scroll to "Scopes" → "Bot Token Scopes"
   - Add these scopes:
     - `chat:write` (send messages)
     - `chat:write.public` (send to any public channel)
     - `users:read` (get user info for approvers)
     - `channels:read` (list channels)

5. **Install App** (left sidebar):
   - Click "Install to Workspace"
   - Review permissions, click "Allow"
   - **Copy the Bot User OAuth Token** (starts with `xoxb-`)

6. **Interactivity & Shortcuts** (left sidebar):
   - Toggle "On"
   - Request URL: `https://YOUR_DOMAIN/api/slack/interactions` (placeholder)
   - Click "Save Changes"

7. **Event Subscriptions** (left sidebar):
   - Toggle "On"
   - Request URL: `https://YOUR_DOMAIN/api/slack/events` (placeholder)
   - Subscribe to bot events:
     - `app_mention` (optional, for @mentions)
   - Click "Save Changes"

8. **Create approval channel:**
   - In Slack, create channel: `#support-approvals`
   - Invite the bot: `/invite @Support Approvals`
   - Copy the channel ID (right-click channel → "Copy link", ID is the `C0XXXXXXX` part)

**Capture these values:**
```
SLACK_BOT_TOKEN=xoxb-xxxxx
SLACK_SIGNING_SECRET=<your-signing-secret>
SLACK_APPROVAL_CHANNEL_ID=C0XXXXXXX
```

**Validation:** Run this to test (replace token):
```bash
curl -H "Authorization: Bearer xoxb-YOUR-TOKEN" https://slack.com/api/auth.test
```
Should return `"ok": true` with your bot info.

---

### Step 3: Stripe Connect Setup

**Goal:** Configure Stripe Connect for processing refunds on connected accounts.

**What you need:**
- Stripe platform account access
- Each product's Stripe account ID (they're probably already connected)

**Instructions:**

1. Go to https://dashboard.stripe.com
2. Make sure you're on the **platform account** (not a connected account)

3. **Get API Keys:**
   - Go to Developers → API keys
   - **Copy the Secret key** (starts with `sk_live_` or `sk_test_`)
   - For development, use test mode keys

4. **Verify Connect is enabled:**
   - Go to Connect → Settings
   - Confirm "Connect" is enabled
   - Note: Your products (Total TypeScript, etc.) should already be connected accounts

5. **Create Connect Webhook:**
   - Go to Developers → Webhooks
   - Click "Add endpoint"
   - URL: `https://YOUR_DOMAIN/api/stripe/webhook` (placeholder)
   - Events: Select:
     - `charge.refunded`
     - `refund.created`
     - `refund.updated`
     - `account.updated`
   - Click "Add endpoint"
   - **Copy the Signing secret** (starts with `whsec_`)

6. **Get Connected Account IDs:**
   - Go to Connect → Accounts
   - For each product, click the account and copy the ID (format: `acct_xxxxx`)

**Capture these values:**
```
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# Connected accounts (one per product)
STRIPE_ACCOUNT_TOTAL_TYPESCRIPT=acct_xxxxx
STRIPE_ACCOUNT_PRO_TAILWIND=acct_xxxxx
```

**Validation:** Run this to test:
```bash
curl -u sk_test_YOUR_KEY: https://api.stripe.com/v1/balance
```
Should return your balance info.

---

### Step 4: Upstash Vector Setup

**Goal:** Create vector database for semantic search.

**What you need:**
- Upstash account (create at https://upstash.com)

**Instructions:**

1. Go to https://console.upstash.com
2. Click "Create Index" (Vector tab)
   - Name: `support-vectors`
   - Region: Select closest to your users (e.g., `us-east-1`)
   - Dimensions: `1536` (OpenAI embeddings) or `384` (for hosted embeddings)
   - Similarity: `COSINE`
   - **Enable "Hybrid Search"** (combines dense + sparse)
   - Click "Create"

3. Click on your new index
4. Go to "Details" tab
   - **Copy the REST URL**
   - **Copy the REST Token**

**Capture these values:**
```
UPSTASH_VECTOR_URL=https://xxxxx.upstash.io
UPSTASH_VECTOR_TOKEN=xxxxx
```

**Validation:** Run this to test:
```bash
curl "YOUR_URL/info" -H "Authorization: Bearer YOUR_TOKEN"
```
Should return index info.

---

### Step 5: Axiom Setup (Logging)

**Goal:** Set up structured logging for observability.

**What you need:**
- Axiom account (create at https://axiom.co)

**Instructions:**

1. Go to https://app.axiom.co
2. Create a new dataset:
   - Click "Datasets" → "New Dataset"
   - Name: `support-logs`
   - Click "Create"

3. Get API token:
   - Click your profile → "Settings" → "API Tokens"
   - Click "New Token"
   - Name: `support-platform`
   - Permissions: Select your `support-logs` dataset
   - Click "Create"
   - **Copy the token**

**Capture these values:**
```
AXIOM_DATASET=support-logs
AXIOM_TOKEN=xaat-xxxxx
```

**Validation:** Run this to test:
```bash
curl -X POST "https://api.axiom.co/v1/datasets/support-logs/ingest" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"message": "test", "_time": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}]'
```
Should return `{"ingested": 1}`.

---

### Step 6: Langfuse Setup (LLM Observability)

**Goal:** Set up LLM tracing for agent debugging.

**What you need:**
- Langfuse account (create at https://langfuse.com or self-host)

**Instructions:**

1. Go to https://cloud.langfuse.com (or your self-hosted instance)
2. Create a new project:
   - Click "New Project"
   - Name: `support-agent`
   - Click "Create"

3. Get API keys:
   - Go to Settings → API Keys
   - Click "Create new API keys"
   - **Copy both the Public Key and Secret Key**

**Capture these values:**
```
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxx
LANGFUSE_HOST=https://cloud.langfuse.com  # or your self-hosted URL
```

**Validation:** The Langfuse SDK will validate on first trace.

---

### Step 7: PlanetScale Setup (Database)

**Goal:** Create MySQL database for app state.

**What you need:**
- PlanetScale account (create at https://planetscale.com)

**Instructions:**

1. Go to https://app.planetscale.com
2. Create a new database:
   - Click "New database"
   - Name: `support`
   - Region: Select closest to Vercel region
   - Plan: Scaler (or appropriate tier)
   - Click "Create database"

3. Create branches:
   - Main branch is created automatically (`main`)
   - Create a dev branch: Click "New branch" → Name: `dev`

4. Get connection string:
   - Click "Connect"
   - Select "Connect with: Prisma" (or your ORM)
   - **Copy the connection string**

**Capture these values:**
```
DATABASE_URL=mysql://xxxxx:xxxxx@xxxxx.us-east.psdb.cloud/support?sslaccept=strict
```

**Validation:** Connection will be validated when running migrations.

---

### Step 8: Cloudflare Setup (Workers + Durable Objects)

**Goal:** Set up edge compute for webhook ingestion and conversation state.

**What you need:**
- Cloudflare account (create at https://cloudflare.com)

**Instructions:**

1. Go to https://dash.cloudflare.com
2. Note your Account ID (shown in the right sidebar of Overview)

3. Create API token:
   - Go to "My Profile" → "API Tokens"
   - Click "Create Token"
   - Use template: "Edit Cloudflare Workers"
   - Click "Continue to summary" → "Create Token"
   - **Copy the token**

4. Durable Objects namespace:
   - This will be created automatically when you deploy the worker
   - We'll configure it in wrangler.toml later

**Capture these values:**
```
CLOUDFLARE_ACCOUNT_ID=xxxxx
CLOUDFLARE_API_TOKEN=xxxxx
```

**Validation:** Run this to test:
```bash
curl -X GET "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/workers/scripts" \
  -H "Authorization: Bearer YOUR_TOKEN"
```
Should return `"success": true`.

---

### Step 9: Vercel Setup (Hosting)

**Goal:** Set up Vercel projects for the apps.

**What you need:**
- Vercel account linked to GitHub
- The support repo pushed to GitHub

**Instructions:**

1. Go to https://vercel.com
2. Click "Add New..." → "Project"
3. Import the `skillrecordings/support` repository

4. Create 3 projects (one per app):

   **Project 1: support-web (Dashboard)**
   - Root Directory: `apps/web`
   - Framework Preset: Next.js
   - Build Command: `cd ../.. && bun run build --filter=web`
   - Click "Deploy"

   **Project 2: support-slack**
   - Root Directory: `apps/slack`
   - Framework Preset: Next.js
   - Build Command: `cd ../.. && bun run build --filter=slack`

   **Project 3: support-front**
   - Root Directory: `apps/front`
   - Framework Preset: Next.js
   - Build Command: `cd ../.. && bun run build --filter=front`

5. Set environment variables:
   - For each project, go to Settings → Environment Variables
   - Add all the variables you've collected

6. Get the deployed URLs and update webhooks:
   - Front webhook URL: `https://support-front.vercel.app/api/front/webhook`
   - Slack interactions URL: `https://support-slack.vercel.app/api/slack/interactions`
   - Slack events URL: `https://support-slack.vercel.app/api/slack/events`
   - Stripe webhook URL: `https://support-web.vercel.app/api/stripe/webhook`

**Capture these values:**
```
VERCEL_PROJECT_WEB=prj_xxxxx
VERCEL_PROJECT_SLACK=prj_xxxxx
VERCEL_PROJECT_FRONT=prj_xxxxx
```

---

### Step 10: BetterAuth Setup

**Goal:** Configure authentication for the dashboard.

**What you need:**
- Generated secret (we'll create one)

**Instructions:**

1. Generate a secret:
```bash
openssl rand -base64 32
```
**Copy the output**

2. BetterAuth will be configured in code - just need the secret for now.

**Capture these values:**
```
BETTERAUTH_SECRET=<your-generated-secret>
BETTERAUTH_URL=https://support-web.vercel.app
```

---

## Final: Create .env File

Create `.env.local` at the project root with all captured values:

```bash
# Front
FRONT_API_TOKEN=
FRONT_WEBHOOK_SECRET=
FRONT_INBOX_TOTAL_TYPESCRIPT=
FRONT_INBOX_PRO_TAILWIND=

# Slack
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_APPROVAL_CHANNEL_ID=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_ACCOUNT_TOTAL_TYPESCRIPT=
STRIPE_ACCOUNT_PRO_TAILWIND=

# Upstash Vector
UPSTASH_VECTOR_URL=
UPSTASH_VECTOR_TOKEN=

# Axiom
AXIOM_DATASET=
AXIOM_TOKEN=

# Langfuse
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com

# PlanetScale
DATABASE_URL=

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=

# BetterAuth
BETTERAUTH_SECRET=
BETTERAUTH_URL=

# Vercel (for CI)
VERCEL_PROJECT_WEB=
VERCEL_PROJECT_SLACK=
VERCEL_PROJECT_FRONT=
```

---

## Validation Checklist

After completing all steps, verify each service:

- [ ] Front: `curl -H "Authorization: Bearer $FRONT_API_TOKEN" https://api2.frontapp.com/me`
- [ ] Slack: `curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test`
- [ ] Stripe: `curl -u $STRIPE_SECRET_KEY: https://api.stripe.com/v1/balance`
- [ ] Upstash: `curl "$UPSTASH_VECTOR_URL/info" -H "Authorization: Bearer $UPSTASH_VECTOR_TOKEN"`
- [ ] Axiom: Send test log event
- [ ] PlanetScale: Run migrations
- [ ] Cloudflare: Deploy test worker
- [ ] Vercel: All 3 projects deployed

---

## Next Steps

Once all services are configured:

1. Update webhook URLs in Front, Slack, and Stripe with actual Vercel URLs
2. Run database migrations
3. Proceed to Phase 1: Registry + Ingestion
