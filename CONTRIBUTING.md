# Contributing

## ⛔ NO PII IN THIS REPO — EVER

**This repo is PUBLIC. Customer data NEVER goes here.**

### What is PII?
- Email addresses (customer emails in subjects, bodies, conversation content)
- Names, addresses, phone numbers
- Payment info, order IDs linked to customers
- Conversation transcripts with customer data
- Any data that could identify a real person

### What IS allowed?
- Aggregate statistics (counts, averages, percentages)
- Curated FAQ content (no customer references)
- Code, tests, documentation
- Anonymized/synthetic test data

### Gitignored paths (use these for local PII)
```
data/mined/       # Raw conversation exports
artifacts/        # Phase artifacts with embeddings
*.db              # DuckDB caches with Front data
```

### If you accidentally commit PII:
1. **STOP** — don't push
2. `git reset HEAD~1` to undo the commit
3. Add to `.gitignore` if needed
4. If already pushed: notify immediately, we'll need to scrub history

**This rule is absolute. No exceptions. No "just this once."**

---

## TDD
Red → Green → Refactor is mandatory. Use the `.claude/skills/tdd-red-green-refactor` skill for testable changes.

## Commands
- `bun run test` for repo tests
- Prefer package-level tests (e.g. `bun run test --filter=web`)

## Docs hygiene
If you change behavior or architecture, update:
- `docs/ARCHITECTURE.md`
- `docs/CONVENTIONS.md`
- `docs/DECISIONS.md`
- `docs/ENV.md`
