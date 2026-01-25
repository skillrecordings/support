# Pipeline Audit Report

**Generated:** 2025-01-25
**Location:** `packages/core/src/pipeline/`

---

## Summary

The support pipeline is **substantially implemented** with a full 6-step flow: classify → route → gather → draft → validate → send. The codebase includes both single-message (v2) and thread-aware (v3) pipelines.

| Step | File | Status | Notes |
|------|------|--------|-------|
| classify | `steps/classify.ts` | ✅ Fully implemented | Fast-path + LLM, single & thread modes |
| route | `steps/route.ts` | ✅ Fully implemented | Rule-based, custom rule support |
| gather | `steps/gather.ts` | ⚠️ Implemented but tools stubbed | Tool interfaces defined, no real impls |
| draft | `steps/draft.ts` | ✅ Fully implemented | Category-specific prompts |
| validate | `steps/validate.ts` | ✅ Fully implemented | Pattern-based quality checks |
| send | `index.ts` (inline) | ⚠️ Stub via sendFn option | No standalone send.ts |

**Additional Steps (v3):**
| Step | File | Status | Notes |
|------|------|--------|-------|
| thread-signals | `steps/thread-signals.ts` | ✅ Fully implemented | Computes thread context signals |
| comment | `steps/comment.ts` | ✅ Fully implemented | Adds Front comments for support_teammate |
| catalog-voc | `steps/catalog-voc.ts` | ⚠️ Mostly implemented | VOC analysis works, storage is TODO |

---

## Step Details

### 1. classify.ts — ✅ FULLY IMPLEMENTED

**What it does:**
- Extracts deterministic signals (email patterns, dates, errors, anger, automation, vendor)
- Fast-path classification (no LLM) for high-confidence cases
- Falls back to LLM (claude-haiku by default) for nuanced cases
- Thread-aware classification with full conversation context

**Key exports:**
- `extractSignals(input)` — deterministic pattern matching
- `fastClassify(input, signals)` — rule-based, returns null if unsure
- `llmClassify(input, signals, model)` — Vercel AI SDK generateObject
- `classify(input, options)` — main entry point
- `classifyThread(input, options)` — thread-aware version (v3)

**Categories:** support_access, support_refund, support_transfer, support_technical, support_billing, fan_mail, spam, system, unknown, + v3: instructor_strategy, resolved, awaiting_customer, voc_response

---

### 2. route.ts — ✅ FULLY IMPLEMENTED

**What it does:**
- Maps classification → action using ordered rules (first match wins)
- Supports custom rule injection with priorities
- Thread-aware routing with additional actions

**Actions:**
- `respond` — draft a response
- `silence` — no action needed
- `escalate_human` — needs human review
- `escalate_instructor` — route to instructor
- `escalate_urgent` — angry customer
- `support_teammate` — teammate is handling, add comment (v3)
- `catalog_voc` — VOC response processing (v3)

**Key exports:**
- `route(input)` — single-message routing
- `routeThread(input)` — thread-aware routing
- `routeWithCustomRules(input, customRules)` — extensible
- `shouldRespond(action)`, `shouldSilence(action)`, `shouldEscalate(action)` — helpers

---

### 3. gather.ts — ⚠️ IMPLEMENTED BUT TOOLS ARE STUBS

**What it does:**
- Collects context needed for drafting: user, purchases, knowledge, history, memory
- Runs operations in parallel with timeout
- Formats context for prompt injection

**Tool interfaces defined:**
```typescript
interface GatherTools {
  lookupUser?: (email: string, appId: string) => Promise<{user, purchases}>
  searchKnowledge?: (query: string, appId: string) => Promise<KnowledgeItem[]>
  getHistory?: (conversationId: string) => Promise<ConversationMessage[]>
  searchMemory?: (query: string) => Promise<MemoryItem[]>
}
```

**Current state:**
- ✅ `extractEmail(text)` — finds customer email in message
- ✅ `formatContextForPrompt(context)` — formats for LLM
- ⚠️ **No real tool implementations** — must be injected via `options.tools`

**What's needed:**
- Wire to Inngest user lookup (purchases from DB)
- Wire to knowledge base (pinecone/embeddings)
- Wire to Front conversation history API
- Wire to agent memory system

---

### 4. draft.ts — ✅ FULLY IMPLEMENTED

**What it does:**
- Generates response using Vercel AI SDK
- Category-specific prompts with style guide
- Customizable prompt overrides

**Key features:**
- Base style guide (no corporate speak, no banned phrases)
- Per-category prompts: support_access, support_refund, support_transfer, support_billing, support_technical
- Uses `formatContextForPrompt()` from gather

**Key exports:**
- `draft(input, options)` — main function
- `getPromptForCategory(category)` — get current prompt
- `setPromptForCategory(category, prompt)` — customize

---

### 5. validate.ts — ✅ FULLY IMPLEMENTED

