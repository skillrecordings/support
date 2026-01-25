# Eval Iteration Workflow

This document describes the systematic process for improving agent response quality through data-driven iteration.

## Overview

The iteration loop:
```
Analyze → Hypothesize → Test → Validate → Deploy → Monitor
```

## 1. Analyze Failures

### Step 1.1: Run Baseline Analysis

```bash
cd ~/Code/skillrecordings/support
bun scripts/analyze-responses.ts
```

This produces:
- `fixtures/baselines/v1.0.json` - Summary metrics
- `fixtures/baselines/full-analysis.json` - Detailed failure data

### Step 1.2: Review Failure Patterns

Read the baseline analysis:
```bash
cat docs/eval-system-prd/BASELINE-ANALYSIS.md
```

Key questions:
- Which scorer has the worst pass rate?
- What are the most common failure phrases?
- Which category (tool-assisted, direct-response) is failing most?
- Are failures correlated (same responses failing multiple scorers)?

### Step 1.3: Pull Fresh Production Data

```bash
cd packages/cli
bun src/index.ts dataset build --since 2024-01-01 --limit 500 -o ../../fixtures/datasets/latest.json
```

For labeled data:
```bash
bun src/index.ts responses list --rating bad --limit 100 --json > bad-responses.json
```

## 2. Create Hypothesis

### Step 2.1: Identify Root Cause

For each failure pattern, ask:
- Is the prompt missing a rule?
- Is the rule present but not strong enough?
- Is the rule contradicted by another rule?
- Is the model ignoring the rule?

### Step 2.2: Form a Hypothesis

**Template:**
```
Failure: Agent says "[problematic phrase]"
Root cause: [Why the agent is doing this]
Hypothesis: If we [change X], then [the failure] should [decrease/stop]
```

**Examples:**

```
Failure: Agent says "No instructor routing configured"
Root cause: Agent is explaining why it can't route instead of staying silent
Hypothesis: If we add explicit rule "never mention routing configuration", 
            the internal leak rate should drop from 27% to <5%
```

```
Failure: Agent starts with "This is a business inquiry..."
Root cause: Agent is categorizing the message out loud instead of acting
Hypothesis: If we add "never start with 'This is...'" rule,
            meta-commentary rate should drop
```

### Step 2.3: Document the Hypothesis

Create a file in `docs/eval-system-prd/experiments/`:
```yaml
# experiments/exp-001-no-routing-mention.md
---
id: exp-001
hypothesis: Adding explicit "never mention routing configuration" rule
target_metric: internal_state_leakage
current_baseline: 73.3%
target: >90%
status: pending
---
```

## 3. Test the Change

### Step 3.1: Create Prompt Variant

Copy the current prompt to a test file:
```typescript
// packages/core/src/agent/config.test-variant.ts
export const TEST_PROMPT_V1 = `
// ... modified prompt ...
`
```

### Step 3.2: Run Comparison

Use the eval-local compare command:
```bash
cd packages/cli
bun src/index.ts eval-local compare --baseline "current" --candidate "v1" --scenarios "../../fixtures/scenarios/**/*.json"
```

Or run manually:
```bash
bun src/index.ts eval-local run --scenarios "../../fixtures/scenarios/**/*.json" --output results-v1.json
```

### Step 3.3: Compare Results

Compare pass rates:
```bash
jq '.passRates' results-v1.json
jq '.passRates' fixtures/baselines/v1.0.json
```

Look for:
- Did the target metric improve?
- Did any other metric regress?
- Are there new failure patterns?

## 4. Validate Improvement

### Step 4.1: Statistical Significance

For small datasets (n < 100), be cautious:
- A 5% change on 45 samples = ~2 responses
- Look for trends, not absolute numbers

For larger datasets:
- Use confidence intervals
- Aim for >10% improvement before declaring success

### Step 4.2: Check for Regressions

The change should not:
- Break helpfulness (response quality)
- Cause new failure modes
- Significantly increase response length

### Step 4.3: Review Specific Changes

For each failure that now passes:
- Is the new response actually better?
- Or did it just avoid the trigger pattern?

For each new failure:
- Is this a real regression?
- Or noise from the test set?

## 5. Deploy

### Step 5.1: Update Production Prompt

If validation passes:
```bash
# Update the main prompt
vim packages/core/src/agent/config.ts
```

### Step 5.2: Document the Change

Add to `CHANGELOG.md`:
```markdown
## [2026-01-24]
### Changed
- Added explicit rule against mentioning routing configuration
- Reduced internal_state_leakage from 27% to X%
```

### Step 5.3: Update Baseline

```bash
# Re-run analysis and save as new baseline
bun scripts/analyze-responses.ts
mv fixtures/baselines/v1.0.json fixtures/baselines/v1.0.json.bak
cp fixtures/baselines/full-analysis.json fixtures/baselines/v1.1.json
```

## 6. Monitor

### Step 6.1: Track Live Performance

After deployment, monitor:
- Agent response approval rates
- Customer satisfaction (if tracked)
- New failure patterns in production

### Step 6.2: Schedule Regular Evals

Set a cadence:
- Weekly: Run eval on new production data
- Monthly: Review and update scenarios
- Quarterly: Major prompt refactoring if needed

### Step 6.3: Continuous Improvement

After each iteration:
1. Update scenarios with new edge cases discovered
2. Refine scorers if false positives/negatives found
3. Document learnings in this workflow

---

## Quick Reference

### Commands

| Task | Command |
|------|---------|
| Build dataset | `bun src/index.ts dataset build --limit 500 -o file.json` |
| Run analysis | `bun scripts/analyze-responses.ts` |
| Run eval | `bun src/index.ts eval-local run --scenarios "..." --output results.json` |
| Compare prompts | `bun src/index.ts eval-local compare --baseline X --candidate Y` |

### Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/agent/config.ts` | Production prompt |
| `packages/core/src/evals/scorers.ts` | Quality scorers |
| `fixtures/scenarios/**/*.json` | Test scenarios |
| `fixtures/baselines/v1.0.json` | Baseline metrics |
| `docs/eval-system-prd/BASELINE-ANALYSIS.md` | Current analysis |

### Pass Rate Targets

| Scorer | Baseline | Target |
|--------|----------|--------|
| internal_state_leakage | 73% | >95% |
| meta_commentary | 71% | >95% |
| banned_phrases | 71% | >90% |
| product_fabrication | 93% | >98% |
| helpfulness | 82% | >90% |

---

*Last updated: 2026-01-24*
