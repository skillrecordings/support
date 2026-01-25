# Eval System - Current State (2026-01-25)

> This doc exists for context continuity across sessions. Read this first.

## TL;DR

**95% complete.** The eval-pipeline CLI runs with REAL Docker tools. Current: **90.3% pass rate** (7 failures remaining).

## What Works ✅

| Component | Status | Command |
|-----------|--------|---------|
| Docker Compose | ✅ Works | `docker compose -f docker/eval.yml up -d` |
| Health checks | ✅ Works | `skill eval-local health` |
| Quality scorers | ✅ Works | 5 scorers: leaks, meta-commentary, banned phrases, fabrication, helpfulness |
| Pipeline steps | ✅ Works | classify, route, gather, draft, validate, e2e |
| Real tools | ✅ Works | `skill eval-pipeline run --real-tools` |
| Seed command | ✅ Works | `skill eval-pipeline seed` |
| LLM calls | ✅ Real | Uses Anthropic API (claude-haiku-4-5 by default) |
| Type checks | ✅ Fixed | `turbo run check-types --filter=@skillrecordings/cli` passes |

## Current Baseline (2026-01-25 04:02 UTC) 🎉

**90.3% pass rate with REAL Docker tools** (up from 88.9%)

| Version | Pass Rate | Tools |
|---------|-----------|-------|
| Production (inflated) | 37.8% | N/A |
| Honest baseline | 88.9% | Real MySQL + Qdrant |
| **+ Pattern fixes** | **90.3%** | Real MySQL + Qdrant |

### Per-Action Breakdown

| Action | Precision | Recall | Notes |
|--------|-----------|--------|-------|
| `silence` | **100%** | **100%** | Perfect ✨ |
| `escalate_urgent` | 100% | 100% | Legal threats only |
| `respond` | 97% | 85% | Main gap: recall |
| `escalate_instructor` | 95% | 91% | Good |
| `escalate_human` | 29% | 100% | Over-firing (root cause of failures) |

### The 7 Remaining Failures

| Scenario | Expected | Got | Root Cause |
|----------|----------|-----|------------|
| `failure_banned_phrases` | respond | escalate_human | Classified as `unknown` (presales Q) |
| `failure_deflection_external` | respond | escalate_human | Classified as `unknown` |
| `failure_deflection_discount` | respond | escalate_human | Classified as `unknown` (student discount Q) |
| `failure_meta_module_issue` | respond | escalate_human | Classified as `unknown` |
| `failure_deflection_recording` | respond | escalate_instructor | Misclassified as personal |
| `failure_meta_joke` | escalate_instructor | escalate_human | Personal msg not detected |
| `failure_routing_instructor_missing` | escalate_instructor | respond | Should escalate |

**Pattern:** 4/7 failures are presales/general inquiries getting `unknown` category → escalate_human.

---

## Taxonomy Evolution

### Current Categories (v1)

```
support_access      - Login/access issues
support_billing     - Invoices, receipts, payment
support_refund      - Refund requests
support_technical   - Tech problems with content
support_other       - Catch-all support
fan_mail            - Personal messages to instructor
automated           - Auto-replies, OOO
vendor_spam         - Sales pitches, partnership spam
unknown             - Can't classify → escalate
```

### Proposed Categories (v2)

Add **presales tier** to handle pre-purchase inquiries:

```
# Existing (keep)
support_access
support_billing
support_refund
support_technical
support_other
fan_mail
automated
vendor_spam

# NEW: Presales tier
presales_faq         → respond      # Price, curriculum, "is this for me"
presales_consult     → escalate_instructor  # Needs judgment, learn from response
presales_team        → escalate_human       # Enterprise/team deals, sales process

# Keep as fallback
unknown              → escalate_human
```

### Presales Signals

**presales_faq** (answerable with knowledge base):
- Pricing questions
- "What's included?"
- Course curriculum / modules
- Tech requirements
- PPP/regional discounts
- "Is this right for me if I know X?"

**presales_consult** (needs human judgment, but track for learning):
- "Should I buy X or Y?"
- Career advice tied to product
- Edge case eligibility
- "Will this help with [specific situation]?"

**presales_team** (always escalate - high value):
- "team of X developers"
- "company license" / "site license"
- "procurement" / "PO" / "invoice"
- "L&D budget" / "training budget"
- Company domain emails
- "volume discount" / "bulk pricing"

