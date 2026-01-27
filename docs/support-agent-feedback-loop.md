# Product Requirements Document: Support Agent System

> **Version:** 1.0  
> **Date:** 2026-01-27  
> **Owner:** Joel Hooks  
> **Status:** Active  
> **Codebase:** `~/Code/skillrecordings/support`

---

## 1. Executive Summary

### What it does today

An AI-powered support agent built on Front (helpdesk) and Inngest (event-driven workflows). When a customer emails support, the pipeline classifies the message, routes it (respond / escalate / silence), and — for the respond path — gathers context, drafts a reply via Claude Haiku, validates it, optionally auto-approves, and creates a draft in Front for a human to send.

The system handles ~20 inbound messages/day across 2 registered products (Total TypeScript, AI Hero). It correctly silences spam and system notifications (~55% of volume), escalates ambiguous cases, and drafts responses for the rest.

### What works

- **Classification** is solid — fast-path regex handles spam/system at 0.90-0.98 confidence, LLM handles nuanced categories
- **Routing** is deterministic and reliable — first-match rule engine, no LLM needed
- **Spam/system filtering** removes ~55% of inbound noise correctly
- **Pipeline reliability** is excellent — zero blocking failures in 30 days, 100% step completion
- **Architecture** is well-designed — event-driven, each step is independently deployable, full Axiom observability

### What's broken

- **53% of auto-approved responses are bad quality** (16/30 audited responses rated BAD)
- **Validator is a rubber stamp** — 100% of drafts score 1.0, zero issues flagged, LLM relevance check not running
- **Knowledge base is empty** — `search_knowledge` is a TODO stub returning `[]`
- **Agent drafts blind** — `hasKnowledge: false`, `hasMemory: false`, `toolsUsed: []` across all responses
- **Meta-commentary leaks to customers** — 47% of responses expose internal routing decisions
- **AI Hero lacks instructor routing** — causes 40% of bad responses (fan mail mishandling)
- **`apply-tag` broken** — 100% failure rate (21/21 attempts in 30d)
- **No cross-conversation awareness** — repeat customers start from scratch

### Vision

A closed-loop support system where the agent learns from every interaction:

```
customer asks → agent drafts (with KB) → human corrects via comment →
correction becomes KB entry → KB entry becomes on-site FAQ →
fewer customers need to ask
```

---

## 2. Current System

### Architecture Overview

7-stage Inngest pipeline, event-driven:

```
Webhook → ① Classify → ② Route → ③ Gather → ④ Draft → ⑤ Validate → ⑥ Approve → ⑦ Execute
                           │
                     ┌─────┼─────┐
                  respond  silence  escalate
                     │       │        │
                  (full    archive   comment
                  pipeline)          + tag
                                    + Slack
```

- **Model:** `anthropic/claude-haiku-4-5` (classify, draft, validate relevance)
- **Infrastructure:** Inngest (orchestration), Front (helpdesk), Upstash Redis + Vector (storage), Axiom (observability), Slack (approvals)
- **21 Inngest functions** registered, 5 cron jobs
- **Full architecture reference:** [`docs/pipeline-architecture.md`](./pipeline-architecture.md)

### What works well

| Capability | Evidence |
|---|---|
| Classification accuracy | Fast-path regex handles 55%+ of volume at 0.90-0.98 confidence; LLM fallback handles nuanced cases |
| Routing correctness | Deterministic first-match rules; 37/50 routing decisions correctly skipped non-support messages |
| Spam/system filtering | 11/11 spam and system messages correctly silenced in 24h audit |
| Pipeline reliability | 100% step completion rate; zero blocking errors in 30 days |
| Escalation quality | Accurate identification of knowledge gaps; clear escalation reasons |
| Within-thread awareness | Classifier shows thread context in reasoning; gather fetches conversation history |
| Performance | Draft generation: 1.0-1.7s; total pipeline: 3.4-7.7s end-to-end |

### Critical issues found

