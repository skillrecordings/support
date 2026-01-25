# PRD: Support Agent Pipeline v2

**Status:** In Progress  
**Author:** Joel + Grimlock  
**Date:** 2026-01-24  
**Last Updated:** 2026-01-24

---

## Problem Statement

The current support agent has a **35.6% quality pass rate** on production responses. Analysis of 45 real production responses shows:

| Issue Type | Count | Example |
|------------|-------|---------|
| Internal state leaks | 12 | "No instructor routing configured for this app" |
| Meta-commentary | 13 | "This is a vendor email, I won't respond" |
| Banned phrases | 13 | "I'd recommend", "Thanks for reaching out", em dashes |
| Fabrication | 3 | "Start with the fundamentals section" (made up) |

**Root Cause:** The monolithic prompt tries to do everything - classify, route, gather context, draft, AND police its own output. When something goes wrong (routing fails, no knowledge found), the agent explains itself instead of failing gracefully.

---

## Goals

### Primary Goal
**Achieve 90%+ quality pass rate** on production-like scenarios while maintaining response helpfulness.

### Secondary Goals
1. **Testable at each step** - Evals for classify, route, draft, validate independently
2. **Graceful failure** - When things break, escalate silently instead of leaking errors
3. **Deterministic guardrails** - Quality checks that don't rely on LLM judgment
4. **Faster iteration** - Change classifier without touching draft prompt

### Non-Goals
- Changing the customer-facing response style (keep current tone)
- Adding new features (focus on quality, not capability)
- Real-time latency optimization (correctness first)

---

## Solution: Multi-Step Pipeline

Replace monolithic agent with discrete steps:

```
┌──────────┐   ┌───────┐   ┌────────┐   ┌───────┐   ┌──────────┐   ┌──────┐
│ CLASSIFY │ → │ ROUTE │ → │ GATHER │ → │ DRAFT │ → │ VALIDATE │ → │ SEND │
└──────────┘   └───────┘   └────────┘   └───────┘   └──────────┘   └──────┘
     │              │           │           │            │
     ▼              ▼           ▼           ▼            ▼
   eval           eval        eval        eval         eval
```

### Why This Works

| Current Problem | Pipeline Solution |
|-----------------|-------------------|
| Agent says "I won't respond to this" | Route decides silence; Draft never runs |
| Agent leaks "no instructor configured" | Route handles missing config silently |
| Agent uses banned phrases | Validate catches before send |
| Agent makes up course content | Validate checks claims against context |
| Hard to test routing vs drafting | Each step has independent eval |

---

## Step Specifications

### Step 1: CLASSIFY

**Purpose:** Categorize incoming message before any other processing.

**Input:**
```typescript
{
  subject: string
  body: string
  from?: string        // Sender email
  conversationId?: string
  appId?: string
}
```

**Output:**
```typescript
{
  category: MessageCategory  // See categories below
  confidence: number         // 0-1
  signals: {
    hasEmailInBody: boolean
    hasPurchaseDate: boolean
    hasErrorMessage: boolean
    isReply: boolean
    mentionsInstructor: boolean
    hasAngrySentiment: boolean
    isAutomated: boolean
    isVendorOutreach: boolean
  }
  reasoning?: string
}
```

**Categories:**
| Category | Description | Example |
|----------|-------------|---------|
| `support_access` | Login/access issues | "Can't access my purchase" |
| `support_refund` | Refund requests | "I want my money back" |
| `support_transfer` | License transfers | "Move to different email" |
| `support_technical` | Product questions | "How do I use generics?" |
| `support_billing` | Invoice/receipt | "Need invoice for taxes" |
| `fan_mail` | Personal to instructor | "Your course changed my life" |
| `spam` | Vendor/marketing | "Partnership opportunity" |
| `system` | Automated messages | Auto-reply, bounce, OOO |
| `unknown` | Can't classify | Ambiguous messages |

**Implementation:**
1. **Fast path (no LLM):** Regex patterns for obvious cases
   - Automated messages: `/auto-reply|out of office|mailer-daemon/i`
   - Vendor spam: `/partnership|sponsor|backlink|seo services/i`
   - Refund: `/refund|money back|cancel.*purchase/i`
   - Access: `/can't access|lost access|unable to log in/i`
   
2. **LLM fallback:** For nuanced cases, call Haiku with structured output

**Eval Criteria:**
- Accuracy: 95%+ on labeled dataset
- Fast path coverage: 60%+ of messages (saves LLM costs)
- Confidence calibration: When it says 90% confident, it's right 90% of time

---

### Step 2: ROUTE

**Purpose:** Decide what action to take based on classification.

