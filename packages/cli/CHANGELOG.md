# @skillrecordings/cli

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
