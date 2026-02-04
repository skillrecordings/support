---
"@skillrecordings/cli": patch
---

Fix JSON output truncation for large result sets. `--json` output exceeding 64KB is now written to `/tmp/skill-front/<timestamp>.json` with a summary envelope on stdout. Affects all `skill front` commands.
