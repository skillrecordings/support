---
"@skillrecordings/cli": patch
---

Fix CLI crash on global install: skip env validation when no .env file found

- `skill -V` and `skill --help` no longer require DATABASE_URL
- Lazy-import `@skillrecordings/database` to avoid triggering env validation at startup
- Set SKIP_ENV_VALIDATION when no .env file is found (global npm/bun installs)
- Commands that need DB will fail at runtime with a clear error instead of crashing on import
