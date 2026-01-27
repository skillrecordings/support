# Support Agent Feedback Loop — Epic Chain PRD

> **Version:** 2.0
> **Date:** 2026-01-27
> **Owner:** Joel Hooks
> **Status:** Active — supersedes `support-agent-feedback-loop.md`
> **Codebase:** `~/Code/skillrecordings/support`
> **Hive project:** `sr-support`

---

## Executive Summary

### Vision

A closed-loop support system where the agent learns from every interaction. Customer asks → agent drafts (grounded in KB) → human corrects → correction becomes KB entry → KB entry becomes on-site FAQ → fewer customers need to ask. The agent earns autonomy through demonstrated competence, not configuration flags.

### Current State (what's broken, with data)

The support agent processes ~20 inbound messages/day across 2 registered products (Total TypeScript, AI Hero). Classification and routing work well (73% correctly skipped, 7% escalated, 6% responded). Pipeline reliability is excellent — zero blocking errors in 30 days, 100% step completion.

But:

- **53% of auto-approved responses are bad quality** (16/30 audited rated BAD)
- **Validator is a rubber stamp** — 100% of drafts score 1.0, zero issues flagged, LLM relevance check returns N/A
- **Knowledge base is empty** — `searchKnowledge()` is a TODO stub returning `[]`
- **Agent drafts blind** — `hasKnowledge: false`, `hasMemory: false`, `toolsUsed: []` across all responses
- **Meta-commentary leaks to customers** in 47% of responses — "I don't have an instructor configured in the system"
- **0/6 escalated conversations received a human response** — all unassigned, untagged, ignored 3-5 days
- **100% tag failure rate** — `apply-tag` failed 23/23 times in 5 days
- **Zero cross-conversation awareness** — repeat customers start from scratch

The saving grace: all responses become Front drafts, not auto-sends. A human must click "Send." This is the real quality gate.

### The Plan

9 epics forming a dependency chain. Each epic builds on the last, with production pauses between for data gathering and evaluation.

```
Epic 0  ✅  Instrumentation & Baseline
Epic 1A ✅  Safety Net (Quick Wins)
Epic 1.5 ⬜  Data Flow Repair
Epic 2  ⬜  Knowledge Base + RL Loop
Epic 1B ⬜  Escalation & Conversational Interface  (parallel to Epic 2)
Epic 3  ⬜  Validator Overhaul
Epic 3.5 ⬜  Agent Actions
Epic 4  ⬜  Comment-Based Learning
Epic 5  ⬜  Dynamic FAQ & Upstream Propagation
```

**Critical path:** 0 → 1A → 1.5 → 2 → 3 → 3.5 → 4 → 5
**Parallel track:** 1B runs alongside Epic 2

---

## Architecture Overview

### Pipeline Diagram

```
                           ┌──────────────────────────────────────────────────┐
                           │                  FRONT HELPDESK                  │
                           └────────────────────┬─────────────────────────────┘
                                                │ POST webhook (preview only)
                                                ▼
                           ┌──────────────────────────────────────────────────┐
                           │           Webhook Handler (HMAC verify)          │
                           │   apps/front/app/api/webhooks/front/route.ts    │
                           └────────────────────┬─────────────────────────────┘
                                                │ inngest.send()
                                                ▼
                                   SUPPORT_INBOUND_RECEIVED
                                                │
                                                ▼
                           ┌──────────────────────────────────────────────────┐
                           │              ① CLASSIFY (LLM)                   │
                           │     Fast-path regex → LLM fallback              │
                           │     13 signals, 17 categories                   │
                           └────────────────────┬─────────────────────────────┘
                                                │ SUPPORT_CLASSIFIED
                                                ▼
                           ┌──────────────────────────────────────────────────┐
                           │         ② ROUTE (deterministic rules)           │
                           │     First-match rule engine, no LLM             │
                           └──────┬─────────────┼────────────────┬────────────┘
                                  │             │                │
                          action=respond   action=silence   action=escalate_*
                                  │             │                │
                                  ▼             ▼                ▼
                          SUPPORT_ROUTED    Archive +      SUPPORT_ESCALATED
                                  │         comment             │
                                  ▼        (terminal)           ▼
                           ┌──────────────┐              HANDLE ESCALATION
                           │ ③ GATHER     │              (comment + tag +
                           │  - lookupUser│               Slack)
                           │  - purchases │              (terminal)
                           │  - knowledge │
                           │  - history   │
                           │  - memory    │
                           └──────┬───────┘
                                  │ SUPPORT_CONTEXT_GATHERED
                                  ▼
                           ┌──────────────┐
                           │ ④ DRAFT(LLM) │
                           │ claude-haiku  │
                           └──────┬───────┘
                                  │ SUPPORT_DRAFT_CREATED
                                  ▼
                           ┌──────────────┐
                           │ ⑤ VALIDATE   │
                           │ patterns+LLM │
                           └──────┬───────┘
                                  │ SUPPORT_DRAFT_VALIDATED
                                  ▼
                           ┌──────────────┐
                           │ ⑥ APPROVE    │
                           │ score ≥ 0.8  │
                           └──────┬───────┘
                         ┌────────┴────────┐
                    auto-approve      human review
                         │            (Slack, 24h)
                         ▼                 │
                   ┌──────────────┐        │
                   │ ⑦ EXECUTE    │◄───────┘
                   │ Front draft  │
                   │ (NOT send)   │
                   └──────────────┘
```

### Key Components

