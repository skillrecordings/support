# @skillrecordings/cli

## 0.15.0

### Minor Changes

- bfb0eb0: feat(cli): Interactive key selection for `skill config set`
  - Run `skill config set` without arguments to get a selectable list of API keys
  - Uses password prompt for hidden value input
  - Keep existing `KEY=value` syntax for scripting
  - Fix misleading "skill init" hint (now correctly says "skill auth setup")
  - Fix auth milestone tied to wrong command (now triggers on config.init)

## 0.14.3

### Patch Changes

- dd7bddd: fix: wire up .env.encrypted decryption via 1Password age key
  - Implement `decryptEnvFile()` to actually decrypt shipped secrets
  - Get age private key from 1Password (`op://Support/skill-cli-age-key/private_key`)
  - Ship `.env.encrypted` with npm package
  - Add LINEAR_API_KEY and AI_GATEWAY_API_KEY to secret refs
  - Global installs now work with `OP_SERVICE_ACCOUNT_TOKEN` set

## 0.14.2

### Patch Changes

- 9dae31c: fix: inject BUILD_VERSION in tsup build for npm package

  The tsup build (used for npm publishing) now injects BUILD_VERSION, BUILD_COMMIT, and BUILD_TARGET at build time. Previously only the native binary build did this, causing npm-installed CLI to show "0.0.0-dev".

## 0.14.1

### Patch Changes

- 8c41610: fix: correct cliRoot path resolution for env loading

  Fixed path resolution bug where `../..` was used instead of `..` to resolve the CLI package root from `src/index.ts`. This caused `.env.local` to not be found, breaking all commands that need credentials.

## 0.14.0

### Minor Changes

