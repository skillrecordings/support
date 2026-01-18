# @skillrecordings/cli

CLI for the support platform. Agent-friendly with non-interactive defaults.

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

## Agent Usage

All commands support `--json` for machine-readable output. In non-interactive mode:
- `init` requires the name argument
- All errors output JSON with `{ "success": false, "error": "..." }`
- Exit codes are reliable (0=success, 1=error)

## Key paths

- `packages/cli/src/commands/` - Command implementations
- `packages/cli/src/index.ts` - CLI entry point

## Do / Don't

- Do use `--json` flag for automation/agents
- Do check exit codes in scripts
- Don't rely on interactive prompts in CI/CD