| Component | Service | Status |
|-----------|---------|--------|
| Orchestration | Inngest (`support-platform`, 21 functions, 5 crons) | ✅ Running |
| Helpdesk | Front (webhooks, drafts, comments, tags) | ✅ Running |
| LLM | `anthropic/claude-haiku-4-5` (classify, draft, validate) | ✅ Running |
| Vector Store | Upstash Vector (KB search, memory) | ✅ Provisioned, KB empty |
| Key-Value | Upstash Redis (article store, templates, trust) | ✅ Provisioned |
| Observability | Axiom (`support-agent` dataset) | ✅ Running |
| Approvals | Slack (buttons, notifications) | ✅ Running |

### Registered Products

| Product | App slug | Inbox ID | Status |
|---------|----------|----------|--------|
| Total TypeScript | `total-typescript` | `inb_3srbb` | ✅ Active |
| AI Hero | `ai-hero` | `inb_4bj7r` | ✅ Active |
| Epic React | — | — | ❌ Not registered |
| Epic Web | — | — | ❌ Not registered |
| Testing Accessibility | — | — | ❌ Not registered |

---

## The Feedback Loop

Five layers, each building on the last:

### Layer 0: Instrumentation
**Epic 0** — Measure everything before fixing anything. Agent-queryable Axiom telemetry, forensic query toolkit, baseline metrics. The foundation.

### Layer 1: Safety Net + Data Flow
**Epics 1A + 1.5** — Stop the bleeding. Meta-commentary detection, classification tuning, Slack notifications for all escalations, cross-conversation awareness. Fix 8 data flow bugs that compound across later epics.

### Layer 2: Knowledge + RL Loop
**Epics 2 + 1B** — The biggest shift. Populate KB with ~95 existing FAQ articles. Wire up `searchKnowledge`. Build the RL loop (draft→sent/edited/deleted tracking). Full escalation ladder. Agent stops flying blind.

### Layer 3: Validator + Actions
**Epics 3 + 3.5** — Make validation meaningful. Ground truth comparison against KB. Four-tier response system (auto-send / draft / escalate / draft-neglect-escalate). Give the agent the ability to DO things — magic links, refunds, transfers.

### Layer 4: Learning from Corrections
**Epic 4** — Human corrections via Front comments become high-signal memories. Every correction is worth 10x a "sent unchanged" signal. Memory-augmented drafting improves over time.

### Layer 5: Dynamic FAQ + Upstream Propagation
**Epic 5** — The full closed loop. Auto-detect frequently asked questions. Propose new FAQ entries. Approved FAQs propagate upstream as PRs to product repos. Customers find answers before they email. Fewer tickets.

---

## Epic Chain

### Epic 0: Instrumentation & Baseline ✅ DONE

**Cell:** `cell--al4e8-mkvzpg31otu`
**Status:** Closed
**PR:** #9

#### What shipped

- Comprehensive agent-queryable Axiom logging at every pipeline step
- Forensic query toolkit for agent-driven investigation
- Baseline metrics snapshot (see below)
- Eval framework integrated from day one
- Pipeline architecture documentation (`docs/pipeline-architecture.md`)

#### Baseline Metrics Captured (5-day window, Jan 22–27)

| Metric | Value |
|--------|-------|
| Total events | 3,589 |
| Classifications | 130 (17 categories active) |
| Auto-approval rate | **100%** (11/11) |
| Validation pass rate | **100%** (11/11, all score 1.0) |
| Tag success rate | **0%** (0/23) |
| Escalation rate | 7% (7/100 routing decisions) |
| Skip rate | 73% (73/100) |
| Response-ready rate | 6% (6/100) |
| Pipeline errors | 31 (all "inngest refresh failed") |
| Memory retrieval results | 0 (108 queries, all empty) |
| Avg draft length | 357 chars (AI Hero), 347 chars (TT) |
| Avg classification time | 929ms–3,297ms (varies by category) |
| Avg draft creation time | ~1,000ms |

#### Key Findings

1. **Validator is binary, not gradient** — every draft scores exactly 1.0. Zero variance. The scoring system is pass/fail, not a quality spectrum.
2. **LLM relevance check dead** — returns N/A for all drafts. Body assertion likely failing silently.
3. **Memory system empty** — 108 retrievals, 0 results. Vector store has no useful data.
4. **Tag application broken** — 23/23 failures. Logs say "tag applied" but `tagged=false`. Likely a permissions/config issue.
5. **Only 5 days of Axiom data** — despite querying 30 days, suggesting recent deployment or retention limits.
6. **AI Hero dominates** — 57% of classifications (74/130), all 32 approval requests.

#### Forensic Audit Results (30 responses)

| Rating | Count | % |
|--------|-------|---|
| ✅ GOOD | 5 | 17% |
| ⚠️ ACCEPTABLE | 9 | 30% |
| 🔴 BAD | 16 | 53% |

**Failure modes:**
- Meta-commentary / system internals exposed: **47%**
- Should have been silenced/escalated: **47%**
- Misdirected (internal note as customer response): **40%**
- Possible fabrication: **10%**
- Ignored context (attachments, thread history): **7%**

**By app:** Total TypeScript 67% good/acceptable, AI Hero only 33% — AI Hero is worse because it receives more fan mail replies and the agent botches instructor routing.

#### Escalation Black Hole

**0/6 escalated conversations received a human response.** All 6 were AI Hero, all workshop-related. Unassigned, untagged, unanswered 3-5 days. Includes an account deletion request (GDPR risk) and a purchase failure (revenue loss).

Root cause: escalation route doesn't assign to a person or team, `apply-tag` 100% failure rate means no Front rules trigger, and only urgent/instructor priorities get Slack notifications.

#### Design Implications Established

