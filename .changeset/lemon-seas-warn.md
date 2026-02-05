---
"@skillrecordings/cli": minor
---

feat(cli): Interactive key selection for `skill config set`

- Run `skill config set` without arguments to get a selectable list of API keys
- Uses password prompt for hidden value input
- Keep existing `KEY=value` syntax for scripting
- Fix misleading "skill init" hint (now correctly says "skill auth setup")
- Fix auth milestone tied to wrong command (now triggers on config.init)
