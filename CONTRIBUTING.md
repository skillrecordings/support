# Contributing

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
