# Support Agent Pipeline — Architecture Reference

> **Generated:** 2025-07-22  
> **Codebase:** `~/Code/skillrecordings/support`  
> **Inngest app ID:** `support-platform`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Entry Point](#2-entry-point)
3. [Pipeline Stages](#3-pipeline-stages)
4. [Decision Tree](#4-decision-tree)
5. [Terminal Paths](#5-terminal-paths)
6. [Data Flow](#6-data-flow)
7. [Queue & Reliability](#7-queue--reliability)
8. [Known Issues](#8-known-issues)
9. [Event Type Reference](#9-event-type-reference)

---

## 1. Overview

This system is an AI-powered customer support agent built on [Front](https://front.com/) (helpdesk) and [Inngest](https://inngest.com/) (event-driven workflow orchestration). When a customer emails support, the pipeline classifies the message, routes it down one of three terminal paths (respond, escalate, silence), and — for the respond path — gathers context, drafts a reply via LLM, validates it, optionally auto-approves it, and creates a draft in Front for a human to send.

### High-Level Flow

```
                           ┌──────────────────────────────────────────────────┐
                           │                  FRONT HELPDESK                  │
                           └────────────────────┬─────────────────────────────┘
                                                │ POST webhook
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
                           │     Fetch full message → fast-path / LLM        │
                           └────────────────────┬─────────────────────────────┘
                                                │
                                   SUPPORT_CLASSIFIED
                                                │
                                                ▼
                           ┌──────────────────────────────────────────────────┐
                           │         ② ROUTE (deterministic rules)           │
                           └──────┬─────────────┼────────────────┬────────────┘
                                  │             │                │
                          action=respond   action=silence   action=escalate_*
                                  │             │                │
                                  ▼             ▼                ▼
                          SUPPORT_ROUTED    Archive +      SUPPORT_ESCALATED
                                  │         comment             │
                                  ▼        (terminal)           ▼
                           ③ GATHER CONTEXT              HANDLE ESCALATION
                                  │                      (comment + tag + Slack)
                     SUPPORT_CONTEXT_GATHERED                (terminal)
                                  │
                                  ▼
                           ④ DRAFT (LLM)
                                  │
                        SUPPORT_DRAFT_CREATED
                                  │
                                  ▼
                           ⑤ VALIDATE (rules + LLM)
                                  │
                       SUPPORT_DRAFT_VALIDATED
                                  │
                                  ▼
                           ⑥ HANDLE VALIDATED DRAFT
                                  │
                         ┌────────┴────────┐
                    score ≥ 0.8       score < 0.8
                    auto-approve      human review
                         │                 │
                SUPPORT_ACTION_      Slack buttons
                  APPROVED           (24h timeout)
                         │                 │
                         ▼                 ▼
                   ⑦ EXECUTE         SUPPORT_APPROVAL_
                  (Front draft)         DECIDED
                    (terminal)            │
                                          ▼
                                   ⑦ EXECUTE
                                  (Front draft)
                                    (terminal)
```

**Key design decisions:**
- Webhook sends **preview only** (IDs + links, no body) — classify must fetch the full message via Front API
- Every event carries the full payload forward (no back-references to previous events)
- The pipeline creates a **Front draft**, not a direct send — a human always clicks "Send"
- All LLM calls use `anthropic/claude-haiku-4-5`
- Classification uses fast-path regex first, LLM only for ambiguous cases
- Routing is purely deterministic (first-match rule engine, no LLM)

---

## 2. Entry Point

### Webhook Handler

**File:** `apps/front/app/api/webhooks/front/route.ts`  
**Endpoint:** `POST /api/webhooks/front`  
**Verification module:** `packages/core/src/webhooks/verify.ts`

#### Request Processing

1. **HMAC verification** — `HMAC-SHA256(timestamp + ":" + body, FRONT_WEBHOOK_SECRET)`, base64-encoded, timing-safe compare
2. **Replay protection** — Rejects timestamps older than 5 minutes or >5 seconds in the future
3. **Challenge handling** — If `x-front-challenge` header present, echoes `{"challenge": "<value>"}` (webhook setup validation)
4. **Event filtering** — Only processes `inbound_received` type; `sync` returns `{received: true}`; all others acknowledged and ignored
5. **Conversation check** — Bails (200, no dispatch) if no `conversationId` in payload
6. **App registry lookup** — Iterates inbox IDs from `source.data[]`, calls `getAppByInboxId()` from `packages/core/src/services/app-registry`. Bails if no registered app matches.
7. **Inngest dispatch** — Emits `support/inbound.received` event

#### What the Webhook Sends vs. Drops

| Sent to Inngest | Value |
|---|---|
| `conversationId` | `payload.conversation.id` |
| `messageId` | `payload.target.data.id` |
| `subject` | `payload.conversation.subject` (or `""`) |
| `body` | **Always `""`** — webhook is preview-only |
| `senderEmail` | **Always `""`** — webhook is preview-only |
| `appId` | Resolved app slug from inbox registry |
| `inboxId` | Matched inbox ID |
| `_links` | `{ conversation, message }` API URLs |

**Dropped:** `authorization`, `payload.id`, `payload.type`, `payload.emitted_at`, `payload.target._meta`, `payload.source._meta`, raw body/author from preview.

### Inngest Serve Handler

**File:** `apps/front/app/api/inngest/route.ts`

Exposes GET/POST/PUT for Inngest Cloud to invoke registered functions. Serves all workflows from `allWorkflows` array (21 functions registered).

### Cron Registration Refresh

**File:** `apps/front/app/api/cron/route.ts`

Vercel Cron PUTs to `/api/inngest` every 5 minutes to refresh function registrations with Inngest Cloud.

### Secondary Entry Points

| File | Purpose |
|---|---|
| `apps/front/app/api/front/webhook/route.ts` | **Stub/placeholder** — TODO comments, no implementation |
| `apps/web/app/api/stripe/webhooks/route.ts` | Stripe webhook → emits `stripe/event.received` |
| `apps/slack/app/api/slack/interactions/route.ts` | Slack approve/reject button interactions → emits `SUPPORT_APPROVAL_DECIDED` |

---

## 3. Pipeline Stages

### Stage ①: Classify

| | |
|---|---|
| **Function ID** | `support-classify` |
| **File** | `packages/core/src/inngest/workflows/classify.ts` |
| **Trigger** | `support/inbound.received` |
| **Model** | `anthropic/claude-haiku-4-5` (only if fast-path doesn't match) |
| **Retries** | 2 |
| **Emits** | `support/inbound.classified` |

**Steps:**

1. **`fetch-message`** — Fetches full message from Front API using `messageId`. Retrieves body text and sender email. Gracefully degrades to webhook preview values (empty strings) if API unavailable.

2. **`classify`** — Runs `classify()` from `packages/core/src/pipeline/steps/classify.ts`:
   - Extracts deterministic signals via regex (13 signals — see [Decision Tree](#4-decision-tree))
   - Attempts fast-path classification (regex patterns, no LLM)
   - If no fast-path match → queries memory for similar past classifications (threshold ≥ 0.6)
   - Calls LLM with classification prompt + memory context
   - Returns `{ category, confidence, signals, reasoning }`

3. **`emit-classified`** — Emits `SUPPORT_CLASSIFIED` with enriched body/senderEmail from Front API.

**Inputs:** `conversationId`, `messageId`, `appId`, `subject`, `body` (empty), `senderEmail` (empty), `_links`  
**Outputs:** All inputs + hydrated `body`, hydrated `senderEmail`, `classification: { category, confidence, signals, reasoning }`

---

### Stage ②: Route

| | |
|---|---|
| **Function ID** | `support-route` |
| **File** | `packages/core/src/inngest/workflows/route-message.ts` |
| **Trigger** | `support/inbound.classified` |
| **Model** | None (deterministic rules only) |
| **Retries** | 2 |
| **Emits** | `support/inbound.routed` OR `support/inbound.escalated` OR nothing (silence) |

**Steps:**

1. **`route`** — Runs `route()` from `packages/core/src/pipeline/steps/route.ts`. First-match rule engine against category + signals. Returns `{ action, reason }`. Optionally enhanced by memory-aware routing (`routeWithMemory()`).

2. **`apply-tag`** — Applies classification category as a Front tag via API. Fire-and-forget (failure doesn't block pipeline).

3. **Branch on `action`:**
   - **`silence`** → `add-decision-comment-silence` → `archive-conversation` → **TERMINAL** (no event emitted)
   - **`escalate_*` / `support_teammate` / `catalog_voc`** → `add-decision-comment-escalation` → emit `SUPPORT_ESCALATED`
   - **`respond`** → emit `SUPPORT_ROUTED`
   - **Unknown action** → emit `SUPPORT_ESCALATED` with priority `normal`

**Inputs:** All fields from `SUPPORT_CLASSIFIED`  
**Outputs:** All inputs + `route: { action, reason }` + (for escalation) `priority`

---

### Stage ③: Gather Context

| | |
|---|---|
| **Function ID** | `support-gather` |
| **File** | `packages/core/src/inngest/workflows/gather-context.ts` |
| **Trigger** | `support/inbound.routed` (filtered: `route.action == "respond"`) |
| **Model** | None |
| **Retries** | 2 |
| **Emits** | `support/context.gathered` |

**Steps:**

1. **`gather-context`** — Runs `gather()` from `packages/core/src/pipeline/steps/gather.ts` with a 10-second application-level timeout. Runs data sources in parallel:

   | Source | Tool | Returns |
   |---|---|---|
   | User lookup | `IntegrationClient.lookupUser(email)` | User record (id, email, name) |
   | Purchases | `IntegrationClient.getPurchases(userId)` | Purchase list (product, date, amount, status) |
   | Knowledge | `searchKnowledge(query)` | **Currently returns `[]`** (not implemented) |
   | History | `FrontClient.getConversationMessages(cnvId)` | Previous messages in thread |
   | Memory | `MemoryService.find(query)` | Similar past interactions (threshold 0.4) |

   Email resolution priority: (1) sender email from Front API, (2) regex extraction from message body.

2. **`emit-context-gathered`** — Emits `SUPPORT_CONTEXT_GATHERED` with context payload.

**Inputs:** All fields from `SUPPORT_ROUTED`  
**Outputs:** All inputs + `context: { customer: { email, purchases }, knowledge[], memories[], history[] }`

⚠️ User `id` and `name` are dropped at this boundary. History `direction` field is replaced with `from` (reconstructed downstream).

---

### Stage ④: Draft Response

| | |
|---|---|
| **Function ID** | `support-draft` |
| **File** | `packages/core/src/inngest/workflows/draft-response.ts` |
| **Trigger** | `support/context.gathered` |
| **Model** | `anthropic/claude-haiku-4-5` |
| **Retries** | 1 (lower than default — LLM cost) |
| **Emits** | `support/draft.created` |

**Steps:**

1. **`draft-response`** — Runs `draft()` from `packages/core/src/pipeline/steps/draft.ts`:
   - **Template fast-path** (threshold ≥ 0.9): Searches vector store for high-confidence template match. If found, interpolates variables and skips LLM.
   - **Memory query** (threshold ≥ 0.6): Retrieves similar past draft decisions.
   - **LLM generation**: Calls `generateText()` with category-specific prompt + full gathered context + memory context.
   - Returns `{ draft, toolsUsed }`.

2. **`emit-draft-created`** — Emits `SUPPORT_DRAFT_CREATED`.

**Inputs:** All fields from `SUPPORT_CONTEXT_GATHERED` (asserts `body` is non-empty)  
**Outputs:** All inputs + `draft: { content, toolsUsed }` + pass-through `context`

---

### Stage ⑤: Validate Draft

| | |
|---|---|
| **Function ID** | `support-validate` |
| **File** | `packages/core/src/inngest/workflows/validate-draft.ts` |
| **Trigger** | `support/draft.created` |
| **Model** | `anthropic/claude-haiku-4-5` (relevance check only) |
| **Retries** | 2 |
| **Emits** | `support/draft.validated` |

**Steps:**

1. **`validate-draft`** — Runs `validate()` from `packages/core/src/pipeline/steps/validate.ts`. Three validation phases:

   **Phase A — Pattern checks (deterministic):**

   | Check | Severity | Catches |
   |---|---|---|
   | Internal leaks | error | "no instructor configured", "api error", "routing failed" |
   | Meta-commentary | error | "This is a vendor email", "I won't respond", "Per my guidelines" |
   | Banned phrases | error | "Great!", "I'd recommend", "Let me know if you have any other questions", em dashes |
   | Fabrication | error | References to "module 1", "lesson 3" when no KB results exist |
   | Length | warning | < 10 chars or > 2000 chars |

   **Phase B — Memory check (async):**
   Queries memory for corrected drafts (threshold ≥ 0.7). If current draft has Jaccard similarity ≥ 0.6 to a known bad draft → `repeated_mistake` error.

   **Phase C — Relevance check (LLM):**
   Only runs if customer message body is non-empty. LLM scores relevance 0–1. Score < 0.5 → `relevance` error.

2. **`emit-validated`** — Emits `SUPPORT_DRAFT_VALIDATED` with validation results + flattened context metadata.

**Inputs:** All fields from `SUPPORT_DRAFT_CREATED` (asserts `draft.content` is non-empty)  
**Outputs:** Core fields + `draft: { content }` (⚠️ `toolsUsed` dropped) + `validation: { valid, issues[], score, relevance }` + flattened `context` (counts only)

---

### Stage ⑥: Handle Validated Draft (Approval Gate)

| | |
|---|---|
| **Function ID** | `support-handle-validated` |
| **File** | `packages/core/src/inngest/workflows/handle-validated-draft.ts` |
| **Trigger** | `support/draft.validated` |
| **Model** | None |
| **Retries** | 2 |
| **Emits** | `support/action.approved` (auto) OR `support/approval.requested` (human) |

**Auto-approve threshold:** `validation.valid === true AND validation.score >= 0.8`

**Auto-approve path:**
1. `create-approved-action` — Insert into `ActionsTable` with `requires_approval: false`
2. Emit `SUPPORT_ACTION_APPROVED` with `approvedBy: 'auto'`

**Human review path:**
1. `create-pending-action` — Insert into `ActionsTable` with `requires_approval: true`
2. `add-approval-comment` — Post formatted comment to Front with draft text, confidence, category
3. Emit `SUPPORT_APPROVAL_REQUESTED`

---

### Stage ⑥b: Request Approval (Human Path)

| | |
|---|---|
| **Function ID** | `request-approval` |
| **File** | `packages/core/src/inngest/workflows/request-approval.ts` |
| **Trigger** | `support/approval.requested` |
| **Model** | None |
| **Retries** | 0 (default) |
| **Blocking** | `waitForEvent` — up to **24 hours** |

**Steps:**
1. `create-approval-request` — Insert into `ApprovalRequestsTable` (status: `pending`, expires: 24h)
2. `send-slack-notification` — Post Slack message with Approve/Reject buttons to `SLACK_APPROVAL_CHANNEL`
3. `wait-for-approval-decision` — `step.waitForEvent('support/approval.decided')`, matches on `data.actionId`, **24h timeout**
4. On timeout → mark as `expired`; on decision → update status

**Slack interaction handler:** `apps/slack/app/api/slack/interactions/route.ts`
- Approve → emits `SUPPORT_ACTION_APPROVED` + `SUPPORT_APPROVAL_DECIDED`
- Reject → emits `SUPPORT_ACTION_REJECTED` + `SUPPORT_APPROVAL_DECIDED`

---

### Stage ⑦: Execute Approved Action

| | |
|---|---|
| **Function ID** | `execute-approved-action` |
| **File** | `packages/core/src/inngest/workflows/execute-approved-action.ts` |
| **Trigger** | `support/action.approved` |
| **Model** | None |
| **Retries** | 0 (default) |
| **Emits** | Nothing (terminal) |

**Steps:**
1. `lookup-action` — Fetch action record from `ActionsTable` by `actionId`
2. `execute-action` — Based on action type:
   - **`send-draft`**: Get conversation inbox → channel ID → `front.createDraft(conversationId, response, channelId)`. Also adds internal context comment.
   - **Tool execution** (e.g., `processRefund`, `assignToInstructor`): Executes stored tool calls
3. `add-audit-comment` — For auto-approved `send-draft` only. Controlled by `ENABLE_AUDIT_COMMENTS` env var.
4. `update-action-status` — Update `ActionsTable.executed_at` and `ApprovalRequestsTable.status`

**Important:** Creates a **Front draft**, not a direct reply. A human must still click "Send" in Front.

---

## 4. Decision Tree

### Classification: Two-Phase Process

**File:** `packages/core/src/pipeline/steps/classify.ts`

#### Phase 1: Fast-Path (Regex/Rules, No LLM)

**Single-message fast-path** (`fastClassify`):

| Priority | Check | → Category | Confidence |
|---|---|---|---|
| 1 | `isAutomated` signal | `system` | 0.95 |
| 2 | `isVendorOutreach && !hasEmailInBody` | `spam` | 0.90 |
| 3 | `/refund\|money back\|cancel.*purchase/` | `support_refund` | 0.85 |
| 4 | `/can't access\|unable to.*log in/` | `support_access` | 0.85 |
| 5 | `/transfer\|move.*purchase\|different.*email/` | `support_transfer` | 0.80 |
| 6 | `/invoice\|receipt\|tax document\|billing/` | `support_billing` | 0.85 |
| 7 | `mentionsInstructor && /thank\|love\|amazing/` | `fan_mail` | 0.75 |
| — | No match | → Phase 2 (LLM) | — |

**Thread-aware fast-path** (`fastClassifyThread`) — additional rules checked first:

| Priority | Check | → Category | Confidence |
|---|---|---|---|
| 1 | `isAutomated && threadLength === 1` | `system` | 0.95 |
| 2 | Front tag `"AD"` | `spam` | 0.95 |
| 3 | Spam regex (partnership/affiliate/SEO) | `spam` | 0.90 |
| 4 | `isVendorOutreach && threadLength ≤ 2` | `spam` | 0.85 |
| 5 | `isInternalThread \|\| instructorIsAuthor` | `instructor_strategy` | 0.90 |
| 6 | `isThreadResolved(signals)` | `resolved` | 0.85 |
| 7 | Last message direction === `out` | `awaiting_customer` | 0.90 |
| — | No match | → single-message fast-path → Phase 2 | — |

#### Phase 2: LLM Classification

**Model:** `anthropic/claude-haiku-4-5` via `generateObject()` (Vercel AI SDK + Zod schema)

Before LLM call, queries `SupportMemoryService` for similar past classifications (threshold ≥ 0.6).

### 17 Classification Categories

| Category | Description | Fast-path? |
|---|---|---|
| `support_access` | Login, purchase access issues | ✅ regex |
| `support_refund` | Refund requests | ✅ regex |
| `support_transfer` | License transfers | ✅ regex |
| `support_technical` | Product/code questions | ❌ LLM |
| `support_billing` | Invoice, receipt, payment | ✅ regex |
| `fan_mail` | Personal message to instructor | ✅ partial |
| `spam` | Vendor outreach, marketing | ✅ regex |
| `system` | Automated notifications, bounces | ✅ regex |
| `unknown` | Can't classify confidently | ❌ LLM fallback |
| `instructor_strategy` | Instructor discussing business (thread) | ✅ signals |
| `resolved` | Thread already resolved (thread) | ✅ signals |
| `awaiting_customer` | Waiting for customer reply (thread) | ✅ signals |
| `voc_response` | Voice of customer: replies to outreach | ❌ LLM |
| `presales_faq` | Answerable from KB (pricing, curriculum) | ❌ LLM |
| `presales_consult` | Needs instructor judgment (which course) | ❌ LLM |
| `presales_team` | Enterprise/team sales inquiries | ❌ LLM |

### 13 Deterministic Signals

**Extracted via regex in `extractSignals()` before classification:**

| Signal | Detection Pattern |
|---|---|
| `hasEmailInBody` | Standard email regex |
| `hasPurchaseDate` | Date patterns (ISO, US, relative) |
| `hasErrorMessage` | "error:", "exception", "stack trace" |
| `isReply` | Subject starts with "re:" |
| `mentionsInstructor` | Names: matt, pocock, kent, dodds, wesbos |
| `hasAngrySentiment` | "wtf", "ridiculous", "worst experience" |
| `isAutomated` | "auto-reply", "noreply@", "mailer-daemon" |
| `isVendorOutreach` | "partnership opportunity", "backlink", "SEO" |
| `hasLegalThreat` | "lawyer", "legal action", "sue", "lawsuit" |
| `hasOutsidePolicyTimeframe` | "6+ weeks ago", "2+ months ago" |
| `isPersonalToInstructor` | Greeting + instructor name + appreciation |
| `isPresalesFaq` | "how much", "what's included", "PPP", "discount" |
| `isPresalesTeam` | "team of N", "enterprise", "procurement", "PO" |

### Routing Rules (Deterministic, First-Match)

**File:** `packages/core/src/pipeline/steps/route.ts`

**Single-message rules** (`ROUTING_RULES`):

| # | Name | Condition | → Action |
|---|---|---|---|
| 1 | `system_silence` | category === `system` | `silence` |
| 2 | `spam_silence` | category === `spam` | `silence` |
| 3 | `legal_threat_urgent` | `hasLegalThreat` signal | `escalate_urgent` |
| 4 | `fan_mail_instructor` | category === `fan_mail` | `escalate_instructor` |
| 5 | `personal_to_instructor` | `isPersonalToInstructor` signal | `escalate_instructor` |
| 6 | `unknown_escalate` | category === `unknown` OR confidence < 0.5 | `escalate_human` |
| 7 | `refund_policy_violation` | `support_refund` AND `hasOutsidePolicyTimeframe` | `escalate_human` |
| 8 | `angry_escalate` | `hasAngrySentiment` signal | `escalate_human` |
| 9 | `support_respond` | category starts with `support_` | `respond` |
| 10 | `presales_faq_respond` | category === `presales_faq` | `respond` |
| 11 | `presales_team_escalate` | category === `presales_team` | `escalate_human` |
| 12 | `presales_consult_escalate` | category === `presales_consult` | `escalate_instructor` |
| **default** | — | No rule matched | `escalate_human` |

**Thread-aware rules** (`THREAD_ROUTING_RULES`) — prepended before single-message rules:

| # | Name | Condition | → Action |
|---|---|---|---|
| 1 | `resolved_silence` | category === `resolved` OR `isThreadResolved` | `silence` |
| 2 | `awaiting_customer_silence` | category === `awaiting_customer` OR `awaitingCustomerReply` | `silence` |
| 3 | `support_teammate` | `shouldSupportTeammate(signals)` | `support_teammate` |
| 4 | `instructor_strategy` | category === `instructor_strategy` OR `instructorIsAuthor` | `escalate_instructor` |
| 5 | `internal_thread` | `isInternalThread` signal | `silence` |
| 6 | `voc_response_catalog` | category === `voc_response` | `catalog_voc` |

### 7 Route Actions

| Action | Pipeline path | Description |
|---|---|---|
| `respond` | → Gather → Draft → Validate → Approve → Execute | Agent drafts a response |
| `silence` | → Archive (terminal) | No response needed |
| `escalate_human` | → Handle Escalation (terminal) | Flag for human review |
| `escalate_instructor` | → Handle Escalation (terminal) | Route to instructor |
| `escalate_urgent` | → Handle Escalation (terminal) | High priority (legal threats) |
| `support_teammate` | → Handle Escalation (terminal) | Teammate already handling |
| `catalog_voc` | → Handle Escalation (terminal) | Voice of Customer analysis |

### Confidence Thresholds

| Threshold | Location | Effect |
|---|---|---|
| < 0.5 | Routing rules | Escalate to human |
| ≥ 0.6 | Memory query (classify, draft) | Minimum similarity for retrieval |
| ≥ 0.7 | Memory corrections (gather, validate) | Must-gather priority |
| ≥ 0.8 | `handle-validated-draft.ts` | Auto-approve draft |
| ≥ 0.9 | Template matching (`draft.ts`) | Use template instead of LLM |

---

## 5. Terminal Paths

### Path A: Respond

```
SUPPORT_ROUTED → gather-context → draft-response → validate-draft → handle-validated-draft
                                                                         │
                                                                    ┌────┴────┐
                                                               auto-approve  human
                                                                    │         │
                                                              execute    Slack buttons
                                                                    │    (24h wait)
                                                                    ▼         │
                                                             Front draft ←────┘
                                                             created
                                                                    │
                                                             Human clicks
                                                             "Send" in Front
```

**Traced step-by-step:**

1. **Gather** (`support-gather`): Looks up customer via integration API, fetches purchases, queries conversation history from Front, searches memory. Knowledge search is a stub returning `[]`.
2. **Draft** (`support-draft`): Tries template match first (≥ 0.9 similarity). If no match, calls `claude-haiku-4-5` with category-specific prompt + full context. Style: direct, concise, no corporate speak, 2–3 paragraphs max.
3. **Validate** (`support-validate`): Pattern checks (leaks, meta-commentary, banned phrases, fabrication), memory check (repeated mistakes), LLM relevance check.
4. **Approval gate** (`support-handle-validated`): If `valid && score ≥ 0.8` → auto-approve, else → Slack for human review.
5. **Execute** (`execute-approved-action`): Creates a **draft** in Front (not auto-send). Adds internal context comment. Human must click "Send".

**Models used:** `claude-haiku-4-5` at draft (step 2) and validate relevance check (step 3).

---

### Path B: Escalate

```
SUPPORT_CLASSIFIED → route (action=escalate_*) → SUPPORT_ESCALATED → handle-escalation
                                                                           │
                                                                    1. Gather app context
                                                                    2. Add escalation comment
                                                                    3. Apply Front tags
                                                                    4. Notify Slack (urgent/instructor only)
```

**File:** `packages/core/src/inngest/workflows/handle-escalation.ts`

**Traced step-by-step:**

1. **Route emits** — Adds decision comment to Front, emits `SUPPORT_ESCALATED` with priority.
2. **Gather app context** — Look up app config, generate magic login link (24h expiry), fetch customer purchases. All failures gracefully handled.
3. **Escalation comment** — Structured internal comment in Front: escalation type, reason, customer email, purchase history, classification, magic login link.
4. **Tags** — Applied based on priority:

   | Priority | Tag env var |
   |---|---|
   | `urgent` | `FRONT_TAG_URGENT` |
   | `normal` | `FRONT_TAG_ESCALATED` |
   | `instructor` | `FRONT_TAG_INSTRUCTOR` |
   | `teammate_support` | `FRONT_TAG_TEAMMATE_SUPPORT` |
   | `voc` | `FRONT_TAG_VOC` |

5. **Slack notification** — Only for `urgent` (→ `SLACK_ESCALATION_CHANNEL`) and `instructor` (→ `SLACK_INSTRUCTOR_CHANNEL`). Includes priority badge, app ID, category, customer email, subject, reason, "Open in Front" button.

---

### Path C: Silence

```
SUPPORT_CLASSIFIED → route (action=silence) → Decision comment → Archive → (terminal)
```

**File:** `packages/core/src/inngest/workflows/route-message.ts` (silence branch) + `packages/core/src/pipeline/steps/archive.ts`

**Traced step-by-step:**

1. **Decision comment** (`addDecisionComment`): Internal comment documenting classification, confidence, reasoning, action, customer email. Fire-and-forget.
2. **Archive** (`archiveConversation`): Sets Front conversation status to `'archived'`. Removes from inbox without deleting. Fire-and-forget (failure logged, doesn't block).
3. **No event emitted** — pipeline terminates.

**Triggered by categories:** `system`, `spam`, `resolved`, `awaiting_customer`, `internal_thread`.

---

### Special Path: `support_teammate`

Thread-only. When a human teammate is already handling a conversation:
- Runs gather step (same as respond path)
- Adds a **support comment** to Front with gathered context
- Does NOT enter the draft/validate/approve flow

### Special Path: `catalog_voc`

**File:** `packages/core/src/pipeline/steps/catalog-voc.ts`

When customer replies to outreach/survey:
1. LLM sentiment analysis (`claude-haiku-4-5`): `voc_positive`, `voc_feedback`, `voc_blocker`, `voc_testimonial_candidate`
2. Catalog (TODO: database storage not implemented)
3. Slack notification with sentiment, themes, quotable excerpt
4. Expansion request if testimonial candidate (confidence ≥ 0.8)

---

## 6. Data Flow

### Data Availability at Each Boundary

#### Boundary 1: Webhook → `SUPPORT_INBOUND_RECEIVED`

| Field | Available | Value |
|---|---|---|
| `conversationId` | ✅ | From webhook payload |
| `messageId` | ✅ | From webhook payload |
| `subject` | ✅ | From webhook (or `""`) |
| `body` | ⚠️ | **Always `""`** — intentionally empty (preview-only webhook) |
| `senderEmail` | ⚠️ | **Always `""`** — intentionally empty |
| `appId` | ✅ | Resolved from inbox registry |
| `inboxId` | ✅ | From webhook source |
| `_links` | ✅ | Conversation + message API URLs |

#### Boundary 2: Classify → `SUPPORT_CLASSIFIED`

| Field | Available | Source |
|---|---|---|
| `body` | ✅ | **Hydrated from Front API** (fallback: `""`) |
| `senderEmail` | ✅ | **Hydrated from Front API** (fallback: `""`) |
| `classification.*` | ✅ | Generated by classify |
| `_links` | ❌ | Emitted by webhook but **never read** by classify |
| `inboxId` | ❌ | Emitted by webhook but **not forwarded** |

#### Boundary 3: Route → `SUPPORT_ROUTED` / `SUPPORT_ESCALATED`

All fields pass through cleanly. Adds `route: { action, reason }` and (for escalation) `priority`.

#### Boundary 4: Gather → `SUPPORT_CONTEXT_GATHERED`

| Field | Available | Notes |
|---|---|---|
| Core fields | ✅ | All pass through |
| `context.customer.email` | ✅ | From integration lookup |
| `context.customer.purchases` | ✅ | From integration lookup |
| `context.customer.id` | ❌ | **Dropped** — user ID not emitted |
| `context.customer.name` | ❌ | **Dropped** — user name not emitted |
| `context.knowledge` | ⚠️ | Always `[]` — not implemented |
| `context.memories` | ✅ | From memory service |
| `context.history` | ⚠️ | Transformed: `direction` field replaced with `from` |
| `gatherErrors` | ❌ | **Not emitted** (intentional) |
| `trustScore` | ❌ | **Dropped** |

#### Boundary 5: Draft → `SUPPORT_DRAFT_CREATED`

| Field | Available | Notes |
|---|---|---|
| `draft.content` | ✅ | LLM-generated response |
| `draft.toolsUsed` | ✅ | Tools used during drafting |
| `context` | ✅ | Pass-through from gather (raw event shape) |

#### Boundary 6: Validate → `SUPPORT_DRAFT_VALIDATED`

| Field | Available | Notes |
|---|---|---|
| `draft.content` | ✅ | Pass-through |
| `draft.toolsUsed` | 🔴 | **DROPPED** — not forwarded |
| `validation.*` | ✅ | Generated validation results |
| `validation.issues` | ⚠️ | **Flattened** to `string[]` (loses type/severity/match/position) |
| `context` | ⚠️ | **Flattened to counts** — full data replaced with `{ purchaseCount, knowledgeCount, memoryCount }` |

#### Boundary 7: Handle Validated → `SUPPORT_ACTION_APPROVED` / `SUPPORT_APPROVAL_REQUESTED`

| Field | Available | Notes |
|---|---|---|
| Action stored in DB | ✅ | Full draft + parameters persisted |
| `SUPPORT_APPROVAL_REQUESTED.customerEmail` | 🔴 | **Never populated** (defined in type but not set) |
| `SUPPORT_APPROVAL_REQUESTED.inboxId` | 🔴 | **Never populated** |

### Known Data Gaps

1. **`inboxId` lost after webhook** — Emitted in `INBOUND_RECEIVED` but never forwarded through the pipeline. Execute step reads `parameters.inboxId` from DB (which may be undefined).
2. **User ID replaced with email** — Original integration user ID dropped at gather boundary; draft sets `user.id = email`.
3. **History direction reconstruction** — Gather drops `direction`, draft reconstructs from `from` vs `senderEmail` comparison. Fragile if customer uses multiple email addresses.
4. **Knowledge search is a stub** — `searchKnowledge()` always returns `[]`. No knowledge base is wired up.
5. **`SUPPORT_CONVERSATION_RESOLVED` has no emitter** — Event type defined, `index-conversation` workflow registered, but no workflow emits this event. Effectively dead code.

---

## 7. Queue & Reliability

### Inngest Client

**File:** `packages/core/src/inngest/client.ts`

```
ID: 'support-platform'
Event key: INNGEST_EVENT_KEY env var
No global concurrency, retry, or middleware configured.
```

### Per-Function Retry Policies

| Function | Retries | Notes |
|---|---|---|
| `support-classify` | 2 | |
| `support-route` | 2 | |
| `support-gather` | 2 | Event filter: `route.action == "respond"` |
| `support-draft` | **1** | Lower — LLM cost concern |
| `support-validate` | 2 | |
| `support-handle-validated` | 2 | |
| `request-approval` | 0 | Uses `waitForEvent` with 24h timeout |
| `execute-approved-action` | 0 | |
| `support-handle-escalation` | 2 | |
| `handle-stripe-event` | 0 | |
| `index-conversation` | 0 | Throttled: 1/10s per conversationId |
| `retention-cleanup` | 0 | |
| `memory-vote` | 0 | |
| `sync-templates` | 3 | Has `onFailure` handler |
| `sync-templates-on-demand` | 2 | |
| `find-stale-templates` | 3 | Has `onFailure` handler |
| `find-stale-templates-on-demand` | 2 | |
| `tag-gardening` | 3 | Has `onFailure` handler |
| `tag-gardening-on-demand` | 2 | |
| `tag-health-check` | 2 | |
| `tag-health-check-on-demand` | 1 | |

### Concurrency & Throttling

- **No concurrency limits** configured on any function
- **One throttle:** `index-conversation` — 1 execution per 10 seconds per `conversationId`
- **Inngest default:** at-least-once delivery (no explicit idempotency keys set)

### Timeouts

| Scope | Function | Timeout | Behavior on timeout |
|---|---|---|---|
| Application | `support-gather` | 10 seconds | `gather()` call times out internally |
| Inngest wait | `request-approval` | 24 hours | `waitForEvent` expires → marks approval as `expired` |
| Inngest-level | All functions | None configured | No `cancelOn` or `timeout` on any function |

### Dead Letter Queue

**File:** `packages/core/src/inngest/dead-letter.ts`

Infrastructure exists but is **not wired in:**
- `withDeadLetter(fn)` — Returns `fn` as-is (TODO)
- `recordFailedEvent()` — Writes to `DeadLetterQueueTable`
- `alertOnFailure()` — Console warning after 3+ failures. Slack alerting is TODO.
- `calculateBackoff()` — Supports exponential (base 1000ms) and linear

### Idempotency

- **Webhook level:** Relies on Front's delivery guarantees + Inngest's built-in event deduplication
- **No explicit idempotency keys** on any Inngest function
- **`index-conversation` throttle** prevents duplicate indexing (1 per 10s per conversation)
- **`request-approval` correlation:** `waitForEvent` matches on `data.actionId`

### Fire-and-Forget Side Effects

These operations are wrapped in try/catch — failures are logged but don't fail the workflow:
- Tag application (route step)
- Decision comment posting (route step)
- Conversation archiving (route step, silence path)

### Observability

All instrumented via Axiom: `initializeAxiom()`, `log()`, `traceWorkflowStep()`. Data flow logging via `buildDataFlowCheck()` at event boundaries.

### Cron Schedule

| Time (UTC) | Function | Frequency |
|---|---|---|
| `0 2 * * *` | `sync-templates` | Daily |
| `0 3 * * *` | `retention-cleanup` | Daily |
| `0 3 * * 0` | `find-stale-templates` | Sundays |
| `0 4 * * 0` | `tag-gardening` | Sundays |
| `0 6 * * *` | `tag-health-check` | Daily |

Plus: Vercel Cron refreshes Inngest registrations every 5 minutes (`GET /api/cron`).

---

## 8. Known Issues

### 🔴 Critical

1. **`SUPPORT_APPROVAL_REQUESTED` missing `customerEmail` and `inboxId`**
   - **Location:** `packages/core/src/inngest/workflows/handle-validated-draft.ts` (Boundary 7)
   - **Impact:** `request-approval.ts` destructures `customerEmail` for Slack notification blocks. Field is defined in event type but never populated → Slack shows `undefined` for customer email.
   - **Fix:** Populate `customerEmail: senderEmail` and `inboxId` when emitting.

2. **`draft.toolsUsed` dropped at validate boundary**
   - **Location:** `packages/core/src/inngest/workflows/validate-draft.ts` (Boundary 6)
   - **Impact:** Validate receives `draft: { content, toolsUsed }` but only emits `draft: { content }`. `toolsUsed` is lost for the rest of the pipeline. Breaks audit trail of what tools the agent used.
   - **Fix:** Forward `toolsUsed` in emitted event.

3. **`SUPPORT_CONVERSATION_RESOLVED` has no emitter**
   - **Location:** Event type in `packages/core/src/inngest/events.ts`, workflow in `packages/core/src/inngest/workflows/index-conversation.ts`
   - **Impact:** `index-conversation` workflow is registered but can never trigger. Conversation indexing, vector upsert, and trust score updates never run.

4. **`handleMemoryCitation` not registered**
   - **Location:** Defined in `packages/core/src/inngest/workflows/memory-vote.ts` but NOT exported in `allWorkflows` array
   - **Impact:** `memory/cited` events are never processed. Citation tracking is dead.

### 🟡 Moderate

5. **History `direction` field lost and fragile reconstruction**
   - **Location:** Gather (Boundary 4) → Draft (Boundary 5)
   - **Detail:** Gather transforms history to `{ body, from, date }`, dropping `direction`. Draft reconstructs via `from === senderEmail ? 'in' : 'out'`. Breaks if customer uses different email addresses.
   - **Fix:** Include `direction` in emitted history shape.

6. **User ID lost at gather boundary**
   - **Location:** `packages/core/src/inngest/workflows/gather-context.ts` (Boundary 4)
   - **Detail:** Full user object (id, email, name) gathered but only `{ email, purchases }` emitted. Draft sets `user.id = email`. Tool execution (refunds, transfers) may need the real user ID.

7. **Context flattened to counts at validate boundary**
   - **Location:** `packages/core/src/inngest/workflows/validate-draft.ts` (Boundary 6)
   - **Detail:** Full purchase details, knowledge items, memories, history → replaced with `{ purchaseCount, knowledgeCount, memoryCount }`. Approval comments and Slack messages can't show rich context.

8. **Validation issues flattened to strings**
   - **Location:** `packages/core/src/inngest/workflows/validate-draft.ts` (Boundary 6)
   - **Detail:** `ValidationIssue` objects (type, severity, message, match, position) → `string[]`. Downstream loses structured issue data.

9. **Audit comment reads from wrong nested path**
   - **Location:** `packages/core/src/inngest/workflows/execute-approved-action.ts` (Boundary 8)
   - **Detail:** Reads `params.context?.category` instead of `params.category`. Works by accident (both paths exist), but fragile.

10. **Dead letter queue not wired in**
    - **Location:** `packages/core/src/inngest/dead-letter.ts`
    - **Detail:** Full DLQ infrastructure exists (`withDeadLetter`, `recordFailedEvent`, `alertOnFailure`) but `withDeadLetter()` is a no-op returning `fn` as-is.

### 🟢 Observations

11. **`body` not in escalation Slack notifications** — Human must click through to Front. May be intentional (PII).
12. **Classification `signals` not surfaced in escalation** — `hasLegalThreat`, `hasAngrySentiment` not shown to reviewers.
13. **`_links` emitted but never consumed** — Webhook sends API links, classify ignores them (fetches by messageId).
14. **Knowledge search returns `[]`** — `searchKnowledge()` stub, no KB wired up.
15. **No Inngest-level timeouts** — No `cancelOn` or `timeout` on any function except the `waitForEvent` in `request-approval`.
16. **No concurrency limits** — All functions run without concurrency caps.

---

## 9. Event Type Reference

All events defined in `packages/core/src/inngest/events.ts`.

### Core Pipeline Events

#### `support/inbound.received` (`SUPPORT_INBOUND_RECEIVED`)

**Emitted by:** Webhook handler (`apps/front/app/api/webhooks/front/route.ts`)  
**Consumed by:** `support-classify`

```typescript
{
  conversationId: string        // Front conversation ID
  messageId: string             // Front message ID
  subject: string               // Conversation subject (or "")
  body: string                  // Always "" (preview-only webhook)
  senderEmail: string           // Always "" (preview-only webhook)
  appId: string                 // App slug from inbox registry
  inboxId: string               // Matched Front inbox ID
  _links: {
    conversation?: string       // Front API URL for conversation
    message?: string            // Front API URL for message
  }
}
```

---

#### `support/inbound.classified` (`SUPPORT_CLASSIFIED`)

**Emitted by:** `support-classify`  
**Consumed by:** `support-route`

```typescript
{
  conversationId: string
  messageId: string
  appId: string
  subject: string
  body: string                  // Hydrated from Front API
  senderEmail: string           // Hydrated from Front API
  classification: {
    category: string            // One of 17 categories
    confidence: number          // 0-1
    signals: Record<string, boolean>
    reasoning?: string
  }
}
```

---

#### `support/inbound.routed` (`SUPPORT_ROUTED`)

**Emitted by:** `support-route` (when `action === 'respond'`)  
**Consumed by:** `support-gather`

```typescript
{
  conversationId: string
  messageId: string
  appId: string
  subject: string
  body: string
  senderEmail: string
  classification: {
    category: string
    confidence: number
    signals: Record<string, boolean>
    reasoning?: string
  }
  route: {
    action: string              // "respond"
    reason: string
  }
}
```

---

#### `support/inbound.escalated` (`SUPPORT_ESCALATED`)

**Emitted by:** `support-route` (when `action` is `escalate_*`, `support_teammate`, or `catalog_voc`)  
**Consumed by:** `support-handle-escalation`

```typescript
{
  conversationId: string
  messageId: string
  appId: string
  subject: string
  body: string
  senderEmail: string
  classification: { category, confidence, signals, reasoning }
  route: { action, reason }
  priority: string              // "urgent" | "normal" | "instructor" | "teammate_support" | "voc"
}
```

---

#### `support/context.gathered` (`SUPPORT_CONTEXT_GATHERED`)

**Emitted by:** `support-gather`  
**Consumed by:** `support-draft`

```typescript
{
  conversationId: string
  messageId: string
  appId: string
  subject: string
  body: string
  senderEmail: string
  classification: { category, confidence, signals, reasoning }
  route: { action, reason }
  context: {
    customer: {
      email: string
      purchases: Array<{
        product: string
        date: string
        amount: number
        status: string          // "active" | "refunded" | "transferred"
      }>
    } | null
    knowledge: any[]            // Currently always []
    memories: any[]             // Past support interactions
    history: Array<{
      body: string
      from: string              // Email or "agent"
      date: string
    }>
  }
}
```

---

#### `support/draft.created` (`SUPPORT_DRAFT_CREATED`)

**Emitted by:** `support-draft`  
**Consumed by:** `support-validate`

```typescript
{
  conversationId: string
  messageId: string
  appId: string
  subject: string
  body: string
  senderEmail: string
  classification: { category, confidence, signals, reasoning }
  draft: {
    content: string             // LLM-generated response
    toolsUsed: string[]         // Tools used during drafting
  }
  context: { ... }              // Pass-through from CONTEXT_GATHERED
}
```

---

#### `support/draft.validated` (`SUPPORT_DRAFT_VALIDATED`)

**Emitted by:** `support-validate`  
**Consumed by:** `support-handle-validated`

```typescript
{
  conversationId: string
  messageId: string
  appId: string
  subject: string
  body: string
  senderEmail: string
  classification: { category, confidence, signals, reasoning }
  draft: {
    content: string             // ⚠️ toolsUsed is DROPPED here
  }
  validation: {
    valid: boolean
    issues: string[]            // ⚠️ Flattened from ValidationIssue objects
    score: number               // 1.0 if valid, 0.0 if not
    relevance: number           // LLM relevance score (0-1)
  }
  context: {                    // ⚠️ Flattened to summary
    category: string
    confidence: number
    reasoning?: string
    subject: string
    body: string
    senderEmail: string
    customerEmail?: string
    purchaseCount: number
    knowledgeCount: number
    memoryCount: number
  }
}
```

---

#### `support/approval.requested` (`SUPPORT_APPROVAL_REQUESTED`)

**Emitted by:** `support-handle-validated` (when human review needed)  
**Consumed by:** `request-approval`

```typescript
{
  actionId: string              // UUID
  conversationId: string
  appId: string
  action: {
    type: string                // "send-draft"
    parameters: {
      draft: string             // Draft content only
    }
  }
  agentReasoning: string
  customerEmail?: string        // ⚠️ NEVER POPULATED (bug)
  inboxId?: string              // ⚠️ NEVER POPULATED (bug)
}
```

---

#### `support/approval.decided` (`SUPPORT_APPROVAL_DECIDED`)

**Emitted by:** Slack interaction handler (`apps/slack/app/api/slack/interactions/route.ts`)  
**Consumed by:** `request-approval` (via `waitForEvent`)

```typescript
{
  actionId: string              // Correlation key for waitForEvent match
  decision: string              // "approved" | "rejected"
  decidedBy: string             // Slack user ID
  decidedAt: string             // Timestamp
}
```

---

#### `support/action.approved` (`SUPPORT_ACTION_APPROVED`)

**Emitted by:** `support-handle-validated` (auto) or Slack interaction handler (manual)  
**Consumed by:** `execute-approved-action`

```typescript
{
  actionId: string              // UUID — used to look up action from DB
  approvedBy: string            // "auto" or Slack user ID
  approvedAt: string            // Timestamp
}
```

---

#### `support/action.rejected` (`SUPPORT_ACTION_REJECTED`)

**Emitted by:** Slack interaction handler  
**Consumed by:** (no registered consumer)

```typescript
{
  actionId: string
  rejectedBy: string
  rejectedAt: string
  reason?: string
}
```

---

#### `support/conversation.resolved` (`SUPPORT_CONVERSATION_RESOLVED`)

**Emitted by:** ⚠️ **No emitter exists** (dead event)  
**Consumed by:** `index-conversation`

```typescript
{
  conversationId: string
  appId: string
  customerEmail: string
  messages: any[]
  resolution: {
    category: string
    wasAutoSent: boolean
    agentDraftUsed?: boolean
    trustScore?: number
  }
}
```

---

### Auxiliary Events

#### `stripe/event.received` (`STRIPE_EVENT_RECEIVED`)

**Emitted by:** Stripe webhook handler (`apps/web/app/api/stripe/webhooks/route.ts`)  
**Consumed by:** `handle-stripe-event`  
**Handles:** `charge.refunded` (audit log), `account.application.deauthorized` (clear Stripe account)

#### `stripe/refund.completed` (`STRIPE_REFUND_COMPLETED`)

**Defined but not currently emitted by any workflow.**

#### `memory/vote.requested` (`MEMORY_VOTE_REQUESTED`)

**Consumed by:** `memory-vote`  
**Purpose:** Record success/failure outcomes and apply up/downvotes to cited memories.

#### `memory/cited` (`MEMORY_CITED`)

**Consumed by:** `memory-citation` — ⚠️ **NOT registered** in `allWorkflows` (dead code)

#### `memory/outcome.recorded` (`MEMORY_OUTCOME_RECORDED`)

**Defined as type only. No emitter or consumer.**

#### `templates/sync.requested` (`TEMPLATES_SYNC_REQUESTED`)

**Consumed by:** `sync-templates-on-demand`  
**Purpose:** Trigger on-demand template sync from Front.

#### `templates/stale-check.requested` (`STALE_TEMPLATES_CHECK_REQUESTED`)

**Consumed by:** `find-stale-templates-on-demand`

#### `tags/gardening.requested` (`TAG_GARDENING_REQUESTED`)

**Consumed by:** `tag-gardening-on-demand`

#### `tags/health-check.requested` (`TAG_HEALTH_CHECK_REQUESTED`)

**Consumed by:** `tag-health-check-on-demand`

---

## Appendix: All Registered Workflows

**File:** `packages/core/src/inngest/workflows/index.ts`

The `allWorkflows` array (served to Inngest) contains **21 functions:**

| # | Export Name | Function ID | Trigger |
|---|---|---|---|
| 1 | `classifyWorkflow` | `support-classify` | `support/inbound.received` |
| 2 | `routeWorkflow` | `support-route` | `support/inbound.classified` |
| 3 | `gatherWorkflow` | `support-gather` | `support/inbound.routed` (filtered) |
| 4 | `draftWorkflow` | `support-draft` | `support/context.gathered` |
| 5 | `validateWorkflow` | `support-validate` | `support/draft.created` |
| 6 | `handleValidatedDraft` | `support-handle-validated` | `support/draft.validated` |
| 7 | `requestApproval` | `request-approval` | `support/approval.requested` |
| 8 | `executeApprovedAction` | `execute-approved-action` | `support/action.approved` |
| 9 | `handleEscalation` | `support-handle-escalation` | `support/inbound.escalated` |
| 10 | `handleStripeEvent` | `handle-stripe-event` | `stripe/event.received` |
| 11 | `indexConversation` | `index-conversation` | `support/conversation.resolved` |
| 12 | `retentionCleanup` | `retention-cleanup` | Cron: `0 3 * * *` |
| 13 | `handleMemoryVote` | `memory-vote` | `memory/vote.requested` |
| 14 | `syncTemplatesWorkflow` | `sync-templates` | Cron: `0 2 * * *` |
| 15 | `syncTemplatesOnDemand` | `sync-templates-on-demand` | `templates/sync.requested` |
| 16 | `findStaleTemplatesWorkflow` | `find-stale-templates` | Cron: `0 3 * * 0` |
| 17 | `findStaleTemplatesOnDemand` | `find-stale-templates-on-demand` | `templates/stale-check.requested` |
| 18 | `tagGardeningWorkflow` | `tag-gardening` | Cron: `0 4 * * 0` |
| 19 | `tagGardeningOnDemand` | `tag-gardening-on-demand` | `tags/gardening.requested` |
| 20 | `tagHealthCheckWorkflow` | `tag-health-check` | Cron: `0 6 * * *` |
| 21 | `tagHealthCheckOnDemand` | `tag-health-check-on-demand` | `tags/health-check.requested` |

**Not registered (dead code):** `handleMemoryCitation` (`memory-citation`) — defined in `memory-vote.ts` but not exported in `allWorkflows`.

---

## Key File Index

| File | Purpose |
|---|---|
| **Entry Points** | |
| `apps/front/app/api/webhooks/front/route.ts` | Front webhook handler |
| `apps/front/app/api/inngest/route.ts` | Inngest serve handler |
| `apps/front/app/api/cron/route.ts` | Vercel cron → Inngest refresh |
| `apps/web/app/api/stripe/webhooks/route.ts` | Stripe webhook handler |
| `apps/slack/app/api/slack/interactions/route.ts` | Slack button interactions |
| **Core Pipeline** | |
| `packages/core/src/pipeline/index.ts` | Pipeline orchestrator (`runPipeline`, `runThreadPipeline`) |
| `packages/core/src/pipeline/types.ts` | All type definitions |
| `packages/core/src/pipeline/steps/classify.ts` | Classification (signals, fast-path, LLM) |
| `packages/core/src/pipeline/steps/route.ts` | Routing rules engine |
| `packages/core/src/pipeline/steps/gather.ts` | Context gathering |
| `packages/core/src/pipeline/steps/draft.ts` | Draft generation (template + LLM) |
| `packages/core/src/pipeline/steps/validate.ts` | Draft validation (patterns + LLM relevance) |
| `packages/core/src/pipeline/steps/archive.ts` | Front conversation archiving |
| `packages/core/src/pipeline/steps/comment.ts` | Comment formatting (decision/escalation/approval/audit) |
| `packages/core/src/pipeline/steps/tag.ts` | Front tag application |
| `packages/core/src/pipeline/steps/catalog-voc.ts` | VOC analysis and Slack notification |
| `packages/core/src/pipeline/steps/thread-signals.ts` | Thread signal computation |
| **Inngest Workflows** | |
| `packages/core/src/inngest/client.ts` | Inngest client (`support-platform`) |
| `packages/core/src/inngest/events.ts` | Event type definitions |
| `packages/core/src/inngest/workflows/index.ts` | `allWorkflows` registry |
| `packages/core/src/inngest/workflows/classify.ts` | Classify workflow |
| `packages/core/src/inngest/workflows/route-message.ts` | Route + tag + archive/escalate |
| `packages/core/src/inngest/workflows/gather-context.ts` | Gather context workflow |
| `packages/core/src/inngest/workflows/draft-response.ts` | Draft response workflow |
| `packages/core/src/inngest/workflows/validate-draft.ts` | Validate draft workflow |
| `packages/core/src/inngest/workflows/handle-validated-draft.ts` | Approval gate workflow |
| `packages/core/src/inngest/workflows/request-approval.ts` | Slack approval + waitForEvent |
| `packages/core/src/inngest/workflows/execute-approved-action.ts` | Execute approved action |
| `packages/core/src/inngest/workflows/handle-escalation.ts` | Escalation handler |
| `packages/core/src/inngest/workflows/index-conversation.ts` | Post-resolution indexing |
| `packages/core/src/inngest/workflows/retention-cleanup.ts` | Daily data cleanup |
| `packages/core/src/inngest/workflows/memory-vote.ts` | Memory voting + citation |
| `packages/core/src/inngest/workflows/stripe-refund.ts` | Stripe event handler |
| `packages/core/src/inngest/workflows/sync-templates.ts` | Template sync (cron + on-demand) |
| `packages/core/src/inngest/workflows/find-stale-templates.ts` | Stale template check |
| `packages/core/src/inngest/workflows/tag-gardening.ts` | Tag gardening + health check |
| **Infrastructure** | |
| `packages/core/src/inngest/dead-letter.ts` | Dead letter queue (not wired in) |
| `packages/core/src/webhooks/verify.ts` | HMAC webhook verification |
| `packages/core/src/services/app-registry/` | Inbox → app mapping |
