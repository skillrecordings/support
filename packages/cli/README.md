# @skillrecordings/cli

CLI for the support platform. Agent-friendly with non-interactive defaults.

## Usage

```bash
bunx @skillrecordings/cli <command> [options]

# or with direct import
skill <command> [options]
```

All commands support `--json` for machine-readable output and reliable exit
codes.

## Adaptive Hints

The CLI prints adaptive onboarding/discovery hints to `stderr` for new users.
Hints learn from usage and fade as you run more commands.

**Opt out:**
- Use `--quiet`
- Use `--json`
- Pipe output (non-TTY)

## Commands

### `skill init <name>`

Initialize a new app integration with webhook secret.

```bash
# Interactive (terminal only)
skill init

# Non-interactive (required for agents/scripts)
skill init my-app

# JSON output
skill init my-app --json
```

**Options:**
- `--json` - Output result as JSON (machine-readable)

**Exit codes:**
- `0` - Success
- `1` - Error (name required in non-interactive mode, etc.)

### `skill health <slug|url>`

Test integration endpoint health.

```bash
# Using database lookup (recommended)
skill health total-typescript

# Direct URL mode
skill health https://example.com --secret whsec_xxx

# List registered apps
skill health --list

# JSON output (for agents)
skill health total-typescript --json
```

**Options:**
- `-s, --secret <secret>` - Webhook secret (required for direct URL mode)
- `-l, --list` - List all registered apps
- `--json` - Output result as JSON (machine-readable)

**Exit codes:**
- `0` - Health check passed
- `1` - Health check failed or error

**JSON output structure:**
```json
{
  "success": true,
  "endpoint": "https://...",
  "status": "ok",
  "responseTime": 730,
  "actions": [
    { "name": "lookupUser", "status": "ok" },
    { "name": "getPurchases", "status": "ok" }
  ],
  "summary": { "ok": 4, "notImplemented": 1, "errors": 0 }
}
```

### `skill eval <type> <dataset>`

Run evals against a dataset (e.g., routing classifier, canned response
matcher).

```bash
# Run routing eval with defaults
skill eval routing path/to/dataset.json

# With strict thresholds
skill eval routing dataset.json --min-precision 0.95 --min-recall 0.97

# JSON output for automation
skill eval routing dataset.json --json

# Custom thresholds
skill eval routing dataset.json \
  --min-precision 0.92 \
  --min-recall 0.95 \
  --max-fp-rate 0.03 \
  --max-fn-rate 0.02
```

**Arguments:**
- `type` - Eval type (e.g., `routing`)
- `dataset` - Path to JSON dataset file

**Options:**
- `--json` - Output result as JSON (machine-readable)
- `--min-precision <number>` - Minimum precision threshold (default: 0.92)
- `--min-recall <number>` - Minimum recall threshold (default: 0.95)
- `--max-fp-rate <number>` - Maximum false positive rate (default: 0.03)
- `--max-fn-rate <number>` - Maximum false negative rate (default: 0.02)

**Exit codes:**
- `0` - All metrics passed thresholds
- `1` - One or more metrics below threshold or error

**Output includes:**
- Precision, recall, false positive/negative rates
- Latency percentiles (p50, p95, p99)
- Token usage and estimated cost
- Category-level breakdown (if applicable)

## App Onboarding Workflow

Typical flow for adding a new app integration:

```bash
# 1. Initialize with app name
skill init my-app --json
# Returns: { "success": true, "appName": "my-app",
#            "webhookSecret": "whsec_xxx" }

# 2. Register webhook endpoint in your app
# Save the webhook secret and configure your endpoint to:
# POST /api/support-webhooks with Authorization: Bearer whsec_xxx

# 3. Test health before going live
skill health my-app
# Verifies: endpoint reachable, signature verification works,
# actions implemented

# 4. Run evals (optional, for routing/matching logic)
skill eval routing path/to/labeled-dataset.json --json

# 5. Deploy and monitor
# Check logs via Axiom/Langfuse for inbound messages
```

All commands work non-interactively and report errors with exit codes
(0=success, 1=error).

## Agent Usage

All commands support `--json` for machine-readable output and
non-interactive operation:

**init command:**
- Requires `name` argument (non-interactive mode)
- Returns JSON: `{ "success": true, "appName": "...",
  "webhookSecret": "whsec_..." }`
- Use `--json` for reliable parsing

**health command:**
- Use `--json` for JSON output (structured for parsing)
- Use `--list` to discover all registered apps
- Returns exit code 0 if healthy, 1 if any check fails

**eval command:**
- Requires `type` and `dataset` arguments
- Accepts custom threshold gates (precision, recall, false
  positive/negative rates)