- Observability is agent-first: structured Axiom logs, forensic query toolkit
- Evals threaded through every epic, not bolted on
- Each production pause = live eval run executed by agents
- Auto-send threshold must be extremely high — default to draft
- Never surface routine support to instructors (prime directive)

---

### Epic 1A: Safety Net (Quick Wins) ✅ DONE

**Cell:** `cell--al4e8-mkvzpmas7yt`
**Status:** Complete — all 5 tasks shipped, pending review & merge
**Depends on:** Epic 0

#### Scope (1 week)

| Task | Status | Impact |
|------|--------|--------|
| Meta-commentary detection in validator | ✅ Done | META patterns 11→27, LEAK patterns 12→23, 106 tests |
| Classification tuning (fan mail over-classified) | ✅ Done | Removed regex fast-path, tightened LLM prompt, 4 new few-shot examples |
| Slack notifications for ALL escalations | ✅ Done | All priorities notify, body + signals in notification |
| Cross-conversation awareness | ✅ Done | Front API lookup, 90-day window, VIP detection |
| LLM relevance check debugging | ✅ Done | Root cause: customerMessage never passed to validate() |

#### What shipped

**Meta-commentary detection:** Expanded validator pattern checks to catch actual phrases the agent uses:
- "I don't have .* configured"
- "I can't route this"
- "no instructor configured"
- "through whatever internal process"
- "system" in self-referential context
- "Per my guidelines"

**Classification tuning:** Fan mail is over-classified — most "fan mail" is real presales/support. Updated LLM prompt + few-shot examples. Only surface genuinely interesting/juicy stuff to instructors. Matt IS configured for AI Hero (the classification is wrong, not the routing config).

**Slack for all escalations:** Previously only urgent/instructor priorities got Slack notifications. Now all escalations notify. Fixes the black hole where 0/6 escalated conversations got human responses.

**Cross-conversation awareness:** `lookupPriorConversations(email)` in gather step. 90-day window via Front API `contacts.listConversations()`. Excludes current conversation, caps at 10 results. Multi-product VIP detection. Prior conversations passed to draft LLM for context. Addresses: repeat senders getting contradictory responses.

**LLM relevance check fix:** Root cause — both `runPipeline()` and `runThreadPipeline()` called `validate()` without passing `customerMessage`. The field was optional, so it defaulted to `undefined`, and the relevance check guard always short-circuited. The relevance check literally never ran once in production. Fixed by passing subject+body from the pipeline input. Added explicit logging for why relevance check was skipped.

#### NOT in scope (moved to other epics)

- Full escalation ladder → Epic 1B
- Conversational Slack/Front interface → Epic 1B
- Data flow bug fixes → Epic 1.5

#### Prerequisites (all answered ✅)

1. **Escalation channel?** — Existing approvals Slack channel. All products for now.
2. **Escalation style?** — Conversational, not command-driven. Agent talks through Slack threads, Front comments, SMS replies. Not slash commands.
3. **SLA?** — Tiered urgency ladder, configurable and schedulable per priority.
4. **Fan mail?** — Fix over-classification. Matt IS configured for AI Hero. Prime directive: shield client, surface only gold.
5. **Support staffing?** — Human support person in Front every weekday. Escalation is a tooling problem, not a staffing problem.

#### Production Pause

48-72h — re-run 30-response audit, measure improvement vs baseline.

#### Worker Instructions

- Store learnings in hivemind: `hivemind_store` with tags `sr-support,epic1a,{topic}`
- Close cell when done: `hive_close` with summary
- Type-check: `npx tsc --noEmit` in support repo
- Run relevant tests

---

### Epic 1.5: Data Flow Repair ⬜

**Cell:** `cell--al4e8-mkw18eleezr`
**Status:** Open
**Depends on:** Epic 0 + Epic 1A pause data

#### The Problem

8 data flow bugs identified in the pipeline audit. These are infrastructure issues that compound across later epics — if the KB can't get correct data flowing through the pipeline, it won't work.

#### Scope (3-5 days)

| Bug | Location | Impact |
|-----|----------|--------|
| `SUPPORT_APPROVAL_REQUESTED` missing `customerEmail`/`inboxId` | `handle-validated-draft.ts` | Slack shows `undefined` for customer email |
| `draft.toolsUsed` dropped at validate boundary | `validate-draft.ts` | Audit trail of agent tools lost |
| History `direction` field lost | `gather-context.ts` → `draft-response.ts` | Fragile email comparison reconstruction |
| User ID dropped at gather boundary | `gather-context.ts` | `user.id` set to email, tool execution may need real ID |
| `handleMemoryCitation` not registered | `workflows/index.ts` | Citation tracking is dead code |
| `SUPPORT_CONVERSATION_RESOLVED` no emitter | Events system | `index-conversation` can never trigger |
| Dead letter queue is a no-op | `dead-letter.ts` | `withDeadLetter()` returns `fn` as-is |
| Internal note vs customer response modes | Pipeline-wide | Prevents meta-commentary at source |

#### Prerequisites

1. Any of these bugs causing visible customer impact right now? (prioritize those)

#### Outputs

- All 8 data flow bugs resolved
- Clean data pipeline for Epic 2 KB implementation
- Internal note vs customer response separation

#### No Production Pause

Infrastructure fixes — verify with tests and existing Axiom data. Can overlap with Epic 1A pause analysis period.

#### Worker Instructions

- Tags: `sr-support,epic1.5,{topic}`
- Reference: `memory/epic1-data-flow-audit.md`, `memory/epic1-infrastructure.md`

---

### Epic 2: Knowledge Base + RL Loop ⬜