| Issue | Evidence | Impact |
|---|---|---|
| Validator rubber-stamps everything | 11/11 drafts scored 1.0, zero issues flagged ([auto-approval audit](../../clawd/memory/forensic-auto-approval-audit.md)) | Quality gate provides zero signal |
| Knowledge base empty | `searchKnowledge()` is a TODO stub; `hasKnowledge: false` for all responses ([response quality analysis](../../clawd/memory/support-agent-response-quality.md)) | Agent improvises all answers |
| LLM relevance check not running | Returns `N/A` for all drafts; body assertion likely failing silently ([forensic toolkit findings](../../clawd/memory/forensic-query-toolkit.md)) | The one check that could differentiate quality is dead |
| Meta-commentary in 47% of responses | "I don't have an instructor configured in the system", "Per my guidelines" ([auto-approval audit](../../clawd/memory/forensic-auto-approval-audit.md)) | Exposes internal systems to customers |
| AI Hero fan mail mishandling | 12/30 responses were fan mail; all rated BAD; no instructor routing configured ([auto-approval audit](../../clawd/memory/forensic-auto-approval-audit.md)) | Single biggest quality problem — 40% of bad responses |
| `apply-tag` 100% failure rate | 21/21 attempts failed in 30 days ([24h audit](../../clawd/memory/support-agent-audit-24h.md)) | Conversations not categorized in Front |
| No cross-conversation awareness | Customer had same issue across 2 conversations; pipeline drafted contradictory responses ([repeat sender analysis](../../clawd/memory/forensic-repeat-senders.md)) | Repeat customers start from scratch |
| Fabricated claims | "Not sold out" (no inventory check), "discount through Feb 5th" (no pricing access), "materials will arrive soon" (no schedule knowledge) ([response review](../../clawd/memory/support-agent-response-review.md)) | 10% of responses contain unverifiable claims |
| `SUPPORT_CONVERSATION_RESOLVED` has no emitter | Event type defined, consumer registered, but nothing emits it ([data flow audit](../../clawd/memory/epic1-data-flow-audit.md)) | Conversation indexing is dead code |
| `handleMemoryCitation` not registered | Defined but not in `allWorkflows` array ([pipeline architecture](./pipeline-architecture.md)) | Citation tracking is dead |

---

## 3. Problem Statement

### The agent is flying blind

Every response is generated with `hasKnowledge: false`, `hasMemory: false`, `toolsUsed: []`. The agent operates on pure LLM instinct with zero grounding data. Despite this:

- All drafts pass validation with score 1.0
- All are auto-approved (threshold: 0.8)
- 53% are bad quality

The validator cannot catch fabrications it has no ground truth to compare against. The auto-approve gate never triggers human review because the validator never flags anything.

### Quality breakdown (30 responses audited)

| Rating | Count | % | Primary issue |
|---|---|---|---|
| ✅ GOOD | 5 | 17% | Correct, actionable, appropriate |
| ⚠️ ACCEPTABLE | 9 | 30% | Functional but with risks (fabrication, missing context) |
| 🔴 BAD | 16 | 53% | Meta-commentary, misdirected, system internals exposed |

### Failure modes by frequency

| Failure | % of all responses | Root cause |
|---|---|---|
| Meta-commentary / system internals exposed | 47% | Agent explains routing decisions TO the customer |
| Should have been silenced/escalated | 47% | Fan mail flowing through respond path |
| Misdirected (internal note as customer response) | 40% | No instructor routing for AI Hero |
| Possible fabrication | 10% | No KB = no ground truth = confident guessing |
| Ignored context (attachments, thread history) | 7% | Gather step limitations |

### The saving grace

All responses become Front drafts, not auto-sends. A human must click "Send" in Front. This is the real quality gate — not the validator. But it means the entire validation → auto-approve pipeline adds no value over simply creating unvalidated drafts.

---

## 4. Product Vision: The Feedback Loop

Four layers that build on each other, creating a system that gets smarter with every interaction.

### Layer 1: Knowledge Base

**Status:** Architecture designed, ready for implementation  
**Impact:** Highest leverage — transforms agent from blind to informed  
**Effort:** ~3 files to modify, zero new infrastructure

Populate Upstash Vector with existing FAQ content (~95 Q&As across 5 products). Wire up the `searchKnowledge` stub in the gather step. The agent stops flying blind.

