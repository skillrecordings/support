---
name: tdd-red-green-refactor
description: Enforce TDD workflow (red → green → refactor). Use for any code change that is testable.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# TDD Red / Green / Refactor

Use this skill whenever making code changes that should be covered by tests.

## Non-negotiables
- Start with a failing test that expresses the behavior (red).
- Implement the smallest change to pass (green).
- Refactor for clarity/structure after green, keeping tests passing.
- If no tests exist, add a minimal test harness + a failing test first.

## Workflow
1. Identify the smallest observable behavior.
2. Add or update a test to fail on current code.
3. Run the smallest relevant test command (targeted if possible).
4. Implement the minimal code to make it pass.
5. Refactor with tests still green.
6. Report: test command(s) run + results.

## If tests cannot run
- State why (missing deps, env, credentials, etc.).
- Still write the failing test first and note the expected outcome.
- Provide a suggested test command for the user to run.

## Test targeting
Prefer the narrowest scope:
- single file
- package-level
- repo-level only if needed

## Notes to include in the response
- Which test you wrote first.
- The command used to hit red and green.
- Any refactor that changed structure but not behavior.