**Cell:** `cell--al4e8-mkvzpu8zhse`
**Status:** Open
**Depends on:** Epic 1A + Epic 1.5

This is the biggest and most important epic. Two major deliverables: populate the empty KB, and build the RL loop foundation that Epics 3-5 depend on.

#### Knowledge Base

**The problem:** `searchKnowledge()` is a TODO stub. Every response is generated with `hasKnowledge: false`. The agent operates on pure LLM instinct.

**The fix:** Ingest ~95 existing FAQ Q&As into Upstash Vector + Redis. Wire up the gather step. Zero new infrastructure — both Upstash Vector and Redis are already provisioned.

| Source | Q&As | Format | Access |
|--------|------|--------|--------|
| Total TypeScript | 19 | MDX static file | Parse `faq.mdx` |
| Epic React | 22 | TSX embedded markdown | Parse `faq.tsx` |
| Epic Web | 23 | TSX embedded markdown | Parse `faq.tsx` |
| AI Hero | 15 | PlanetScale DB (`AI_ContentResource`) | API endpoint |
| Testing Accessibility | 16 | Live site HTML | Web scrape |
| Shared (cross-product) | ~7 (deduped) | Common boilerplate | Extract once |
| **Total** | **~95** | | **~102 vector chunks** |

**Architecture:** Two-stage retrieval:
1. Upstash Vector semantic search (namespace: `knowledge`, topK=8, minScore=0.65, filtered by `appId`)
2. Redis Hash lookup for full article content (top 3 unique articles)

Chunk strategy: one chunk per Q&A pair (natural boundaries). Format: `"Q: {question}\nA: {answer}"`.

**KB files to create:**
```
packages/core/src/knowledge/
  ├── search.ts          # searchKnowledge() implementation
  ├── ingest.ts          # Article parsing, chunking, upserting
  ├── types.ts           # KBArticle, KBChunk, SyncResult
  └── parsers/
      ├── markdown.ts    # Parse MDX/TSX FAQ format
      └── front-kb.ts    # Parse Front KB articles (future)

packages/cli/src/commands/
  └── kb-sync.ts         # CLI: bun run kb:sync
```

**KB files to modify:**
```
packages/core/src/inngest/workflows/gather-context.ts  # Wire searchKnowledge
packages/core/src/tools/search-knowledge.ts            # Replace stub
packages/core/src/agent/config.ts                      # Update tool config
```

**Design reference:** `memory/kb-architecture-design.md`

#### 🧑 HUMAN STEP: Register New Product Inboxes

Joel registers Epic React, Epic Web, Testing Accessibility using the wizard:
```bash
cd ~/Code/skillrecordings/support/packages/cli
bun src/index.ts wizard
```

#### Cross-Conversation Awareness

- `lookupPriorConversations(email)` — 90 days, relevance-weighted
- Cross-product customer profile: products owned, contact history
- VIP detection: multi-product buyers flagged for extra attention

#### RL Loop Foundation (P0 — load-bearing for Epics 3, 4, 5)

The mechanism that makes auto-send "earned." Oracle said: "Clicker-train the agent into perfection."

- **Draft tracking:** Tag each draft with unique ID (hidden HTML comment in Front draft body)
- **Outbound matching:** Match Front outbound events back to agent drafts via that ID
- **Edit detection:** Compare sent message to original draft (fuzzy matching — how much edit = "correction" vs "minor tweak")
- **Deletion detection:** No matching outbound within time window = deleted draft
- **Per-category confidence scores** from sent/edited/deleted ratios
- **Cold start:** No auto-send until minimum volume threshold met per category
- **All signals logged to Axiom**

This is the FOUNDATION. Without it:
- Epic 3 can't set category-specific auto-send thresholds
- Epic 4's correction detection is weakened (can't see edits, only comments)
- Epic 5 can't measure which KB articles lead to good outcomes

#### New FAQ Articles

The KB question harvest found that the top 3 question categories have ZERO FAQ coverage:
1. **Account access troubleshooting** (8 instances — highest volume)
2. **Workshop logistics** (6 instances — AI Hero specific)
3. **How to transfer a purchase** (4 instances)

These need to be written as part of this epic — ingesting existing content isn't enough.

#### Prerequisites

| # | Question | Answer |
|---|----------|--------|
| 1 | Auto-send? | **Drafts only. Clicker-train into perfection. Auto-send is EARNED.** |
| 2 | Retrieval threshold? | **Strict. Only relevant results. No garbage padding.** |
| 3 | Shared FAQs? | **Yes, shared KB with per-product variable substitution. Canned responses will be clutch.** |
| 4 | Cross-conversation lookups? | **90 days, relevance-weighted, cross-product. Multi-product buyers are VIPs.** |
| 5 | Who writes new FAQ articles for gaps? | ⬜ **UNANSWERED** |
| 6 | How do you correct a draft in Front? | ⬜ **UNANSWERED** (critical for RL loop) |
| 7 | Minimum volume per category before auto-send? | ⬜ **UNANSWERED** |

#### Scope (2 weeks)

- Ingest ~95 FAQ Q&As into Upstash Vector + Redis
- Per-product variable substitution (support email, product name, URLs)
- Wire `searchKnowledge` in gather-context.ts with strict similarity threshold
- KB sync CLI (`bun run kb:sync`) + Inngest daily cron later
- Write new FAQ articles for top gaps
- Cross-conversation awareness (90-day, relevance-weighted)
- RL loop: draft tracking, outbound matching, edit/deletion detection
- Per-category confidence scores from sent/edited/deleted ratios

#### Production Pause

