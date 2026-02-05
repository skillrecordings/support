---
"@skillrecordings/cli": patch
---

feat(cli): add loading spinners for data-fetching commands

Commands that hit APIs (front inbox, axiom queries, inngest events, linear search/my/teams) now show animated spinners while loading. Spinners only appear in TTY mode and are suppressed for JSON output or piped commands.
