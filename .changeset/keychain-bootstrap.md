---
"@skillrecordings/cli": minor
---

feat(cli): auto-bootstrap keychain from op CLI

The CLI now automatically fetches secrets from 1Password when `op` CLI is
installed and authenticated. No manual setup required.

- Detects `op` CLI and fetches OP_SERVICE_ACCOUNT_TOKEN from vault
- Caches tokens in system keychain (macOS Keychain / Linux secret-tool)
- Adds shell exports to ~/.zshrc automatically
- `skill keys setup` tries everything and shows manual steps if needed
