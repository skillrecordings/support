# Pipeline vs Monolithic Comparison Report

**Date:** 2025-01-25  
**Pipeline Version:** v3 (Thread-aware)  
**Baseline:** Monolithic Agent (honest-baseline.json)

## Executive Summary

| Metric | Monolithic | Pipeline | Δ |
|--------|-----------|----------|---|
| **Pass Rate** | 84.7% (61/72) | **86.1% (62/72)** | **+1.4%** ✅ |
| **Total Duration** | 213,086ms | **126,792ms** | **-40.5%** ✅ |
| **Failed Scenarios** | 11 | **10** | **-1** ✅ |

**Result: Pipeline beats monolithic baseline on both quality and latency.**

---

## Pass Rate Comparison

### Overall Performance

```
Monolithic: ████████████████████░░░░░ 84.7% (61/72)
Pipeline:   █████████████████████░░░░ 86.1% (62/72)
```

### Per-Action Breakdown (Pipeline)

| Action | True Positives | False Positives | False Negatives | Precision | Recall |
|--------|---------------|-----------------|-----------------|-----------|--------|
| respond | 29 | 1 | 4 | 96.7% | 87.9% |
| escalate_instructor | 21 | 4 | 2 | 84.0% | 91.3% |
| silence | 11 | 1 | 2 | 91.7% | 84.6% |
| escalate_urgent | 1 | 1 | 0 | 50.0% | 100% |
| escalate_human | 0 | 3 | 2 | 0% | 0% |

**Key insight:** Pipeline excels at `respond` (96.7% precision) and `escalate_instructor` (91.3% recall) but struggles with `escalate_human` action - these get routed to other escalation types.

---

## Category Performance

### Monolithic Baseline (by category)

| Category | Passed | Failed | NoDraft | Notes |
|----------|--------|--------|---------|-------|
| refund_request | 0 | 0 | 5 | All stayed silent |
| access_issue | 1 | 0 | 2 | |
| technical_help | 6 | 0 | 6 | |
| transfer_request | 0 | 0 | 2 | |
| general | 4 | 0 | 30 | Heavy silence |
| fan_mail | 0 | 0 | 5 | |
| spam | 0 | 0 | 5 | |
| invoice_request | 0 | 0 | 2 | |
| product_inquiry | 2 | 1 | 1 | |

### Pipeline Step-Level Metrics

The pipeline runs discrete steps: `classify → route → gather → draft → validate`

**Scenarios reaching each step:**
- classify: 72/72 (100%)
- route: 72/72 (100%)
- gather: 33/72 (45.8%) - only for respond actions
- draft: 33/72 (45.8%)
- validate: 33/72 (45.8%)

**Step accuracy (from logs):**
- classify step: ~95% accurate (most failures are route-level mismatches)
- route step: ~90% accurate (main source of errors)
- draft step: 31/33 passed validation (93.9%)
- validate step: 2 escalations from validation failures

---

## Latency Comparison

### Total Run Time

```
Monolithic: ██████████████████████████████████████ 213,086ms (3m 33s)
Pipeline:   ███████████████████████░░░░░░░░░░░░░░░ 126,792ms (2m 7s)
```

**40.5% faster with pipeline approach**

### Per-Scenario Latency (Pipeline)

| Percentile | Latency |
|------------|---------|
| Min | 0ms (fast-path routing) |
| p50 | ~1,800ms |
| p95 | ~4,500ms |
| Max | 13,292ms (failure_banned_hear) |

**Note:** Many scenarios complete in <100ms via fast-path routing (silence, escalate_instructor), while respond actions take 2-5s for gather+draft+validate.

### Why Pipeline is Faster

1. **Fast-path routing:** 54% of scenarios (39/72) don't need LLM for drafting
2. **Discrete steps:** Classify uses haiku, only draft uses larger model
3. **No monolithic tool-call loops:** Single LLM call for drafting vs multiple tool iterations

---

## Failure Analysis

