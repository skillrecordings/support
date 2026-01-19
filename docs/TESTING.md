# Testing

## ⚠️ Vitest Only - No bun:test

This repo uses **Vitest** exclusively. Do NOT use Bun's built-in test runner.

```bash
# ✅ CORRECT - runs Vitest via Turborepo
bun run test

# ❌ WRONG - runs Bun's test runner (different API, different behavior)
bun test
```

**Why this matters:**
- `bun:test` has different APIs (`expect.toHaveBeenCalled()` vs Vitest matchers)
- Vitest workspace config won't apply
- CI runs Vitest, so bun:test passes would be false positives
- Existing tests are written for Vitest

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

## Direct Vitest
Use root Vitest config when you need fine-grained targeting.

```bash
bun run test:all
bun run test:all -- -t "name of test"
bun run test:all -- apps/web/tests/smoke.test.ts
```

## Typecheck policy
Types always pass. Do not blame pre-existing errors. Fix or revert.

## Package-level
Each app/package has its own `test` script (Vitest). Use `bun --cwd` if you want to run a single workspace package directly.

```bash
bun --cwd apps/web test
bun --cwd packages/core test
```

## TDD
Red → Green → Refactor is mandatory. Use `.claude/skills/tdd-red-green-refactor` for testable changes.

## LLM Evals
Routing, classifier, and canned-response logic must ship with evals.

- Offline: labeled set with precision/recall, false positive/negative rates
- Online: shadow + canary with rollback gates
- Report: cost, latency, and auto-response coverage deltas

### Eval Dataset Spec (Minimum)

- Source: exported Front threads + internal labels
- Size: >= 500 threads, stratified by product + inbox
- Labels: `needs_response`, `no_response`, `canned_response:<id>`, `human_required`
- Splits: 70/15/15 train/dev/test with time-based holdout
- Hygiene: dedupe near-identical messages; exclude system pings + internal notes

### Relevant Skills

- `.claude/skills/front-webhook`
- `.claude/skills/inngest-workflow`
- `.claude/skills/tdd-red-green-refactor`