| Source | Q&As | Format | Access method |
|---|---|---|---|
| Total TypeScript | 19 | MDX static file | Parse `faq.mdx` |
| Epic React | 22 | TSX embedded markdown | Parse `faq.tsx` |
| Epic Web | 23 | TSX embedded markdown | Parse `faq.tsx` |
| AI Hero | 15 | PlanetScale DB (`AI_ContentResource`) | API endpoint or direct query |
| Testing Accessibility | 16 | Live site | Web scrape |
| **Shared (cross-product)** | ~7 (deduped) | Common boilerplate | Extract once |
| **Total** | **~95** | | **~102 vector chunks** |

**Architecture:** Upstash Vector (semantic search, `knowledge` namespace) + Upstash Redis (full article storage as Hashes). Both already provisioned. No new infrastructure.

**Two-stage retrieval:**
1. Vector search finds relevant chunks (topK=8, minScore=0.65, filtered by `appId`)
2. Redis Hash lookup provides full article content for top 3 unique articles

**Design reference:** [`memory/kb-architecture-design.md`](../../clawd/memory/kb-architecture-design.md)

### Layer 2: Comment-Based Learning

**Status:** Epic exists (cell--al4e8-mku0l2viige), needs expansion  
**Impact:** Lightweight RLHF via retrieval augmentation  
**Dependency:** Layer 1 (KB provides baseline; corrections improve it)

When a human edits an agent draft before sending (or adds a Front comment with a correction), the system stores that correction as a high-signal memory. On future similar questions, the agent retrieves the correction and uses it to improve its draft.

The memory system infrastructure exists (SupportMemoryService, vector store, voting). The gap: no mechanism to capture corrections from Front comments and feed them back.

**Cycle:** Human corrects draft → correction stored in memory → next similar question retrieves correction → better draft → fewer corrections needed

### Layer 3: Dynamic FAQ Generation

**Status:** New workstream  
**Impact:** KB grows organically from real support patterns  
**Dependency:** Layers 1 + 2

Frequently asked questions auto-detected from support patterns. When the agent handles the same type of question 3+ times with human-approved responses, it proposes a new FAQ entry. Human approves via Front comment. KB grows without manual curation.

### Layer 4: Upstream Propagation

**Status:** New workstream, long-term  
**Impact:** Full closed loop — support reduces future support  
**Dependency:** Layers 1 + 2 + 3

Approved FAQ entries propagate to:
- Product repos (PRs to `faq.mdx` / `faq.tsx` files)
- Databases (`AI_ContentResource` updates for AI Hero)
- On-site FAQ pages auto-update

Customers find answers before they email support. Fewer tickets. Self-service improves. Full closed loop.

### The Full Cycle

```
Customer asks question
    → Agent drafts response (grounded in KB)
        → Human corrects via Front comment
            → Correction becomes KB entry
                → KB entry becomes on-site FAQ
                    → Fewer customers need to ask
```

---

## 5. Workstreams

### 5.1 Pipeline Architecture Map ✅ DONE

Comprehensive documentation of the 7-stage pipeline, all 21 Inngest functions, data flow at each boundary, known issues.

**Output:** [`docs/pipeline-architecture.md`](./pipeline-architecture.md)

### 5.2 Forensic Inbox Research 🔄 IN PROGRESS

Auditing real support conversations to understand quality, failure modes, and patterns.

**Completed:**
- Auto-approval quality audit (30 responses reviewed)
- Repeat sender analysis (3 identified, cross-conversation blindness confirmed)
- 24h pipeline audit (20 events traced end-to-end)
- Response quality analysis (3 deep-dive traces)
- Response review (10 responses scored)
- Conversation trace (cnv_1jdp6oth full pipeline walkthrough)
- FAQ content survey (all 5+ products audited)

**Outputs:** `memory/forensic-*.md`, `memory/support-agent-*.md`

### 5.3 Knowledge Base Implementation 🆕 P0

Populate the empty KB with ~95 existing FAQ articles. Wire up the gather step.

**New files:**
- `packages/core/src/knowledge/search.ts` — `searchKnowledge()` implementation
- `packages/core/src/knowledge/ingest.ts` — Article parsing, chunking, upserting
- `packages/core/src/knowledge/types.ts` — KB-specific types
- `packages/core/src/knowledge/parsers/markdown.ts` — MDX/TSX FAQ parser
- `packages/cli/src/commands/kb-sync.ts` — CLI sync command

