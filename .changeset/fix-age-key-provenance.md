---
"@skillrecordings/cli": patch
---

Fix write-gate rejecting Linear API key from encrypted user config

`getAgeKeyFrom1Password()` never checked the local `~/.config/skill/age.key` file, only env var, keychain, and 1Password SDK. When 1Password wasn't available, decryption silently failed and provenance was never set to `'user'`, causing all write operations to be rejected even with a valid key on disk.

Renamed to `getAgeKey()` with priority: env var → local age.key → keychain → 1Password SDK. Removed duplicate broken implementations in `config/get.ts` and `config/list.ts`.