- 4bee260: feat: user-local API key config with write gating
  - Add user config directory at `~/.config/skill` (XDG-compliant)
  - Store user secrets in `.env.user.encrypted` using age encryption
  - Track key provenance ('user' vs 'shipped') for write gating
  - Gate all Linear write operations on personal API keys:
    - create, update, assign, state, close, label, link, comment
  - Add `skill config` commands: init, set, get, list
  - Include HATEOAS hints in JSON output:
    - `_meta.personal_key_hint` with setup instructions
    - `_actions[].requires_personal_key` flag for write actions
  - Auto-symlink skill-cli to `~/.claude/skills/` on CLI startup:
    - Creates symlink on first run (if target doesn't exist)
    - Skips if conflict detected (existing file/directory)

## 0.13.0

### Minor Changes

- c92287e: Add comprehensive Linear integration for issue tracking

  **New Commands:**
  - `skill linear issues` - List issues with filters (team/state/assignee/project/priority)
  - `skill linear my` - List your assigned issues
  - `skill linear search <query>` - Full-text search
  - `skill linear issue <id>` - View issue details
  - `skill linear create <title>` - Create issue with labels/assignee/priority
  - `skill linear update <id>` - Update issue properties
  - `skill linear assign <id>` - Assign/unassign issues
  - `skill linear state <id>` - Change workflow state
  - `skill linear close <id>` - Close as done or canceled
  - `skill linear label <id>` - Add/remove labels
  - `skill linear link <id>` - Create issue relations (blocks/related/duplicate)
  - `skill linear comment <id>` - Add markdown comment
  - `skill linear comments <id>` - List comment history
  - `skill linear teams` - List workspace teams
  - `skill linear states <team>` - List workflow states
  - `skill linear labels <team>` - List available labels
  - `skill linear users` - List workspace users
  - `skill linear projects` - List projects

  **Features:**
  - HATEOAS support: JSON output includes `_links` and `_actions` for agent discoverability
  - Excellent help text with usage examples for every command
  - Full filtering support (team, state, assignee, project, priority)
  - Markdown support in comments and descriptions

## 0.12.0

### Minor Changes

- 6ce0356: Add adaptive onboarding/discovery hints with telemetry polish and docs.

## 0.11.2

### Patch Changes

- Fix DATABASE_URL validation crash on CLI global install
  - Skip env validation when DATABASE_URL is not set (lazy validation)
  - Make DATABASE_URL optional in zod schema (validated at getDb() call instead)
  - getDb() throws clear error message when DATABASE_URL is missing
  - Fixes `skill -V` and `skill --help` crashing on global npm/bun install

## 0.11.1

### Patch Changes

- 279daf0: Fix CLI crash on global install: skip env validation when no .env file found
  - `skill -V` and `skill --help` no longer require DATABASE_URL
  - Lazy-import `@skillrecordings/database` to avoid triggering env validation at startup
  - Set SKIP_ENV_VALIDATION when no .env file is found (global npm/bun installs)
  - Commands that need DB will fail at runtime with a clear error instead of crashing on import

## 0.11.0

### Minor Changes

- 17ffbfb: CLI rearchitect: agent-first compiled binary rewrite
  - CommandContext unified context object replacing scattered globals
  - SecretsProvider abstraction (1Password SDK + env fallback)
  - OutputFormatter with JSON/text/table output and auto-detection
  - MCP server mode (JSON-RPC stdio, 9 Front tools for Claude Code)
  - Compiled binary build with embedded metadata
  - Interactive auth wizard with 1Password deep links
  - Front API response caching (3-tier TTL + mutation invalidation)
  - Proactive rate limiter (token bucket, 100 req/min)
  - CSV injection sanitization in output formatting
  - New commands: assign, tag, reply, search, api passthrough
  - HATEOAS JSON responses with \_links and \_actions
  - 178 tests passing

## 0.10.2

### Patch Changes

- 0279153: Rotate Axiom API token in encrypted environment.

## 0.10.1

### Patch Changes

- 22b3af7: Fix JSON output truncation for large result sets. `--json` output exceeding 64KB is now written to `/tmp/skill-front/<timestamp>.json` with a summary envelope on stdout. Affects all `skill front` commands.

## 0.10.0

### Minor Changes

- 9c4d627: Add comprehensive agent-optimized help text to all `skill front` commands. Every command now has a detailed cheat sheet accessible via `--help` with practical examples, filter/status values, jq patterns, related commands, and workflow guidance. Commands covered: inbox, conversation, message, teammates, teammate, assign, reply, tag, untag, tags (list/delete/rename/cleanup), archive, bulk-archive, report, triage, pull-conversations, and api.

## 0.9.0

### Minor Changes

- 916bf14: Add `skill front search` with full Front query syntax support — text search, inline filters (inbox, tag, from, to, assignee, status, date ranges, custom fields), pagination, and comprehensive `--help` cheat sheet. Fix `skill -V` to read version from package.json instead of hardcoded 0.0.0.

## 0.8.0

### Minor Changes

- bad1a4e: Add `skill front search` command with full Front query syntax (text, inbox, tag, assignee, status, sender, date range). Fix `skill -V` to read version from package.json instead of hardcoded 0.0.0.

## 0.7.0

### Minor Changes

- 66ffb6a: Add `skill front search` command with full Front query syntax support (text, inbox, tag, assignee, status, from, date range filters).

## 0.6.0

### Minor Changes

- 9297996: Add assign, tag/untag, reply, and api passthrough commands to `skill front`. Fix inbox status filter and pagination bugs. Add HATEOAS actions for new commands.

## 0.5.0

### Minor Changes

- 97f98d8: Add `skill auth setup` — interactive keychain-based secret setup with 1Password CLI integration
  - `skill auth setup`: prompts for AGE_SECRET_KEY, stores in OS keychain (macOS Keychain / Linux secret-tool), appends shell profile export
  - `skill auth status`: shows env, keychain, 1Password CLI, and shell profile status
  - Auto-fetches key from 1Password if `op` CLI is installed and signed in
  - Falls back to direct 1Password link + manual paste
  - Supports `--json` for machine-readable output

## 0.4.0

### Minor Changes

- e676fb6: feat: wire up front commands, HATEOAS JSON output, restore .env.encrypted decryption
  - Register 5 orphaned front commands (inbox, archive, bulk-archive, report, triage)
  - Wrap all --json output with \_links and \_actions for agent discoverability
  - Restore age decryption for .env.encrypted (AGE_SECRET_KEY from shell env)
  - Update command descriptions for clarity

## 0.3.0

### Minor Changes

- 7afc764: refactor: CLI command tree hygiene
  - Delete ~1,800 lines of dead code (front-cache, front-stats, alignment-test, test-agent-local, check-apps, eval-local compare stub)
  - Group Inngest commands under `inngest` subcommand
  - Group FAQ commands under `faq` subcommand
  - Deduplicate eval seed logic into shared module
  - Deduplicate Axiom helpers into shared module
  - Remove dead auth commands (keygen, encrypt, decrypt) and age crypto
  - Clean up index.ts with logical command grouping

## 0.2.3

### Patch Changes

- 435f929: Strip `sslaccept` query param from DATABASE_URL before passing to mysql2

  PlanetScale URLs include `?sslaccept=strict` which mysql2 doesn't recognize,
  causing a noisy warning on every connection. SSL is already configured via
  the `ssl: { rejectUnauthorized: true }` option. Also include `.env.encrypted`
  in published CLI package for global install secret loading.

## 0.2.2

### Patch Changes

- 3bed260: Wire up secret loading (1Password/age encryption) in bundled CLI
  - Bundle preload.ts as separate entry point for secret loading
  - Fix path resolution for bundled dist/ directory
  - Accept cliDir parameter in loadSecrets for correct .env discovery
  - Help/auth commands gracefully degrade without secrets

## 0.2.1

### Patch Changes

- d9934e5: Skip env validation at import time to allow CLI to run without DATABASE_URL

  Commands that don't need the database (help, auth, etc.) now work without env vars configured. Commands that need the database will fail at runtime with a clear error when they try to use it.

## 0.2.0

### Minor Changes

- eaf84af: Bundle workspace dependencies for npm publishing
  - Add tsup config to bundle @skillrecordings/\* packages
  - Create bin/skill.mjs wrapper for global install
  - Requires bun runtime (#!/usr/bin/env bun)
  - Install globally: `bun i -g @skillrecordings/cli`

## 0.1.0

### Minor Changes

- 5734b19: Make CLI public for npm publishing

## 0.0.4

### Patch Changes

- Updated dependencies [7ae3e99]
  - @skillrecordings/sdk@0.6.0

## 0.0.3

### Patch Changes

- Updated dependencies [36efccf]
  - @skillrecordings/sdk@0.5.0

## 0.0.2

### Patch Changes

- Updated dependencies [7c5c5d8]
  - @skillrecordings/sdk@0.4.0

## 0.0.1

### Patch Changes

- Updated dependencies [2820cb9]
  - @skillrecordings/core@0.0.1