1 week — measure knowledge hit rate, draft quality improvement, RL signal accumulation.

#### Worker Instructions

- Tags: `sr-support,epic2,{topic}`
- Reference: `memory/kb-architecture-design.md`, `memory/faq-source-survey.md`, `memory/kb-question-harvest.md`

---

### Epic 1B: Escalation & Conversational Interface ⬜

**Cell:** `cell--al4e8-mkw18tjr0p0`
**Status:** Open
**Depends on:** Epic 1A (basic Slack notifications working)
**Runs parallel to:** Epic 2

#### The Problem

The escalation ladder ("everything has a clock, nothing sits forever") requires significant infrastructure that doesn't belong in a "quick wins" epic. The Oracle described a tiered system: Slack → reminder → DM → SMS with time-based escalation.

Additionally, the agent should be conversational, not command-driven. "Should be able to respond with 'agent do X' and get stuff actually done."

#### Scope (2-3 weeks)

**Escalation Ladder:**
- Configurable tiered urgency: Slack thread → reminder (4h) → DM (24h) → SMS (48h)
- Time thresholds configurable per priority level and schedulable (weekday vs weekend)
- Per-conversation state tracking (state machine)
- De-escalation: human responds → cancel remaining escalation steps
- Draft neglect detection: draft sits unsent too long → escalation ladder kicks in

**Conversational Interface:**
- Agent responds conversationally in Slack threads
- Agent responds conversationally in Front comments
- SMS replies route back to agent
- Natural language intent parsing (not slash commands)
- Confirmation flow for irreversible actions
- Thread context awareness

#### Prerequisites (unanswered)

1. Who specifically receives DMs and SMS when escalation climbs the ladder?
2. What are the first 3 things you'd want to tell the agent conversationally?
3. SMS provider preference?

#### Production Pause

48-72h — measure escalation pickup rates, response times, conversational interaction quality.

#### Worker Instructions

- Tags: `sr-support,epic1b,{topic}`
- Reference: `memory/forensic-escalation-trace.md`, `memory/oracle-session-2026-01-27.md`

---

### Epic 3: Validator Overhaul ⬜

**Cell:** `cell--al4e8-mkvzq2ivtz0`
**Status:** Open
**Depends on:** Epic 2 (KB provides ground truth) + Epic 2 pause data

#### The Problem

The validator is a rubber stamp. 100% of drafts score 1.0. Zero issues flagged. The LLM relevance check returns N/A for every draft. Pattern checks are too narrow and miss actual meta-commentary. The auto-approve threshold (0.8) is meaningless when everything scores 1.0.

#### What Changes

**Four-tier response system** (from Oracle session):
1. **Auto-send** — Earned via RL loop per-category. Only when 95%+ "sent unchanged" rate at volume.
2. **Draft** — Default. Human clicks "Send" in Front.
3. **Escalate** — High stakes: large team sales, bug patterns, frustrated customers.
4. **Draft-neglect-escalate** — Draft sat too long, nobody acted, climbs the ladder.

**Validator improvements:**
- Fix LLM relevance check (root cause: body assertion failing)
- Ground truth comparison against KB content (available from Epic 2)
- Audience-awareness check: "would a customer understand this?"
- Fabrication detection for specific claims (prices, dates, timelines, availability) without source data
- Escalate-on-tool-failure: when `lookupUser`/`getPurchases` fails, don't ask the customer for info the system should have
- Make score a real gradient (0.0–1.0), not binary pass/fail
- Category-specific thresholds tied to the three nightmares

**The three nightmares** (from Oracle session):
1. Large team sales fumbled — $5k+ deal gets a generic FAQ response
2. Bug patterns missed — multiple people reporting same issue, agent treats each as isolated
3. Neglect → client DMs — customer gives up on support, goes directly to instructor

#### Prerequisites (all answered ✅)

1. **Category-specific bars?** — Yes. Highest scrutiny for large team sales, bug patterns, neglected people reaching client DMs.
2. **Tiered response handling?** — Four tiers: auto-send (earned), draft (default), escalate (high stakes), draft-neglect-escalate.
3. **On validation failure?** — Low confidence draft with request for correction. Bad draft = teaching moment.

#### Production Pause

48-72h — measure validator accuracy per category, correction request rate.

#### Worker Instructions

- Tags: `sr-support,epic3,{topic}`
- Reference: `memory/forensic-auto-approval-audit.md`, `memory/epic1-data-flow-audit.md`

---

### Epic 3.5: Agent Actions ⬜

**Cell:** `cell--al4e8-mkw197h0u2l`
**Status:** Open
**Depends on:** Epic 3 (validator determines when to act vs escalate) + Epic 1B (conversational interface for approval)

#### The Problem

The agent can only draft words. It can't DO anything. The Oracle said: "Future: agent takes actions — Stripe quotes, invoice generation, magic links, transfers." Support is most powerful when the agent can resolve the issue end-to-end, not just describe what needs to happen.

#### Actions (priority order)

1. **Generate magic login link** — Most common support issue (account access). Low risk, high frequency.
2. **Resend access email** — Close second. "I can't access my course."
3. **Process refund** — Clear policy, but needs approval threshold (dollar amount).
4. **Transfer license** — Common request, currently manual.
5. **Generate custom invoice** — B2B requests, VAT customization.
6. **Create Stripe quote** — Team/enterprise sales. High value.

#### Scope (1-2 weeks)

- Tool definitions for each action (Stripe API, Front API, integration SDKs)
- Authorization model with configurable thresholds (which actions autonomous vs approval-required)
- Action logging and audit trail in Axiom
- Conversational confirmation before irreversible actions (via Epic 1B interface)
- Error handling and rollback