**Files to modify:**
- `packages/core/src/inngest/workflows/gather-context.ts` — Wire `searchKnowledge`
- `packages/core/src/tools/search-knowledge.ts` — Replace TODO stub
- `packages/core/src/agent/config.ts` — Update searchKnowledge tool

**Design reference:** [`memory/kb-architecture-design.md`](../../clawd/memory/kb-architecture-design.md)

### 5.4 Validator Overhaul 🆕 P1

Fix the rubber stamp. The validator needs to actually differentiate quality.

**Problems to fix:**
- LLM relevance check not running (returns N/A — body assertion likely failing)
- Pattern checks too narrow (miss actual meta-commentary patterns)
- Fabrication check only catches "module 1"/"lesson 3" — misses pricing, availability, timeline claims
- Score is binary (1.0 or 0.0) — no gradient
- No audience-awareness check ("would a customer understand this?")

**New capabilities needed:**
- Expanded meta-commentary detection: `"I don't have .* configured"`, `"I can't route"`, `"no instructor configured"`, `"system"` in self-referential context
- Fabrication detection for specific claims (prices, dates, timelines, availability) without source data
- Audience-awareness: flag responses referencing routing, configuration, tool names
- Escalate-on-tool-failure: when `lookupUser`/`getPurchases` fails, don't ask the customer for info the system should have
- Ground truth comparison: with KB populated (Layer 1), compare draft claims against KB content

### 5.5 Comment-Based Learning System 🆕 P1

**Existing epic:** cell--al4e8-mku0l2viige (expanded)

Capture human corrections from Front and store as high-signal memories.

**Required:**
- Front webhook listener for comment events
- Correction extraction (diff between agent draft and human-edited version)
- Memory storage with correction metadata
- Retrieval integration in draft step (already partially wired)

### 5.6 Dynamic FAQ Generation 🆕 P2

Auto-detect frequently asked questions from support patterns and propose new KB entries.

### 5.7 Upstream Propagation 🆕 P3

Propagate approved FAQ entries to product repos and databases.

### 5.8 Bug Fixes 🆕 P0

| Bug | Location | Impact | Fix |
|---|---|---|---|
| **Meta-commentary leak** | `validate.ts` pattern checks | 47% of responses expose internals | Expand pattern matching (see §5.4) |
| **AI Hero instructor routing** | App registry / routing rules | 40% of bad responses from fan mail mishandling | Configure instructor for AI Hero OR add routing rule to silence outreach replies |
| **`apply-tag` broken** | `route-message.ts` → Front API | 100% failure rate, 21 failures in 30d | Investigate Front API tag permissions/config |
| **`SUPPORT_APPROVAL_REQUESTED` missing fields** | `handle-validated-draft.ts` | `customerEmail` and `inboxId` never populated; Slack shows `undefined` | Populate `customerEmail: senderEmail` |
| **`draft.toolsUsed` dropped** | `validate-draft.ts` | Lost at validate boundary — breaks audit trail | Forward in emitted event |
| **History `direction` field lost** | `gather-context.ts` → `draft-response.ts` | Fragile reconstruction from `from` field | Include `direction` in emitted history |
| **`handleMemoryCitation` not registered** | `workflows/index.ts` | Citation tracking is dead code | Add to `allWorkflows` array |
| **`SUPPORT_CONVERSATION_RESOLVED` no emitter** | Events system | `index-conversation` workflow can never trigger | Emit from appropriate lifecycle point |
| **User ID dropped at gather boundary** | `gather-context.ts` | `user.id` set to email — tool execution may need real ID | Emit full user object |

---

## 6. Priority & Sequencing

### P0 — Do First (this week)

**6.1 Bug fixes: Meta-commentary detection**
- Expand validator pattern checks to catch actual meta-commentary patterns
- Block: "I don't have * configured", "per my guidelines", "I can't route", tool names, system disclosure
- **Eliminates 47% of bad responses**

