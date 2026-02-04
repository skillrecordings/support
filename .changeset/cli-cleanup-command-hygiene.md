---
"@skillrecordings/cli": minor
---
refactor: CLI command tree hygiene

- Delete ~1,800 lines of dead code (front-cache, front-stats, alignment-test, test-agent-local, check-apps, eval-local compare stub)
- Group Inngest commands under `inngest` subcommand
- Group FAQ commands under `faq` subcommand
- Deduplicate eval seed logic into shared module
- Deduplicate Axiom helpers into shared module
- Remove dead auth commands (keygen, encrypt, decrypt) and age crypto
- Clean up index.ts with logical command grouping