- Returns exit code 0 if all metrics pass, 1 otherwise
- Use `--json` for machine-readable report

**Error handling:**
- All commands output `{ "success": false, "error": "message" }` on
  JSON mode
- Check exit codes: 0 = success, 1 = error
- Never interactive in non-TTY environments (CI/CD safe)

## Secrets Management

The CLI uses a layered secrets system:

1. **1Password (preferred)** - Service account token resolves secrets directly
2. **Encrypted `.env.encrypted`** - Age-encrypted env file for offline/CI use
3. **Plain `.env.local`** - Local development fallback

### Secret Resolution Order

```
1Password (OP_SERVICE_ACCOUNT_TOKEN set?)
    ↓ yes → resolve from 1Password vault
    ↓ no
.env.encrypted exists + AGE_SECRET_KEY available?
    ↓ yes → decrypt and load
    ↓ no
.env.local exists?
    ↓ yes → load plain env vars
    ↓ no → error: missing secrets
```

### Adding a New Secret

**Step 1: Add to `secret-refs.ts`**

```typescript
// packages/cli/src/core/secret-refs.ts
export const SECRET_REFS = {
  // ... existing secrets
  MY_NEW_KEY: 'op://Support/skill-cli/MY_NEW_KEY',
} as const
```

**Step 2: Add to 1Password**

```bash
# Using op CLI
op item edit "skill-cli" --vault "Support" "MY_NEW_KEY=your-secret-value"

# Or via 1Password UI:
# 1. Open Support vault → skill-cli item
# 2. Add new field: MY_NEW_KEY = your-value
```

**Step 3: Update `.env.encrypted`**

```bash
# Decrypt current secrets
AGE_KEY=$(op read "op://Support/skill-cli-age-key/password")
age -d -i <(echo "$AGE_KEY") .env.encrypted > .env.local

# Add new secret to .env.local
echo "MY_NEW_KEY=your-secret-value" >> .env.local

# Re-encrypt
AGE_PUB=$(echo "$AGE_KEY" | age-keygen -y)
age -r "$AGE_PUB" .env.local > .env.encrypted

# Verify
age -d -i <(echo "$AGE_KEY") .env.encrypted | grep MY_NEW_KEY
```

**Step 4: Commit changes**

```bash
git add packages/cli/src/core/secret-refs.ts packages/cli/.env.encrypted
git commit -m "chore(cli): add MY_NEW_KEY secret"
```

### Updating an Existing Secret

```bash
# 1. Update in 1Password
op item edit "skill-cli" --vault "Support" "MY_KEY=new-value"

# 2. Update .env.encrypted (same process as adding)
AGE_KEY=$(op read "op://Support/skill-cli-age-key/password")
age -d -i <(echo "$AGE_KEY") .env.encrypted > .env.local

# Edit .env.local with new value
sed -i '' 's/MY_KEY=.*/MY_KEY=new-value/' .env.local

# Re-encrypt
AGE_PUB=$(echo "$AGE_KEY" | age-keygen -y)
age -r "$AGE_PUB" .env.local > .env.encrypted
```

### Auth Commands

```bash
# Check current auth status
skill auth status

# Validate 1Password token
skill auth login

# Show service account info
skill auth whoami

# Interactive setup wizard
skill auth setup
```

### Key Locations

| Item | Location |
|------|----------|
| Secrets | `op://Support/skill-cli/*` |
| Age keypair | `op://Support/skill-cli-age-key/password` |
| Encrypted env | `packages/cli/.env.encrypted` |
| Secret refs | `packages/cli/src/core/secret-refs.ts` |

### CI/CD Usage

For CI environments without 1Password:

```bash
# Set age key as CI secret, then:
echo "$AGE_SECRET_KEY" > /tmp/age.key
age -d -i /tmp/age.key .env.encrypted > .env.local
rm /tmp/age.key
```

Or use 1Password service account:

```bash
export OP_SERVICE_ACCOUNT_TOKEN="$OP_TOKEN"
skill auth status  # Verifies connection
skill front inbox  # Commands auto-resolve secrets
```

## Implementation

- `packages/cli/src/commands/` - Command implementations
- `packages/cli/src/index.ts` - CLI entry point
- Entry point: `#!/usr/bin/env bun` (runs with Bun directly)

## Do / Don't

- Do use `--json` flag for automation/agents/scripts
- Do check exit codes in shell scripts
- Do pass `name` argument to `init` in CI/CD (non-interactive required)
- Don't rely on interactive prompts outside terminal
- Don't parse stdout (use `--json` for structured output)
