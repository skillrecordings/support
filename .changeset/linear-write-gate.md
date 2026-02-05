---
"@skillrecordings/cli": patch
---

fix(cli): require personal LINEAR_API_KEY for user-specific operations

Linear operations that are user-specific now require a personal API key:
- `my` - shows YOUR issues (requires your key)
- Write operations: create, update, assign, state, close, label, link, comment

Read operations that don't involve user identity (issues, search, teams, etc.)
continue to work with the shipped key.