**What it does:**
- Checks draft for quality issues (deterministic, no LLM)
- Returns issues with severity (error vs warning)
- Blocks sending if errors detected

**Validation types:**
- `internal_leak` — exposes system state to customer
- `meta_commentary` — agent explains itself instead of acting
- `banned_phrase` — corporate speak, em dashes, etc.
- `fabrication` — invents course content without KB support
- `too_short` / `too_long` — length warnings

**Key exports:**
- `validate(input)` — main function
- `formatIssues(issues)` — human-readable output
- `addBannedPhrase(pattern)` — extend blocked patterns

---

### 6. send — ⚠️ NO STANDALONE FILE (inline in orchestrator)

**Current implementation:**
- Pipeline orchestrator (`index.ts`) accepts `sendFn` option
- If not provided, defaults to dry-run (sent: false)
- No standalone `steps/send.ts` exists

**What's needed:**
- Create `steps/send.ts` with Front API integration
- Handle reply threading, author attribution
- Error handling and retry logic

---

### Additional Steps (v3)

#### thread-signals.ts — ✅ FULLY IMPLEMENTED

Computes comprehensive thread signals:
- Thread structure (length, duration, pattern)
- Author breakdown (customer, teammate, agent, instructor counts)
- Resolution detection (thank you + confirmation phrases)
- Await state (is ball in customer's court?)

#### comment.ts — ✅ FULLY IMPLEMENTED

Adds support comments to Front conversations:
- Formats gathered context for teammate visibility
- Uses Front SDK to post comments
- For `support_teammate` action (human is already handling)

#### catalog-voc.ts — ⚠️ MOSTLY IMPLEMENTED

Handles Voice of Customer responses:
- ✅ LLM analysis (sentiment, themes, quotable excerpts)
- ✅ Slack notification formatting
- ⚠️ **Storage is TODO** (catalogId generated but not persisted)
- ✅ Expansion request formatting for testimonials

---

## Pipeline Orchestrator (index.ts)

**Two orchestrators:**

1. `runPipeline(input, options)` — Single-message (v2)
2. `runThreadPipeline(input, options)` — Thread-aware (v3)

**Features:**
- Step timing and success tracking
- Early exit on failures → escalate_human
- Dry-run support
- Injectable functions for testing (gatherFn, draftFn, sendFn)

---

## Evals

| Eval | File | Status | Coverage |
|------|------|--------|----------|
| classify.eval.ts | ✅ Exists | Tests classifier accuracy against labeled dataset |
| validate.eval.ts | ✅ Exists | 15 built-in scenarios + dataset loading |
| e2e.eval.ts | ✅ Exists | Full pipeline with quality scoring |

**Eval infrastructure:**
- Dataset loading from JSON files
- Confusion matrix generation
- Tag-based grouping
- Latency percentiles (p50/p95/p99)
- JSON/human output modes

---

## Dependencies Between Steps

```
classify → route → [gather → draft → validate → send]
                    └─────────────────────────────────┘
                            (only if action = respond)

For support_teammate:
classify → route → gather → comment (no draft/validate)

For catalog_voc:
classify → route → catalog_voc (analysis + notify)
```

---

## What's Needed to Complete the Pipeline

### Critical (blocking production use)

1. **Wire gather tools to real implementations**
   - User/purchase lookup from Inngest DB
   - Knowledge base search (embeddings)
   - Front conversation history
   - Agent memory (if applicable)

2. **Create send step**
   - Front API reply integration
   - Author attribution
   - Error handling

3. **VOC storage**
   - Database table for catalog entries
   - Query interface for analytics

### Nice to Have

4. **Eval datasets**
   - Build classify dataset from production data
   - More e2e scenarios with ground truth

5. **Prompt iteration**
   - A/B test category prompts
   - Track improvements via evals

6. **Metrics/observability**
   - Step latency tracking
   - Classification distribution
   - Validation failure rates

---

## File Inventory

```
packages/core/src/pipeline/
├── index.ts              # Orchestrators (runPipeline, runThreadPipeline)
├── types.ts              # All type definitions
├── ARCHITECTURE.md       # Design documentation
├── steps/
│   ├── classify.ts       # ✅ Signal extraction + LLM classification
│   ├── route.ts          # ✅ Rule-based routing
│   ├── gather.ts         # ⚠️ Context collection (tools stubbed)
│   ├── draft.ts          # ✅ Response generation
│   ├── validate.ts       # ✅ Quality checks
│   ├── thread-signals.ts # ✅ Thread context computation
│   ├── comment.ts        # ✅ Front comment posting
│   └── catalog-voc.ts    # ⚠️ VOC processing (storage TODO)
└── evals/
    ├── classify.eval.ts  # Classifier accuracy testing
    ├── validate.eval.ts  # Validation pattern testing
    └── e2e.eval.ts       # Full pipeline testing
```

**Missing:**
- `steps/send.ts` — needs to be created