#### Prerequisites (unanswered)

1. Which actions autonomous vs require human approval?
2. Dollar thresholds for refunds?
3. Current Stripe capabilities already wired?
4. License transfer manual process to automate?

#### Production Pause

1 week — measure action success rates, approval patterns.

#### Worker Instructions

- Tags: `sr-support,epic3.5,{topic}`
- Reference: `memory/oracle-session-2026-01-27.md`

---

### Epic 4: Comment-Based Learning ⬜

**Cell:** `cell--al4e8-mkvzqb2gzjx`
**Status:** Open
**Depends on:** Epic 3 (validator + four-tier system) + Epic 2 RL loop (edit detection) + Epic 1B (conversational interface)

#### The Problem

The agent learns nothing from corrections. When a human edits a draft, adds a comment, or rewrites a response — that signal is lost. The memory system exists (SupportMemoryService, vector store, voting) but has zero useful data.

Oracle: "Every correction is worth 10x a 'sent unchanged' signal."

#### Scope (2 weeks)

**Correction Detection:**
- Draft edits: compare sent message to original draft (using RL loop from Epic 2)
- Comment corrections: Front comment events parsed for correction intent
- Slack thread corrections: responses in approval thread
- Distinguish: correction vs. internal discussion vs. command to agent

**Memory System:**
- High-signal memory storage (corrections weighted 10x over regular signals)
- Per-category and per-product scoping
- Memory decay policy (old corrections fade unless validated)

**Draft Improvement:**
- Memory-augmented drafting: retrieve corrections before generating
- Correction → KB entry pipeline (when a correction becomes FAQ-worthy)
- Proactive correction requests for low-confidence drafts ("I'm not confident — help me fix this")

#### Prerequisites (unanswered — blocked on Oracle)

1. How do you physically correct a draft in Front? Edit and send? Delete and rewrite? Comment?
2. Who is correcting? Authority levels?
3. Per-product or global corrections?
4. Conflicting corrections resolution?
5. Memory decay policy?

#### Production Pause

2 weeks — need correction volume to accumulate.

#### Worker Instructions

- Tags: `sr-support,epic4,{topic}`
- Reference: `memory/kb-architecture-design.md`, `memory/oracle-session-2026-01-27.md`

---

### Epic 5: Dynamic FAQ & Upstream Propagation ⬜

**Cell:** `cell--al4e8-mkvzqkyjss0`
**Status:** Open
**Depends on:** Epic 4 (correction patterns provide data) + Epic 3.5 (agent actions enable propagation)

#### The Vision

The capstone. The full closed loop:

```
Customer asks question
    → Agent drafts response (grounded in KB)
        → Human corrects if needed
            → Pattern detected: same question 3+ times with approved answers
                → Agent proposes new FAQ entry conversationally
                    → Human approves
                        → FAQ propagates upstream:
                            → PR to product repo (faq.mdx / faq.tsx)
                            → API call to PlanetScale (AI Hero)
                        → On-site FAQ auto-updates
                            → Fewer customers need to ask
```

#### Scope (ongoing)

**Dynamic FAQ Detection (Layer 3):**
- Semantic clustering of inbound messages to find patterns
- Frequency threshold (configurable — 3? 5?)
- Time window for pattern detection
- Conversational proposal: agent proposes new FAQ in Slack/Front, human reviews

**Upstream Propagation (Layer 4):**
- PRs to product repos (`faq.mdx`, `faq.tsx`)
- API calls to PlanetScale for AI Hero (`AI_ContentResource`)
- Per-product formatting (MDX vs TSX vs DB markdown)
- Rollback mechanism if FAQ is wrong

**Content Lifecycle:**
- Deflection measurement: FAQ page analytics + support volume correlation
- Staleness detection: when corrections contradict an FAQ, flag for update
- Retirement workflow: when FAQ is outdated, propose removal/update

#### Prerequisites (unanswered — blocked on Oracle)

1. Threshold for "frequently asked"? 3? 5?
2. Who approves new FAQs?
3. Upstream: PRs (reviewable) or direct DB writes?
4. Notification channel for proposed FAQs?
5. Review before going live? Legal/brand?
6. Content ownership per product? (Joel for all, or per-instructor?)

#### No Production Pause

This is the mature state. The loop runs itself.

#### Worker Instructions

- Tags: `sr-support,epic5,{topic}`
- Reference: `memory/faq-source-survey.md`, `memory/kb-question-harvest.md`

---

## Dependency Chain

### Visual Chain

```
                    ┌──────────────────┐
                    │  Epic 0 ✅       │
                    │  Instrumentation │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Epic 1A 🔄      │
                    │  Safety Net      │
                    └────────┬─────────┘
                             │
                ┌────────────┼────────────┐
                │                         │
       ┌────────▼─────────┐     ┌────────▼─────────┐
       │  Epic 1.5 ⬜     │     │  Epic 1B ⬜      │
       │  Data Flow       │     │  Escalation      │
       └────────┬─────────┘     └────────┬─────────┘
                │                         │
       ┌────────▼─────────┐              │
       │  Epic 2 ⬜       │◄─────────────┘
       │  KB + RL Loop    │    (1B runs parallel,
       └────────┬─────────┘     2 uses its output)
                │
       ┌────────▼─────────┐
       │  Epic 3 ⬜       │
       │  Validator       │
       └────────┬─────────┘
                │
       ┌────────▼─────────┐
       │  Epic 3.5 ⬜     │
       │  Agent Actions   │
       └────────┬─────────┘
                │
       ┌────────▼─────────┐
       │  Epic 4 ⬜       │
       │  Comment Learning│
       └────────┬─────────┘
                │
       ┌────────▼─────────┐
       │  Epic 5 ⬜       │
       │  Dynamic FAQ     │
       └──────────────────┘
```

