---
"@skillrecordings/cli": minor
---

feat(cli): Add `skill keys` command + deprecate `config init`

New `skill keys` command for personal API key management:
- `skill keys` - Interactive setup showing status and prompting to add keys
- `skill keys status` - Display which keys are personal vs shared
- `skill keys add` - Add personal API key with auto-init encryption
- `skill keys list` - List personal key names

Simplify encryption architecture:
- All encryption now uses the 1Password age key directly
- `config init` deprecated - no longer generates local keypairs
- `config get/list` updated to use 1Password age key
- Removed need for `~/.config/skill/age.key` local file

Fix all "skill config init" references:
- Updated `write-gate.ts` suggestion to "skill keys add"
- Updated Linear HATEOAS metadata to "skill keys add"
- Updated hint system to point to "skill keys"
- Tests updated to expect new command references
