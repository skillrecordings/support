---
"@skillrecordings/cli": minor
---

feat(cli): Add `skill keys` command for personal API key management

- `skill keys` - Interactive setup showing status and prompting to add keys
- `skill keys status` - Display which keys are personal vs shared
- `skill keys add` - Add personal API key with auto-init encryption
- `skill keys list` - List personal key names

Also fixes misleading hint system:
- Changed "skill init" hint to "skill keys" (init creates apps, not credentials)
- Added discovery hint for keys command
