# Epic 3: Validator Overhaul — Execution Strategy

## Overview

Epic 3 is sliced into 4 subtasks with clear dependencies. This document outlines the execution approach using Ralph loops for automated coding.

## Subtask Dependency Chain

```
#138 Ground Truth + Relevance Fix
  ↓
#139 Fabrication Detection
  ↓
#140 Four-Tier Response System
  ↓
#141 Polish (Audience, Tool-Failure)
```

## Execution Approach

| Subtask | Approach | Rationale |
|---------|----------|-----------|
| **#138** | 🤖 Ralph Loop | Clear scope, TDD, wire existing code |
| **#139** | 🤖 Ralph Loop | Self-contained, pattern matching |
| **#140** | 🤖 Ralph Loop (with review) | Larger but well-specified |
| **#141** | 👤 Interactive | Exploratory, LLM tuning, judgment calls |

## Ralph Loop Configuration

### Story 1: Ground Truth + Relevance Fix (#138)

**Validation Command:**
```bash
cd ~/Code/skillrecordings/support && \
  bun test packages/core/src/pipeline/steps/__tests__/validate.test.ts --grep "ground truth|relevance" && \
  bun run check-types
```

**Acceptance Criteria:**
1. `retrieveSkills()` called in validate step
2. Relevance check returns numeric score (not N/A)
3. Draft matching skill content passes validation
4. Draft contradicting skill content flagged
5. All type checks pass

**Estimated Iterations:** 2-3

---

### Story 2: Fabrication Detection (#139)

**Validation Command:**
```bash
cd ~/Code/skillrecordings/support && \
  bun test packages/core/src/pipeline/steps/__tests__/validate.test.ts --grep "fabrication" && \
  bun run check-types
```

**Acceptance Criteria:**
1. Price claims without skill source flagged
2. Timeline claims without source flagged
3. No false positives on quoted customer text
4. Severity levels correctly assigned

**Estimated Iterations:** 1-2

---

### Story 3: Four-Tier Response System (#140)

**Validation Command:**
```bash
cd ~/Code/skillrecordings/support && \
  bun test packages/core/src/pipeline/steps/__tests__/validate.test.ts && \
  bun test packages/core/src/pipeline/__tests__/thresholds.test.ts && \
  bun run check-types
```

**Acceptance Criteria:**
1. ValidatorDecision type implemented
2. Default returns "draft" action
3. Team license category escalates
4. Gradient scoring (0.0-1.0) working
5. Category thresholds configurable

**Estimated Iterations:** 3-4

---

## Environment Setup

Each Ralph iteration needs Upstash credentials:

```bash
export PATH="$HOME/.bun/bin:$PATH"
export UPSTASH_VECTOR_REST_URL=$(secrets lease upstash_vector_url --raw --ttl 2h --client-id "ralph-epic3")
export UPSTASH_VECTOR_REST_TOKEN=$(secrets lease upstash_vector_token --raw --ttl 2h --client-id "ralph-epic3")
export UPSTASH_REDIS_REST_URL=$(secrets lease upstash_redis_url --raw --ttl 2h --client-id "ralph-epic3")
export UPSTASH_REDIS_REST_TOKEN=$(secrets lease upstash_redis_token --raw --ttl 2h --client-id "ralph-epic3")
```

## Monitoring

### During Loop
- Check `ralph_loop_status` for progress
- Review `progress.txt` for iteration details
- Inspect generated code quality

### Red Flags (cancel and investigate)
- Same test failing 3+ iterations
- Type errors not resolving
- Tests passing but wrong behavior
- Iteration taking >15 minutes

## Post-Loop

After each story completes:
1. Review generated code manually
2. Run full test suite: `bun test`
3. Check types: `bun run check-types`
4. Create PR as Grimlock:
   ```bash
   GH_TOKEN=$(grimlock-token) gh pr create --title "..." --body "Closes #XXX"
   ```
5. Update GitHub issue with completion status

## Success Metrics

| Metric | Target |
|--------|--------|
| Test coverage | All listed test cases pass |
| Type safety | Zero type errors |
| Code quality | No obvious issues on review |
| Iterations | Within estimated range |

## Rollback

If a story fails repeatedly:
1. Cancel Ralph loop
2. Reset branch: `git checkout main`
3. Investigate test failures manually
4. Adjust story scope or break down further
5. Re-attempt with refined approach

## References

- GitHub Issues: #138, #139, #140, #141
- Parent Epic: #28
- Oracle Context: `memory/oracle-session-2026-01-27.md`
- Skill Retrieval: `scripts/skill-retrieval.ts`
