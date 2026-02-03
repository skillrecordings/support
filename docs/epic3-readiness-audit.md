# Epic 3 Readiness Audit: Validator Overhaul

**Audit Date:** 2026-02-03  
**Auditor:** AI Agent (subagent:epic3-readiness-audit)  
**Epic:** [#28 - Epic 3: Validator Overhaul](https://github.com/skillrecordings/support/issues/28)

---

## Executive Summary

Epic 3 proposes a fundamental shift: transform the validator from a **critic** (returns score + issues) into an **editor** (returns `pass | fix | escalate`). The current implementation gap is significant. The validator detects problems but has no mechanism to fix them. Key dependencies are partially met.

**Readiness Score: 🟡 60%**

| Dependency | Status | Notes |
|------------|--------|-------|
| KB Ground Truth (Epic 2) | 🟡 Partial | Infrastructure exists, unsure if populated with real data |
| Template Fast-Path | 🟢 Ready | Already in `draft.ts` — skips validation at ≥0.9 confidence |
| Validator Core | 🔴 Major refactor | Returns `valid: boolean`, not `pass | fix | escalate` |
| Edit Logic | 🔴 Missing | No mechanism to modify drafts — validator is read-only |
| Escalation Thresholds | 🔴 Missing | No category-specific bars or "Three Nightmares" logic |
| Single-Comment Output | 🟡 Partial | Comment step exists but no "summary of changes" pattern |

---

## 1. Current State Summary

### 1.1 Validator (`validate.ts`)

**What it does now:**
- Pattern checks (deterministic, no LLM):
  - `INTERNAL_LEAK_PATTERNS` (23 patterns) — catches system state exposure
  - `META_COMMENTARY_PATTERNS` (27 patterns) — catches agent self-narration
  - `BANNED_PHRASES` (17 patterns) — corporate speak detection
  - Fabrication detection (when `hasKnowledge: false`)
  - Length checks (min 10, max 2000 chars)
- Memory check — queries for similar corrected drafts to catch repeated mistakes
- Relevance check (LLM) — verifies draft addresses customer's question

**Output signature:**
```typescript
interface ValidateResult {
  valid: boolean           // Pass/fail flag
  issues: ValidationIssue[]  // List of problems found
  suggestion?: string        // Generic advice
  relevance?: number         // 0-1 score from LLM check
  correctionsChecked?: RelevantMemory[]
  memoryCheckPerformed: boolean
  relevanceCheckPerformed: boolean
}
```

**Gap:** Returns `valid: boolean` — no `pass | fix | escalate` action. No edit capability.

### 1.2 Draft Step (`draft.ts`)

**Current flow:**
1. Check for template match (≥0.9 confidence) → **Skip validation entirely if match**
2. Query memory for relevant past decisions
3. Generate with LLM (or agent mode with tools)

**Template fast-path already exists:**
```typescript
if (!skipTemplateMatch && appId) {
  const matchResult = await matchTemplate({ ... threshold: 0.9 })
  if (matchResult.match) {
    // Use template, skip LLM generation
    return { draft: interpolatedContent, reasoning: `Template match: ...` }
  }
}
```

**Gap:** Template matches currently bypass validation entirely. Epic 3 wants templates to skip validation but still go through the pipeline's single-comment logic.

### 1.3 Routing/Escalation (`route.ts`)

**Current escalation rules:**
- `legal_threat_urgent` → `escalate_urgent` (legal keywords)
- `refund_policy_violation` → `escalate_human` (refund outside window)
- `angry_escalate` → `escalate_human` (frustrated customer)
- `unknown_escalate` → `escalate_human` (low confidence)
- `presales_team_escalate` → `escalate_human` (enterprise inquiries)

**Gap:** No category-specific thresholds. No "Three Nightmares" detection:
1. Large team sales fumbled (no $5k+ deal detection)
2. Bug patterns missed (no multi-report correlation)
3. Neglect → client DMs (no draft-neglect-escalate logic)

### 1.4 Template System (`templates/`)

**What exists:**
- `match.ts` — Semantic search against Front templates in vector store
- `sync.ts` — Syncs Front templates to Upstash Vector
- `analytics.ts` — Template usage tracking
- `stale.ts` — Stale template detection

**Template matching flow:**
```
Query → Vector search (filter: appId, type=response, source=canned-response) 
      → Best match above threshold → Interpolate variables → Return
```

**Gap:** No template definitions stored in code. Templates are synced from Front. Need to verify Front templates exist and are properly synced.

### 1.5 Knowledge Base (`knowledge/`)

**Infrastructure exists:**
- `search.ts` — Two-stage retrieval (Vector → Redis)
- `ingest.ts` — Ingestion pipeline
- `types.ts` — KB schemas

**Gap:** Epic 2 is marked CLOSED but need to verify:
- Are ~95 FAQ articles actually ingested?
- Is `searchKnowledge()` wired into gather step?
- Is KB being used for ground truth in drafts?

---

## 2. Gaps Identified

### 2.1 🔴 Critical: Validator Return Type

**Spec says:**
```typescript
// Validator returns one of:
{ action: 'pass', draft }           // Draft is good
{ action: 'fix', updatedDraft, changes: string[] }  // Fixed issues
{ action: 'escalate', reason }      // Needs human judgment
```

**Current reality:**
```typescript
{ valid: boolean, issues: ValidationIssue[], suggestion?: string }
```

**Required changes:**
1. New return type: `ValidateAction` with `pass | fix | escalate`
2. Edit logic to transform draft (not just flag issues)
3. Changes list for audit trail

### 2.2 🔴 Critical: Edit Logic Missing

Validator can detect meta-commentary like `"I don't have X configured"` but cannot remove it. Spec requires:

| Issue Type | Fix Action |
|------------|------------|
| Meta-commentary | Strip offending sentences |
| Tone issues | Rewrite with LLM |
| Missing greeting/sign-off | Prepend/append standard elements |
| KB factual errors | Correct from ground truth |
| Link/URL issues | Replace with valid URLs |
| Formatting | Normalize markdown/whitespace |

This requires an **LLM edit pass** within validation.

### 2.3 🔴 Critical: Escalation Thresholds

**Missing from code:**
- Category-specific confidence floors
- "Three Nightmares" detection logic:
  - Large deal detection (needs purchase amount checks)
  - Bug pattern correlation (needs multi-conversation analysis)
  - Draft neglect tracking (needs Redis TTL on drafts)
- Four-tier system gates:
  - Auto-send (95%+ sent-unchanged rate)
  - Draft (default)
  - Escalate (high stakes)
  - Draft-neglect-escalate (timeout promotion)

### 2.4 🟡 Partial: Single-Comment Output

**Spec goal:** One draft instance, one summary comment (if changes made). No multi-comment spam.

**Current state:**
- `addDecisionComment()` exists for agent reasoning
- No "changes summary" pattern after validation edits
- Draft regeneration creates new drafts (not in-place edits)

### 2.5 🟡 Partial: KB Ground Truth Verification

**Need to verify:**
```bash
# Check if knowledge articles are populated
redis-cli KEYS "knowledge:*" | wc -l
# Check vector namespace
curl -s http://localhost:6333/collections | jq '.result.collections[].name'
```

If KB is empty, fabrication detection and ground truth comparison will fail.

### 2.6 🟢 Ready: Template Fast-Path

Already implemented in `draft.ts`:
- Confidence threshold configurable (default 0.9)
- High-confidence matches skip LLM generation
- Templates interpolate variables from context

**Minor adjustment needed:** Currently skips validation entirely. Epic 3 wants validation skipped BUT the single-comment pattern should still apply.

---

## 3. Recommended Subtask Breakdown

Organized for **file-based parallel work** (no overlapping files):

### Phase 1: Foundation (Sequential)

| # | Subtask | Files | Deps | Estimate |
|---|---------|-------|------|----------|
| 3.1 | Define new types | `pipeline/types.ts` | None | S |
| 3.2 | KB data verification | N/A (ops task) | None | S |

### Phase 2: Core Refactor (Parallel after 3.1)

| # | Subtask | Files | Deps | Estimate |
|---|---------|-------|------|----------|
| 3.3 | Validator return type refactor | `pipeline/steps/validate.ts` | 3.1 | M |
| 3.4 | Edit logic (meta-commentary removal) | `pipeline/steps/validate.ts` (new functions) | 3.3 | M |
| 3.5 | Escalation threshold config | `pipeline/steps/route.ts` | 3.1 | M |
| 3.6 | Three Nightmares detection | `router/rules.ts` | 3.5 | M |

### Phase 3: Integration (Parallel after Phase 2)

| # | Subtask | Files | Deps | Estimate |
|---|---------|-------|------|----------|
| 3.7 | Ground truth comparison | `pipeline/steps/validate.ts` | 3.2, 3.4 | M |
| 3.8 | Fabrication detection enhancement | `pipeline/steps/validate.ts` | 3.7 | S |
| 3.9 | Single-comment output pattern | `pipeline/steps/comment.ts` | 3.3 | S |
| 3.10 | Template fast-path adjustment | `pipeline/steps/draft.ts` | 3.9 | S |

### Phase 4: Pipeline Wiring (Sequential)

| # | Subtask | Files | Deps | Estimate |
|---|---------|-------|------|----------|
| 3.11 | Pipeline orchestrator update | `pipeline/index.ts` | 3.3, 3.5, 3.9 | M |
| 3.12 | Escalate-on-tool-failure | `pipeline/index.ts` | 3.11 | S |

---

## 4. Blockers

### 4.1 🔴 Blocker: Design Decision Required

**Question:** Should validation edits use an LLM call or deterministic transforms?

- **LLM approach:** More flexible, can handle tone/style adjustments
- **Deterministic:** Faster, cheaper, predictable (regex replacements)

**Recommendation:** Hybrid — deterministic for meta-commentary/formatting, LLM for tone adjustments. Need human decision.

### 4.2 🟡 Potential Blocker: KB Data

If Epic 2's KB is not populated with real FAQ data, ground truth comparison will be ineffective. Need verification:

```bash
# Check knowledge article count per app
bun packages/cli/src/index.ts kb stats
```

### 4.3 🟡 Potential Blocker: Trust Score Data

Four-tier system depends on `per-category sent-unchanged rate`. This requires:
- Draft tracking (Epic 2 subtask)
- Enough historical data per category

If trust scores aren't populated, auto-send tier is blocked.

---

## 5. Suggested Order of Operations

```
Week 1:
├── 3.1 Define new types (validates design)
├── 3.2 KB data verification (unblocks 3.7)
└── Design decision: LLM vs deterministic edits

Week 2 (parallel):
├── Worker A: 3.3 Validator return type refactor
├── Worker B: 3.5 Escalation threshold config
└── Worker C: 3.6 Three Nightmares detection

Week 3 (parallel):
├── Worker A: 3.4 Edit logic implementation
├── Worker B: 3.7 Ground truth comparison
└── Worker C: 3.9 Single-comment pattern

Week 4:
├── 3.8 Fabrication detection enhancement
├── 3.10 Template fast-path adjustment
├── 3.11 Pipeline orchestrator update
└── 3.12 Escalate-on-tool-failure
```

---

## 6. Files Summary

**Will be created:**
- None (all work modifies existing files)

**Will be modified:**

| File | Changes |
|------|---------|
| `packages/core/src/pipeline/types.ts` | Add `ValidateAction` type |
| `packages/core/src/pipeline/steps/validate.ts` | Major refactor — new return type, edit logic |
| `packages/core/src/pipeline/steps/route.ts` | Escalation thresholds |
| `packages/core/src/pipeline/steps/draft.ts` | Template fast-path adjustment |
| `packages/core/src/pipeline/steps/comment.ts` | Changes summary pattern |
| `packages/core/src/pipeline/index.ts` | Pipeline orchestrator |
| `packages/core/src/router/rules.ts` | Three Nightmares logic |

---

## 7. What's Changed Since Spec Was Written

1. **Epic 1A completed:** Meta-commentary patterns expanded from 11→27, internal leak patterns from 12→23
2. **Memory integration added:** Validator now checks against corrected memories (wasn't in original Epic 3 spec)
3. **Relevance check added:** LLM-based check verifies draft addresses customer question
4. **Template matching refined:** Now uses vector search with confidence threshold

These additions are compatible with Epic 3's design. The spec's core thesis — validator as editor, not critic — remains the primary gap.

---

## Appendix: Key Code References

### Current Validator Signature
```typescript
// packages/core/src/pipeline/steps/validate.ts
export async function validate(
  input: ValidateInput,
  options: ValidateOptions = {}
): Promise<ValidateResult>
```

### Routing Rules
```typescript
// packages/core/src/pipeline/steps/route.ts
const ROUTING_RULES: RoutingRule[] = [
  { name: 'system_silence', ... },
  { name: 'legal_threat_urgent', ... },
  { name: 'refund_policy_violation', ... },
  // ...
]
```

### Template Fast-Path
```typescript
// packages/core/src/pipeline/steps/draft.ts
if (!skipTemplateMatch && appId) {
  const matchResult = await matchTemplate({ threshold: templateThreshold })
  if (matchResult.match) {
    return { draft: interpolatedContent, ... }
  }
}
```

---

**End of Audit Report**
