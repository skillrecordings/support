---
"@skillrecordings/cli": patch
---

fix(cli): require personal LINEAR_API_KEY for write operations

Linear write operations (create, update, assign, state, close, label, link, comment)
now require a personal API key. Read operations (my, issues, search, issue, teams, etc.)
continue to work with the shipped key.

This prevents accidental mutations using someone else's API key.