**6.2 Bug fixes: AI Hero instructor routing**
- Option A: Configure instructor routing for AI Hero app
- Option B: Add routing rule to silence/escalate outreach replies (Matt's "quick question" emails)
- **Eliminates 40% of bad responses**

**6.3 Bug fix: `apply-tag`**
- Investigate Front API tag application failures
- Fix or add better error handling/alerting

**6.4 Knowledge Base implementation**
- Highest leverage single change — existing content, zero new infrastructure
- ~95 Q&As ready to ingest
- 3 files to modify in the pipeline
- Transforms agent from blind to informed
- **Projected impact: moves response quality from 47% good to 70%+ good**

**6.5 Fix escalation black hole**
- 0/6 escalated conversations received a human response — all unassigned, untagged, ignored 3-5 days
- Escalations must assign to a person/team in Front, not just add a comment nobody reads
- Add Slack notification for ALL escalations (currently only urgent/instructor)
- Add SLA alerting: if no human response within 24h, re-notify
- **GDPR risk**: account deletion request ignored 5 days. **Revenue risk**: purchase failure ignored 5 days.
- All 6 are AI Hero — instructor routing may not be configured

**6.6 Cross-conversation awareness**
- Add `lookupPriorConversations(email)` to gather step
- Query Front API for recent conversations from same sender
- Include summary in draft context
- Flag if there's an open/escalated conversation about the same topic
- Address: 3 repeat senders in 30d, contradictory responses across conversations
- **Contradicting yourself to the same customer is the worst failure mode**

### P1 — Next (this sprint)

**6.6 Validator overhaul**
- Fix LLM relevance check (currently returns N/A)
- Add ground truth comparison against KB content
- Add audience-awareness check
- Add fabrication detection for specific claims
- Make validation score a real gradient, not binary 1.0/0.0
- Depends on: P0.4 (KB populated provides ground truth)

**6.7 Comment-based corrections (Layer 2)**
- Capture corrections from Front comments
- Store as high-signal memories
- Wire into draft retrieval
- Depends on: KB (baseline to improve upon)

**6.8 Data flow bug fixes**
- `SUPPORT_APPROVAL_REQUESTED` missing `customerEmail`/`inboxId`
- `draft.toolsUsed` dropped at validate boundary
- History `direction` field lost
- User ID dropped at gather boundary
- Register `handleMemoryCitation` in `allWorkflows`

### P2 — Later (next sprint)

**6.9 Dynamic FAQ generation (Layer 3)**
- Auto-detect frequently asked questions from support patterns
- Agent proposes new FAQ entries
- Human approves via Front comment
- KB grows organically

### P3 — Long-term

**6.10 Upstream propagation (Layer 4)**
- Approved FAQs → PRs to product repos (`faq.mdx`/`faq.tsx`)
- Approved FAQs → database updates (`AI_ContentResource`)
- On-site FAQ pages auto-update
- Full closed loop

**6.11 Product registration expansion**
- Register Epic React, Epic Web, Testing Accessibility in support system
- Currently 2 registered (TT, AI Hero); 3+ unregistered with existing FAQ content
- Fixes `appSlug: "unknown"` for unregistered products

---

## 7. Success Metrics

### Response Quality (primary metric)

| Metric | Current | Target (90d) | How measured |
|---|---|---|---|
| % responses rated good/acceptable | 47% (14/30) | 85%+ | Periodic manual audit of 30 random responses |
| % responses rated BAD | 53% (16/30) | <10% | Same audit |
| Meta-commentary leak rate | 47% | 0% | Automated pattern detection |
| Fabrication rate | 10% | <2% | Manual audit + KB-grounded validation |

### Knowledge Base

| Metric | Current | Target (30d) | How measured |
|---|---|---|---|
| KB articles ingested | 0 | 95+ | `kb:index:*` Redis set counts |
| % of questions with relevant KB hit | 0% | 60%+ | `knowledgeCount > 0` in gather logs |
| KB coverage (product count) | 0/5 | 5/5 | Products with ingested FAQ content |

### Validator Effectiveness

| Metric | Current | Target (60d) | How measured |
|---|---|---|---|
| Validation score variance | 0.0 (all 1.0) | σ > 0.15 | Standard deviation of validation scores |
| False positive rate ("valid" for bad draft) | 100% | <15% | Cross-reference validation scores with manual audit |
| Relevance check execution rate | 0% (returns N/A) | 100% | `relevanceCheckPerformed: true` in logs |

### Feedback Loop (longer-term)

| Metric | Current | Target (120d) | How measured |
|---|---|---|---|
| Human corrections stored | 0 | 50+ | Memory store count with `type: correction` |
| Time: question → on-site FAQ | ∞ (manual) | <7 days | Timestamp diff: first ticket → FAQ PR merged |
| Human correction rate | N/A | Decreasing trend | Corrections per week over time |
| Auto-approve accuracy | 47% | 85%+ | % of auto-approved drafts that are actually good |

### Pipeline Health

| Metric | Current | Target | How measured |
|---|---|---|---|
| Pipeline completion rate | 100% | >99% | Inngest function success rate |
| `apply-tag` success rate | 0% | >95% | Axiom `workflow.step.apply-tag` success |
| Avg pipeline latency | 3.4-7.7s | <10s | End-to-end timing from Axiom |
| Daily throughput | ~20 messages | Scale to 100+ | Inngest event counts |

---

## 8. Technical Details

### Infrastructure (all existing, zero new)

| Component | Service | Status | Used for |
|---|---|---|---|
| Upstash Vector | `UPSTASH_VECTOR_REST_URL` | ✅ Provisioned | KB semantic search, memory system |
| Upstash Redis | `UPSTASH_REDIS_REST_URL` | ✅ Provisioned | KB article storage, templates, trust scores |
| Inngest | `support-platform` app | ✅ Running | Event-driven workflow orchestration |
| Front | Helpdesk | ✅ Running | Webhook source, draft creation, comments |
| Axiom | `support-agent` dataset | ✅ Running | Observability, pipeline tracing |
| Slack | Approval channel | ✅ Running | Human approval workflow |

### Content Sources

| Source | Location | Format | Products |
|---|---|---|---|
| Static MDX | `products/apps/total-typescript/src/pages/faq.mdx` | `## Question` headings | Total TypeScript |
| Static TSX | `products/apps/{epic-react,epic-web}/src/pages/faq.tsx` | Embedded markdown in `const` | Epic React, Epic Web |
| PlanetScale DB | `AI_ContentResource` table, slug `faq-2ryr6` | Markdown with `## Question` headings | AI Hero |
| Live site | `testingaccessibility.com/faq` | HTML accordion | Testing Accessibility |
| Front KB | (none exist yet) | HTML articles | Future |

### Registered Products

| Product | App slug | Inbox ID | Status |
|---|---|---|---|
| Total TypeScript | `total-typescript` | `inb_3srbb` | ✅ Active |
| AI Hero | `ai-hero` | `inb_4bj7r` | ✅ Active |
| Epic React | — | — | ❌ Not registered |
| Epic Web | — | — | ❌ Not registered |
| Testing Accessibility | — | — | ❌ Not registered |
| Pro Tailwind | — | — | ❌ Not registered (site 500s) |

### Models

| Use | Model | Notes |
|---|---|---|
| Classification | `anthropic/claude-haiku-4-5` | Via Vercel AI SDK `generateObject()` |
| Draft generation | `anthropic/claude-haiku-4-5` | Via Vercel AI SDK `generateText()` |
| Validation (relevance) | `anthropic/claude-haiku-4-5` | Via Vercel AI SDK `generateObject()` |
| KB embeddings | Upstash built-in | Server-side, pass `data` string instead of vector |
| Tag gardening | `anthropic/claude-haiku-4-5` | Weekly AI analysis for tag consolidation |
| VOC analysis | `anthropic/claude-haiku-4-5` | Sentiment analysis for outreach responses |

### Key Thresholds

| Threshold | Value | Location | Effect |
|---|---|---|---|
| Auto-approve | ≥ 0.8 | `handle-validated-draft.ts` | Draft auto-approved, no human review |
| Low confidence escalation | < 0.5 | Routing rules | Escalate to human |
| Memory retrieval | ≥ 0.6 | Classify, draft | Minimum similarity for memory context |
| Memory corrections | ≥ 0.7 | Gather, validate | Must-gather priority |
| Template match | ≥ 0.9 | `draft.ts` | Use template instead of LLM |
| KB search | ≥ 0.65 | `search.ts` (proposed) | Minimum similarity for KB results |

### Data Volume

| Component | Current | Capacity |
|---|---|---|
| KB articles | 0 → ~95 (planned) | Upstash free tier: 10,000 vectors |
| KB Redis usage | 0 → ~100 KB | Negligible |
| Daily inbound messages | ~20 | No concurrency limits configured |
| Responses generated | ~6/day | Cost: ~$0.01/response (Haiku) |
| Memory entries | ~0 useful | Upstash free tier: 10,000 vectors |

---

## 9. Appendix

### Research Documents

| Document | Path | Summary |
|---|---|---|
| Pipeline Architecture | `support/docs/pipeline-architecture.md` | Full 7-stage pipeline, all events, data flow, known issues |
| FAQ Content Survey | `clawd/memory/faq-source-survey.md` | All 5+ products audited; ~95 Q&As found; zero in KB |
| KB Architecture Design | `clawd/memory/kb-architecture-design.md` | Redis+Vector design; chunk strategy; retrieval flow; implementation plan |
| Forensic Query Toolkit | `clawd/memory/forensic-query-toolkit.md` | Axiom/Inngest queries for pipeline investigation |
| Auto-Approval Audit | `clawd/memory/forensic-auto-approval-audit.md` | 30 responses audited; 53% bad; validator rubber stamp confirmed |
| Repeat Sender Analysis | `clawd/memory/forensic-repeat-senders.md` | 3 repeat senders; zero cross-conversation awareness |
| 24h Pipeline Audit | `clawd/memory/support-agent-audit-24h.md` | 20 events traced; apply-tag 100% failure; 6 auto-sent |
| Response Quality Analysis | `clawd/memory/support-agent-response-quality.md` | 3 deep-dive traces; all drafts blind; validator blind |
| Response Review | `clawd/memory/support-agent-response-review.md` | 10 responses scored; meta-commentary and fabrication identified |
| Conversation Trace | `clawd/memory/trace-cnv_1jdp6oth.md` | Full pipeline walkthrough for team seat issue |
| Infrastructure Map | `clawd/memory/epic1-infrastructure.md` | Webhook → Inngest plumbing; retry/concurrency policies |
| Decision Logic | `clawd/memory/epic1-decision-logic.md` | Classification categories, routing rules, respond path detail |
| Data Flow Audit | `clawd/memory/epic1-data-flow-audit.md` | All 10 event boundaries; data loss at each step |

### Epic & Cell References

| Epic/Cell | ID | Status |
|---|---|---|
| Comment-Based Learning | `cell--al4e8-mku0l2viige` | Existing, needs expansion |
| Pipeline Architecture Map | Epic 1 | ✅ Complete |
| Forensic Inbox Research | Epic 2 | 🔄 In progress |
| KB Architecture Design | Epic 3 | ✅ Design complete, implementation pending |

### Key File Paths

| Component | Path |
|---|---|
| Pipeline steps | `packages/core/src/pipeline/steps/` |
| Inngest workflows | `packages/core/src/inngest/workflows/` |
| Events | `packages/core/src/inngest/events.ts` |
| Pipeline types | `packages/core/src/pipeline/types.ts` |
| Vector client | `packages/core/src/vector/client.ts` |
| Redis client | `packages/core/src/redis/client.ts` |
| Search knowledge (TODO) | `packages/core/src/tools/search-knowledge.ts` |
| App registry | `packages/core/src/services/app-registry` |
| CLI | `packages/cli/` |
| Front webhook | `apps/front/app/api/webhooks/front/route.ts` |
| Slack interactions | `apps/slack/app/api/slack/interactions/route.ts` |

### FAQ File Paths

| Product | Path |
|---|---|
| Total TypeScript | `~/Code/skillrecordings/products/apps/total-typescript/src/pages/faq.mdx` |
| Epic React | `~/Code/skillrecordings/products/apps/epic-react/src/pages/faq.tsx` |
| Epic Web | `~/Code/skillrecordings/products/apps/epic-web/src/pages/faq.tsx` |
| AI Hero | PlanetScale `AI_ContentResource` slug `faq-2ryr6` |
| Testing Accessibility | `https://testingaccessibility.com/faq` (scrape) |