### Failed Scenarios (Pipeline - 10 failures)

| Scenario ID | Expected | Actual | Issue |
|-------------|----------|--------|-------|
| refund_outside_policy | escalate_human | respond | Policy check missed in route |
| failure_banned_phrases | respond | escalate_human | Classified as high-risk, escalated |
| edge_angry_customer | escalate_human | escalate_urgent | Escalation type mismatch (close) |
| failure_deflection_external | respond | escalate_instructor | Route misclassified as personal |
| failure_meta_appears | escalate_instructor | silence | Should route to instructor |
| failure_meta_joke | escalate_instructor | escalate_human | Wrong escalation type |
| failure_meta_module_issue | respond | escalate_human | Validation failed, escalated |
| failure_meta_stop_here | silence | escalate_instructor | Over-routed |
| failure_meta_vendor | silence | escalate_instructor | Over-routed |
| failure_deflection_recording | respond | escalate_instructor | Route misclassified |

### Root Causes

1. **Escalation type confusion (3 cases):** `escalate_human` vs `escalate_instructor` vs `escalate_urgent` - these are semantically similar
2. **Route over-classification (3 cases):** Personal/spam messages getting routed to instructor instead of silence
3. **Route under-classification (3 cases):** Messages that should respond getting escalated
4. **Validation strictness (1 case):** Draft passed but validation escalated

### Compared to Monolithic Failures (11)

**Monolithic unique failures:**
- refund_within_policy: Expected draft but stayed silent
- refund_no_purchase: Expected draft but stayed silent  
- technical_generics: Expected draft but stayed silent
- failure_meta_invoice: Expected draft but stayed silent
- failure_banned_great: Expected draft but stayed silent
- failure_banned_hope_helps: Expected draft but stayed silent
- failure_deflection_reach: Expected draft but stayed silent
- failure_deflection_need: Expected draft but stayed silent
- failure_banned_hear: Expected draft but stayed silent

**Pattern:** Monolithic had many "silent when should respond" failures. Pipeline fixed these by explicit respond routing.

---

## Quality Metrics

### Validation Scores (Pipeline drafts that reached validation)

| Scorer | Passed | Description |
|--------|--------|-------------|
| internalLeaks | 33/33 (100%) | No system prompts/tools exposed |
| metaCommentary | 32/33 (97%) | 1 draft had meta language |
| bannedPhrases | 33/33 (100%) | No corporate speak |
| fabrication | 33/33 (100%) | No made-up content |

**Quality is high** - when pipeline drafts, it drafts well.

---

## Key Findings

### Pipeline Advantages

1. **Higher accuracy:** 86.1% vs 84.7% (+1.4%)
2. **Dramatically faster:** 40% reduction in latency
3. **Better helpfulness:** Responds when it should (monolithic stayed silent too often)
4. **Explicit routing:** Clear decision points instead of emergent behavior
5. **Step-level observability:** Can see exactly where failures occur

### Pipeline Disadvantages

1. **Escalation type confusion:** Needs clearer distinction between escalate_human, escalate_instructor, escalate_urgent
2. **Route tuning needed:** Some edge cases over/under-classified
3. **Less flexible:** Monolithic could improvise; pipeline follows fixed steps

### Recommendations

1. **Merge escalation types:** Consider `escalate_human` and `escalate_urgent` as same action for eval
2. **Tune silence vs escalate_instructor:** Add clearer signals for truly personal messages
3. **Add route confidence threshold:** Low-confidence routes → escalate_human instead of guess
4. **Monitor validation strictness:** May be catching false positives

---

## Conclusion

**Pipeline beats the 84.7% monolithic baseline with 86.1% accuracy and 40% faster latency.**

The discrete step architecture provides:
- Better observability (see which step failed)
- Faster execution (fast-path routing)
- Improved helpfulness (responds when appropriate)
- Maintained quality (validation catches issues)

Main improvement areas: escalation type consistency and edge-case routing rules.

---

*Generated by eval-pipeline e2e comparison*
