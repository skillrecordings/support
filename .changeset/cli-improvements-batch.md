---
"@skillrecordings/cli": minor
---

Add CLI improvements: `skill doctor` health check, `skill list` discovery, Linear bulk filters, Inngest patterns

- **`skill doctor`** — verify env vars, keychain, tools, and workspace health in one command
- **`skill list --json`** — agent-discoverable skill catalog from `.claude/skills/`
- **`skill linear issues --older-than 90d --export`** — time-based filtering and full data export
- **`skill inngest patterns --after 24h`** — aggregate event analysis with frequency and success rates
- Env var requirements surfaced in adaptive help text for Front, Inngest, and Axiom commands