### Critical Path

The critical path is the longest sequential chain:

```
Epic 0 (3-5d + 72h pause)
  → Epic 1A (1w + 48-72h pause)
    → Epic 1.5 (3-5d, overlaps with 1A pause)
      → Epic 2 (2w + 1w pause)
        → Epic 3 (1-2w + 48-72h pause)
          → Epic 3.5 (1-2w + 1w pause)
            → Epic 4 (2w + 2w pause)
              → Epic 5 (ongoing)
```

**Estimated wall-clock time to Epic 5:** ~14-16 weeks (including pauses)

### Parallelization Opportunities

1. **Epic 1B runs parallel to Epic 2.** The escalation ladder and conversational interface don't depend on the KB — they depend on Epic 1A's basic Slack notifications.

2. **Epic 1.5 overlaps with Epic 1A pause.** Data flow fixes can happen while the safety net improvements are being evaluated in production.

3. **New FAQ articles (Epic 2) can be written while KB infrastructure is built.** Content creation is parallel to code.

4. **Product registration is a human step** that can happen any time before Epic 2 sync.

---

## Design Principles

From the Oracle session (2026-01-27), these are the non-negotiable principles:

### 1. Drafts Only — Auto-Send is Earned

Auto-send is not a config flag. It's an earned privilege via the RL loop. Track: draft sent unchanged (positive), edited (correction, 10x value), deleted (negative). Per-category confidence scores built from actual human decisions. Graduate to auto-send only when a category has 95%+ "sent unchanged" rate at volume.

### 2. Corrections Are Gold

Every correction is worth 10x a "sent unchanged" signal. Bad drafts are teaching moments, not failures. Low confidence → draft + request for correction/chat to fix and approve. Human correction feeds directly into memory system.

### 3. Everything Has a Clock

Nothing sits forever. Tiered urgency ladder: Slack → reminder → DM → SMS. Escalating based on nature of request AND time elapsed. Draft neglect detection: if a draft sits unsent, escalate.

### 4. Conversational, Not Command-Driven

The agent talks through Slack threads, Front comments, SMS replies. Not slash commands or buttons (beyond the initial approve/reject). "Agent do X" in a Slack thread and it executes. Natural language, thread-context-aware.

### 5. Agent-First Observability

Don't build human dashboards at this volume. Design telemetry for agents — structured Axiom logs that coding agents can query during development, self-diagnose, and use to make decisions. The forensic query toolkit IS the interface.

### 6. Shield Instructors from Drudgery

The prime directive. Skill Recordings exists to shield instructors from the grind of day-to-day support and surface only interesting conversations and opportunities. Escalation path: agent → SR team → (interesting stuff only) → instructor. Fan mail is over-classified — most is real presales/support.

### 7. No Fabrication, No Glazing

Accuracy first, thorough, don't waste the user's time. Leave them heard and helped. No glazing or fabricated LLM bullshit — glazing is worse than being terse. Go the extra mile, own mistakes if dropped the ball. But not a pushover — entitled behavior gets the boundary.

### 8. Not a Turkish Bazaar

No haggling on discounts. PPP exists, that's it, unless large team deals. Generous by default, but not groveling.

---

## Open Questions

### Blocking Epic 2

| Question | Context |
|----------|---------|
| Who writes new FAQ articles for the top gaps (account access, workshop logistics, transfers)? | Agent drafts from resolved conversations, human approves? Or Joel writes them? |
| How do you physically correct a draft in Front? | Edit in-place and send? Delete and rewrite from scratch? Add a comment? Critical for RL loop design. |
| Minimum volume per category before trusting auto-send? | 50 unchanged sends? 100? What's the cold-start policy? |

### Blocking Epic 1B

| Question | Context |
|----------|---------|
| Who receives DMs and SMS when escalation climbs? | Just Joel? Multiple people? Rotating? |
| First 3 conversational commands? | "Send this draft"? "Assign to person"? "Refund this customer"? |
| SMS provider preference? | Twilio? Other? |

### Blocking Epic 3.5

| Question | Context |
|----------|---------|
| Which actions autonomous vs human-approved? | Magic links autonomous? Refunds need approval? |
| Dollar thresholds for refunds? | Below $X = auto, above = human? |
| License transfer current manual process? | What steps does a human do today? |

### Blocking Epic 4

| Question | Context |
|----------|---------|
| How do you physically correct a draft in Front? | Same as Epic 2 question — critical for detection logic |
| Who is correcting? Authority levels? | Just Joel? Team? Different authority per person? |
| Per-product or global corrections? | PPP correction for TT — should it help AI Hero too? |
| Conflicting corrections? | Two people give opposite corrections — who wins? |
| Memory decay? | Do old corrections fade or persist forever? |

### Blocking Epic 5

| Question | Context |
|----------|---------|
| Threshold for "frequently asked"? | 3 times? 5? |
| Who approves new FAQs? | Joel? Per-product instructor? |
| Upstream: PRs or direct DB writes? | PRs are reviewable, DB writes are faster |
| Who owns FAQ content per product? | Joel for all? Kent for Epic React? Matt for AI Hero? |
| Legal/brand review before publish? | Auto-generated content going to customer-facing pages |

---

## Appendix

### Key Files and Their Roles