### Learning Loop

```
presales_consult → escalate_instructor → Matt answers
                                              ↓
                                        Track Q&A pair
                                              ↓
                                        After N similar Qs answered same way
                                              ↓
                                        Promote to presales_faq (knowledge base)
```

This turns escalations into training data instead of dead ends.

---

## Docker Services

```bash
# Start services
cd ~/Code/skillrecordings/support
docker compose -f docker/eval.yml up -d

# Seed fixtures (MySQL + Qdrant)
skill eval-pipeline seed --clean

# Services:
# - MySQL:  localhost:3306 (user: eval_user, pass: eval_pass, db: support_eval)
# - Redis:  localhost:6379
# - Qdrant: localhost:6333
# - Ollama: localhost:11434 (host, for embeddings)
```

## Quick Commands

```bash
cd ~/Code/skillrecordings/support

# Run honest eval (REAL tools)
DATABASE_URL="mysql://eval_user:eval_pass@localhost:3306/support_eval" \
  skill eval-pipeline run --step e2e --real-tools \
  --scenarios "fixtures/scenarios/**/*.json"

# Run with verbose failures
DATABASE_URL="mysql://eval_user:eval_pass@localhost:3306/support_eval" \
  skill eval-pipeline run --step e2e --real-tools \
  --scenarios "fixtures/scenarios/**/*.json" --verbose

# Run specific step (classify, route, gather, validate, e2e)
skill eval-pipeline run --step classify --scenarios "fixtures/scenarios/**/*.json"

# Seed fixtures
skill eval-pipeline seed --clean

# Score production responses (no Docker needed)
skill eval-local score-production --dataset packages/cli/data/eval-dataset.json --verbose
```

## Data Assets

| File | Records | Source |
|------|---------|--------|
| `fixtures/scenarios/**/*.json` | 72 | Manual test cases (annotated) |
| `fixtures/knowledge/*.md` | 5 | KB articles (embedded in Qdrant) |
| `fixtures/apps/*.json` | 3 | App configs (seeded to MySQL) |
| `fixtures/customers/*.json` | 5 | Customer fixtures |

## File Locations

```
~/Code/skillrecordings/support/
├── docker/
│   └── eval.yml                    # Docker Compose
├── docs/eval-system-prd/
│   ├── CURRENT-STATE.md            # ← YOU ARE HERE
│   ├── HONEST-BASELINE.md          # Baseline analysis
│   ├── PIPELINE-VS-MONOLITHIC.md   # Comparison report
│   └── PIPELINE-AUDIT.md           # Step implementation status
├── fixtures/
│   ├── scenarios/                  # 72 test scenarios
│   ├── knowledge/                  # KB articles for Qdrant
│   ├── apps/                       # App configs for MySQL
│   └── customers/                  # Customer fixtures
├── packages/cli/src/commands/
│   ├── eval-pipeline/              # Pipeline eval CLI
│   │   ├── run.ts                  # Main runner (supports --real-tools)
│   │   ├── real-tools.ts           # Real MySQL + Qdrant tools
│   │   ├── seed.ts                 # Fixture seeding
│   │   └── index.ts                # Command registration
│   └── eval-local/                 # Legacy monolithic eval
└── packages/core/src/pipeline/
    └── steps/                      # Pipeline step implementations
        ├── classify.ts             # Message classification (NEEDS PRESALES)
        ├── route.ts                # Action routing
        ├── gather.ts               # Context gathering
        ├── draft.ts                # Response drafting
        └── validate.ts             # Quality validation
```

## Recent Commits (feat/eval-pipeline-real-tools)

| Commit | Description |
|--------|-------------|
| `f16a165` | Pattern detection for personal vs vendor messages |
| `98c3bbf` | Fix 24 CLI type errors, check-types passes |

## Next Steps

### Immediate (to hit 95%+)
- [ ] Add presales categories to classifier
- [ ] Add presales routing rules
- [ ] Update 4 failing scenarios with new expected categories
- [ ] Re-run eval

### Soon
- [ ] Build presales knowledge base (pricing, curriculum, FAQs)
- [ ] Add team sales detection patterns
- [ ] Implement learning loop tracking

### Later
- [ ] CI integration for regression testing
- [ ] Production monitoring for presales_consult responses
- [ ] Auto-promote patterns from consult → faq

---

*Last updated: 2026-01-25 04:50 UTC*
