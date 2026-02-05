# @skillrecordings/cli

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