| Component | Path |
|-----------|------|
| Pipeline steps | `packages/core/src/pipeline/steps/` |
| Inngest workflows | `packages/core/src/inngest/workflows/` |
| Event definitions | `packages/core/src/inngest/events.ts` |
| Pipeline types | `packages/core/src/pipeline/types.ts` |
| Vector client | `packages/core/src/vector/client.ts` |
| Redis client | `packages/core/src/redis/client.ts` |
| Search knowledge (stub) | `packages/core/src/tools/search-knowledge.ts` |
| App registry | `packages/core/src/services/app-registry` |
| CLI | `packages/cli/` |
| Front webhook | `apps/front/app/api/webhooks/front/route.ts` |
| Slack interactions | `apps/slack/app/api/slack/interactions/route.ts` |
| Dead letter queue | `packages/core/src/inngest/dead-letter.ts` |

### FAQ Source Paths

| Product | Path |
|---------|------|
| Total TypeScript | `~/Code/skillrecordings/products/apps/total-typescript/src/pages/faq.mdx` |
| Epic React | `~/Code/skillrecordings/products/apps/epic-react/src/pages/faq.tsx` |
| Epic Web | `~/Code/skillrecordings/products/apps/epic-web/src/pages/faq.tsx` |
| AI Hero | PlanetScale `AI_ContentResource` slug `faq-2ryr6` |
| Testing Accessibility | `https://testingaccessibility.com/faq` (scrape) |

### Memory Files Reference

| Document | Path | Content |
|----------|------|---------|
| Oracle session | `clawd/memory/oracle-session-2026-01-27.md` | Design decisions, business context, philosophy |
| Epic chain review | `clawd/memory/epic-chain-review.md` | Strategic review of all 6 original epics |
| Baseline metrics | `clawd/memory/baseline-metrics-2026-01-27.md` | 5-day Axiom snapshot |
| Auto-approval audit | `clawd/memory/forensic-auto-approval-audit.md` | 30 responses audited |
| Escalation trace | `clawd/memory/forensic-escalation-trace.md` | 0/6 escalations got human response |
| Repeat senders | `clawd/memory/forensic-repeat-senders.md` | Cross-conversation blindness |
| KB architecture | `clawd/memory/kb-architecture-design.md` | Redis+Vector design |
| KB question harvest | `clawd/memory/kb-question-harvest.md` | Gap analysis from real support data |
| FAQ source survey | `clawd/memory/faq-source-survey.md` | All 5+ products audited |
| Data flow audit | `clawd/memory/epic1-data-flow-audit.md` | 10 event boundaries, data loss |
| Infrastructure map | `clawd/memory/epic1-infrastructure.md` | Webhook→Inngest plumbing |

### Hivemind Tag Convention

All hivemind entries for this project use:
- **Project tag:** `sr-support`
- **Epic tag:** `epic0`, `epic1a`, `epic1.5`, `epic1b`, `epic2`, `epic3`, `epic3.5`, `epic4`, `epic5`
- **Topic tag:** freeform, e.g. `classification`, `validator`, `kb-design`, `data-flow`

Example: `sr-support,epic2,kb-search`

### Hive Cell IDs

| Epic | Cell ID | Status |
|------|---------|--------|
| Epic 0: Instrumentation & Baseline | `cell--al4e8-mkvzpg31otu` | ✅ Closed |
| Epic 1A: Safety Net (Quick Wins) | `cell--al4e8-mkvzpmas7yt` | 🔄 In Progress |
| Epic 1.5: Data Flow Repair | `cell--al4e8-mkw18eleezr` | ⬜ Open |
| Epic 2: Knowledge Base + RL Loop | `cell--al4e8-mkvzpu8zhse` | ⬜ Open |
| Epic 1B: Escalation & Conversational Interface | `cell--al4e8-mkw18tjr0p0` | ⬜ Open |
| Epic 3: Validator Overhaul | `cell--al4e8-mkvzq2ivtz0` | ⬜ Open |
| Epic 3.5: Agent Actions | `cell--al4e8-mkw197h0u2l` | ⬜ Open |
| Epic 4: Comment-Based Learning | `cell--al4e8-mkvzqb2gzjx` | ⬜ Open |
| Epic 5: Dynamic FAQ & Propagation | `cell--al4e8-mkvzqkyjss0` | ⬜ Open |

### Success Metrics (targets at 90 days)

| Metric | Current | Target |
|--------|---------|--------|
| Response quality (good/acceptable) | 47% | 85%+ |
| BAD response rate | 53% | <10% |
| Meta-commentary leak rate | 47% | 0% |
| Fabrication rate | 10% | <2% |
| KB articles ingested | 0 | 95+ |
| Questions with relevant KB hit | 0% | 60%+ |
| Validation score variance | 0.0 (all 1.0) | σ > 0.15 |
| Relevance check execution rate | 0% | 100% |
| Tag application success rate | 0% | >95% |
| Escalation pickup rate | 0% (0/6) | >90% within 24h |
| Auto-approve accuracy | 47% | 85%+ |

### Key Thresholds

| Threshold | Value | Location | Effect |
|-----------|-------|----------|--------|
| Auto-approve | ≥ 0.8 | `handle-validated-draft.ts` | Draft auto-approved |
| Low confidence escalation | < 0.5 | Routing rules | Escalate to human |
| Memory retrieval | ≥ 0.6 | Classify, draft | Min similarity for context |
| Memory corrections | ≥ 0.7 | Gather, validate | Must-gather priority |
| Template match | ≥ 0.9 | `draft.ts` | Use template instead of LLM |
| KB search | ≥ 0.65 | `search.ts` (proposed) | Min similarity for KB results |