**Input:**
```typescript
{
  message: ClassifyInput
  classification: ClassifyOutput
  appConfig: {
    appId: string
    instructorTeammateId?: string  // For instructor routing
    instructorConfigured: boolean
    autoSendEnabled: boolean
  }
}
```

**Output:**
```typescript
{
  action: 'respond' | 'silence' | 'escalate_human' | 'escalate_instructor' | 'escalate_urgent'
  reason: string  // Internal logging only, never shown to customer
}
```

**Routing Rules:**

| Condition | Action | Reason |
|-----------|--------|--------|
| category = `system` | `silence` | Automated message |
| category = `spam` | `silence` | Vendor outreach |
| category = `unknown` OR confidence < 0.5 | `escalate_human` | Can't classify confidently |
| category = `fan_mail` | `escalate_instructor` | Route to instructor (MUST be configured) |
| signals.hasAngrySentiment = true | `escalate_urgent` | Frustrated customer |
| category starts with `support_` | `respond` | Agent handles |

**Key Principle:** If we shouldn't respond, we STOP HERE. Draft never runs. This prevents "I won't respond to this" leaks.

**Implementation:** Pure TypeScript logic, no LLM. Rules are configurable per app.

**Eval Criteria:**
- Correct action: 98%+
- False silence rate: < 1% (don't miss real support requests)
- False escalation rate: < 5% (don't overwhelm humans)

---

### Step 3: GATHER

**Purpose:** Collect all context needed for drafting. Only runs if action = `respond`.

**Input:**
```typescript
{
  message: ClassifyInput
  classification: ClassifyOutput
  appId: string
}
```

**Output:**
```typescript
{
  user: User | null
  purchases: Purchase[]
  knowledge: KnowledgeItem[]
  history: ConversationMessage[]
  priorMemory: MemoryItem[]
  gatherErrors: GatherError[]  // NEVER exposed to draft
}
```

**Data Sources:**
1. `lookupUser(email, appId)` → User + purchases from app integration
2. `searchKnowledge(query, appId)` → KB articles, similar tickets, good responses
3. `getConversationHistory(conversationId)` → Prior messages in thread
4. `searchMemory(query)` → Agent memory system

**Error Handling:**
- If lookupUser fails → `user: null`, error logged in `gatherErrors`
- If searchKnowledge fails → `knowledge: []`, error logged
- Draft sees "no user found", NOT "API connection refused"
- **Gather errors NEVER reach the customer**

**Eval Criteria:**
- Context completeness: Has user when user exists
- Error isolation: Draft output never contains error messages
- Latency: < 2s p95

---

### Step 4: DRAFT

**Purpose:** Generate response using gathered context.

**Input:**
```typescript
{
  message: ClassifyInput
  classification: ClassifyOutput
  context: GatherOutput
  promptOverride?: string  // For testing different prompts
}
```

**Output:**
```typescript
{
  draft: string
  reasoning?: string
  toolsUsed: string[]
  durationMs: number
}
```

**Prompt Strategy:**

The draft prompt is MUCH simpler than current monolithic prompt:
- **No routing logic** - Route already decided we should respond
- **No "when not to respond"** - We already know we're responding
- **No error handling instructions** - Gather already handled errors
- **Just writing instructions** - Tone, style, banned phrases

**Prompt sections:**
1. Role: "You are a support agent for {product}. Write a helpful response."
2. Context injection: User info, purchases, relevant knowledge
3. Style guide: Direct, no corporate speak, banned phrase list
4. The message to respond to

**Eval Criteria:**
- Helpfulness: Addresses customer's actual question
- Quality: Passes validate step
- Consistency: Similar inputs → similar outputs

---

### Step 5: VALIDATE

**Purpose:** Check draft quality before sending. Deterministic checks only (no LLM).

**Input:**
```typescript
{
  draft: string
  context: GatherOutput  // For fabrication checking
  strictMode?: boolean   // Treat warnings as errors
}
```

**Output:**
```typescript
{
  valid: boolean
  issues: ValidationIssue[]
  suggestion?: string
}
```

**Checks:**

| Check | Type | Pattern Examples |
|-------|------|------------------|
| Internal leaks | error | "no instructor configured", "can't route", "API error" |
| Meta-commentary | error | "This is a vendor email", "I won't respond", "Per my guidelines" |
| Banned phrases | error | "I'd recommend", "Thanks for reaching out", em dashes |
| Fabrication | error | Course content claims without knowledge base support |
| Too short | warning | < 10 chars |
| Too long | warning | > 2000 chars |

**If Invalid:**
- Option 1: Regenerate with feedback (up to N retries)
- Option 2: Escalate to human
- **NEVER send invalid draft**

**Implementation:** Regex-based pattern matching. ~0.2ms per check.

**Eval Criteria:**
- Detection rate: 95%+ of known bad patterns
- False positive rate: < 5% (don't reject good responses)
- Latency: < 5ms

---

### Step 6: SEND

**Purpose:** Actually send the validated response.

**Input:**
```typescript
{
  conversationId: string
  draft: string
  appId: string
}
```

**Output:**
```typescript
{
  sent: boolean
  messageId?: string
  error?: string  // Logged, not exposed
}
```

**Implementation:** Call Front API to send message.

---

## Eval Strategy

### Per-Step Evals

| Step | Dataset | Metrics |
|------|---------|---------|
| Classify | Labeled messages → categories | Accuracy, precision/recall, confidence calibration |
| Route | Classifications → actions | Correct action rate, false silence, false escalation |
| Gather | Messages → context | Completeness, error isolation |
| Draft | Context → responses | Quality scores, helpfulness |
| Validate | Drafts → issues | Detection rate, false positive rate |

### End-to-End Eval

**Dataset:** Production messages with expected outcomes
**Baseline:** Current 35.6% quality pass rate
**Target:** 90%+ quality pass rate

**Metrics:**
- Quality pass rate (no leaks, meta, banned, fabrication)
- Helpfulness (LLM-judged or human-labeled)
- Correct action rate (respond when should, silent when shouldn't)
- Latency (p50, p95, p99)
- Cost per message

---

## Implementation Plan

### Phase 1: Foundation (DONE)
- [x] Architecture design
- [x] Type definitions
- [x] Classify step (fast path + LLM)
- [x] Route step (rule-based)
- [x] Validate step (pattern matching)
- [x] Pipeline orchestrator
- [x] CLI commands for testing
- [x] Validate eval with built-in scenarios

### Phase 2: Data & Evals
- [ ] Build labeled classify dataset from production
- [ ] Build validate dataset from production failures
- [ ] Run classify eval, tune fast path patterns
- [ ] Run validate eval, tune patterns

### Phase 3: Integration
- [ ] Wire Gather to real tools (lookupUser, searchKnowledge, etc.)
- [ ] Wire Draft with focused prompt
- [ ] Run end-to-end eval against baseline

### Phase 4: Optimization
- [ ] Tune prompts to beat 90% target
- [ ] Add retry logic for validate failures
- [ ] Performance optimization

### Phase 5: Production
- [ ] Wire to Inngest
- [ ] Shadow mode (run both, compare)
- [ ] Gradual rollout
- [ ] Monitoring & alerting

---

## Success Criteria

### Must Have
- [ ] 90%+ quality pass rate on production-like scenarios
- [ ] No internal state leaks in any sent response
- [ ] No meta-commentary in any sent response
- [ ] Each step independently testable with eval

### Should Have
- [ ] 60%+ fast path coverage (cost savings)
- [ ] < 3s p95 latency end-to-end
- [ ] Helpful responses (not just "safe" responses)

### Nice to Have
- [ ] Per-category prompt optimization
- [ ] Automatic retry on validate failure
- [ ] A/B testing infrastructure

---

## Open Questions

1. **Retry strategy:** If validate fails, regenerate or escalate?
2. **Category-specific prompts:** Worth the complexity?
3. **Memory integration:** How much prior context helps?
4. **Cost budget:** How much LLM spend per message is acceptable?

---

## Appendix: File Structure

```
packages/core/src/pipeline/
├── ARCHITECTURE.md      # Technical design
├── index.ts             # Pipeline orchestrator
├── types.ts             # All interfaces
├── steps/
│   ├── classify.ts      # Category detection
│   ├── route.ts         # Action decision
│   ├── gather.ts        # Context collection (TODO)
│   ├── draft.ts         # Response generation (TODO)
│   ├── validate.ts      # Quality checks
│   └── send.ts          # Front API (TODO)
├── prompts/
│   ├── classify.md      # Classifier prompt
│   └── draft.md         # Draft prompt (TODO)
└── evals/
    ├── classify.eval.ts # Classifier accuracy
    ├── validate.eval.ts # Validator detection
    └── e2e.eval.ts      # End-to-end (TODO)

packages/cli/src/commands/
├── pipeline.ts          # Pipeline CLI commands
└── eval-local/
    └── score-production.ts  # Score real production responses

fixtures/
├── datasets/
│   └── comprehensive-dataset.json  # 45 real conversations
└── baselines/
    └── production-quality-baseline.json  # 35.6% baseline
```
