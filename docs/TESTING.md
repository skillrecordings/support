# Testing

## Default
Use Turborepo from the repo root.

```bash
bun run test
```

## Targeted
Use filters to run the smallest scope possible.

```bash
bun run test --filter=web
bun run test --filter=packages/core
```

## TDD
Red → Green → Refactor is mandatory. Use `.claude/skills/tdd-red-green-refactor` for testable changes.
