---
"@skillrecordings/cli": minor
---

Add `skill auth setup` — interactive keychain-based secret setup with 1Password CLI integration

- `skill auth setup`: prompts for AGE_SECRET_KEY, stores in OS keychain (macOS Keychain / Linux secret-tool), appends shell profile export
- `skill auth status`: shows env, keychain, 1Password CLI, and shell profile status
- Auto-fetches key from 1Password if `op` CLI is installed and signed in
- Falls back to direct 1Password link + manual paste
- Supports `--json` for machine-readable output
