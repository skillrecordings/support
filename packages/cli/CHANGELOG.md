# @skillrecordings/cli

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
