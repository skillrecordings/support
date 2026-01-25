# Eval System - Current State (2026-01-25)

> This doc exists for context continuity across sessions. Read this first.

## TL;DR

**95% complete.** The eval-pipeline CLI runs with REAL Docker tools. Honest baseline achieved: **88.9% pass rate**.

## What Works ✅

| Component | Status | Command |
|-----------|--------|---------|
| Docker Compose | ✅ Works | `docker compose -f docker/eval.yml up -d` |
| Health checks | ✅ Works | `skill eval-local health` |
| Quality scorers | ✅ Works | 5 scorers: leaks, meta-commentary, banned phrases, fabrication, helpfulness |
| Pipeline steps | ✅ Works | classify, route, gather, draft, validate, e2e |
| Real tools | ✅ **NEW** | `skill eval-pipeline run --real-tools` |
| Seed command | ✅ **NEW** | `skill eval-pipeline seed` |
| LLM calls | ✅ Real | Uses Anthropic API (claude-haiku-4-5 by default) |

## Honest Baseline (2026-01-25 01:42 UTC) 🎉

**88.9% pass rate with REAL Docker tools.**

| Version | Pass Rate | Tools |
|---------|-----------|-------|
| Production (actual) | 37.8% | N/A |
| Monolithic eval | 84.7% | Mocks |
| Pipeline (mock) | 86.1% | Mocks |
| **Pipeline (honest)** | **88.9%** | **Real MySQL + Qdrant** |

Per-action breakdown:
- `respond`: 97% precision, 91% recall
- `escalate_instructor`: 83% precision, 87% recall
- `silence`: 92% precision, 85% recall
- `escalate_urgent`: 100% (legal threats)
- `escalate_human`: 50% precision, 100% recall

**Details:** See `HONEST-BASELINE.md`

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
| `results/honest-pipeline-baseline.json` | 72 | Latest honest eval results |

## File Locations

```
~/Code/skillrecordings/support/
├── docker/
│   └── eval.yml                    # Docker Compose
├── docs/eval-system-prd/
│   ├── CURRENT-STATE.md            # ← YOU ARE HERE
│   ├── HONEST-BASELINE.md          # Latest honest baseline
│   ├── PIPELINE-VS-MONOLITHIC.md   # Comparison report
│   └── PIPELINE-AUDIT.md           # Step implementation status
├── fixtures/
│   ├── scenarios/                  # 72 test scenarios
│   ├── knowledge/                  # KB articles for Qdrant
│   ├── apps/                       # App configs for MySQL
│   └── customers/                  # Customer fixtures
├── packages/cli/src/commands/
│   ├── eval-pipeline/              # NEW - Pipeline eval CLI
│   │   ├── run.ts                  # Main runner (supports --real-tools)
│   │   ├── real-tools.ts           # Real MySQL + Qdrant tools
│   │   ├── seed.ts                 # Fixture seeding
│   │   └── index.ts                # Command registration
│   └── eval-local/                 # Legacy monolithic eval
├── packages/core/src/pipeline/
│   └── steps/                      # Pipeline step implementations
│       ├── classify.ts             # Message classification
│       ├── route.ts                # Action routing (FIXED)
│       ├── gather.ts               # Context gathering
│       ├── draft.ts                # Response drafting
│       └── validate.ts             # Quality validation
└── results/
    └── honest-pipeline-baseline.json
```

## Routing Fixes Applied (2026-01-25)

Added new signals to fix escalation confusion:

| Signal | Triggers | Action |
|--------|----------|--------|
| `hasLegalThreat` | lawyer, legal action, sue | escalate_urgent |
| `hasOutsidePolicyTimeframe` | >30 days for refunds | escalate_human |
| `isPersonalToInstructor` | fan mail, casual messages | escalate_instructor |

## Remaining Work

### Done ✅
- [x] Docker services running
- [x] MySQL schema pushed
- [x] Fixtures seeded (apps, knowledge, trust scores)
- [x] `--real-tools` flag wired to MySQL + Qdrant
- [x] Routing fixes for escalation types
- [x] Honest baseline achieved (88.9%)

### TODO
- [ ] Investigate remaining 8 failures
- [ ] Add more knowledge base fixtures
- [ ] Test v2 prompt against honest baseline
- [ ] CI integration for regression testing

---

*Last updated: 2026-01-25 01:42 UTC*
