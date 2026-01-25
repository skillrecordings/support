# Support Agent Pipeline Architecture

## Overview

Multi-step pipeline replacing the monolithic agent. Each step is small, testable, and replaceable.

```
┌─────────┐   ┌───────┐   ┌────────┐   ┌───────┐   ┌──────────┐   ┌──────┐
│ CLASSIFY│ → │ ROUTE │ → │ GATHER │ → │ DRAFT │ → │ VALIDATE │ → │ SEND │
└─────────┘   └───────┘   └────────┘   └───────┘   └──────────┘   └──────┘
     ↓             ↓           ↓           ↓            ↓
   eval         eval        eval        eval         eval
```

## Step Definitions

### 1. CLASSIFY (`classify.ts`)
**Input:** Raw message (subject, body, metadata)
**Output:** `{ category, confidence, signals }`

Categories:
- `support_access` - Login, purchase access issues
- `support_refund` - Refund requests
- `support_transfer` - License transfers
- `support_technical` - Product/code questions
- `support_billing` - Invoice, receipt, payment
- `fan_mail` - Personal message to instructor
- `spam` - Vendor outreach, marketing
- `system` - Automated notifications, bounces
- `unknown` - Can't classify confidently

Signals (extracted metadata):
- `hasEmailInBody` - Customer mentioned email address
- `hasPurchaseDate` - Customer mentioned when they bought
- `hasErrorMessage` - Technical error included
- `isReply` - Part of existing thread
- `mentionsInstructor` - Addressed to Matt/creator by name

### 2. ROUTE (`route.ts`)
**Input:** Classification result + app config
**Output:** `{ action, reason }`

Actions:
- `respond` - Agent should draft a response
- `silence` - No response needed (spam, system, etc.)
- `escalate_human` - Flag for human review
- `escalate_instructor` - Route to instructor (fan mail)
- `escalate_urgent` - High priority human review

Routing rules (configurable per app):
- `spam` → `silence`
- `system` → `silence`
- `fan_mail` + instructor_configured → `escalate_instructor`
- `fan_mail` + no_instructor → `silence` (NOT error message!)
- `support_*` + low_confidence → `escalate_human`
- `support_*` + angry_sentiment → `escalate_urgent`
- `support_*` → `respond`

### 3. GATHER (`gather.ts`)
**Input:** Message + classification + app config
**Output:** `{ user, purchases, knowledge, history, priorMemory }`

Only runs if action=`respond`. Calls real tools:
- `lookupUser(email, appId)` - Get user + purchases
- `searchKnowledge(query, appId)` - KB articles, similar tickets
- `getConversationHistory(conversationId)` - Prior messages
- `searchMemory(query)` - Agent memory system

Returns structured context blob for drafting.

### 4. DRAFT (`draft.ts`)
**Input:** Message + context blob + prompt
**Output:** `{ draft, reasoning, toolsUsed }`

Focused prompt - just drafting, no routing decisions:
- Given this context, write a response
- Prompt is MUCH smaller (no routing rules, no "when not to respond")
- Can use different prompts per category

### 5. VALIDATE (`validate.ts`)
**Input:** Draft response
**Output:** `{ valid, issues[], suggestion? }`

Checks (all deterministic, no LLM):
- `internalLeaks` - Regex for system state exposure
- `metaCommentary` - Regex for "I won't respond", "This is a"
- `bannedPhrases` - Configurable phrase list
- `fabrication` - Checks claims against provided context
- `lengthCheck` - Too short? Too long?
- `toneCheck` - Sentiment analysis (optional)

If invalid:
- Can regenerate with feedback
- Or escalate to human
- NEVER send invalid draft

### 6. SEND (`send.ts`)
**Input:** Validated draft + conversation
**Output:** `{ sent, messageId }`

Only reached if validate passes. Actually sends via Front API.

## Interfaces (TypeScript)

```typescript
// Step 1: Classify
interface ClassifyInput {
  subject: string
  body: string
  from?: string
  conversationId?: string
}

interface ClassifyOutput {
  category: MessageCategory
  confidence: number // 0-1
  signals: Record<string, boolean>
  reasoning?: string
}

// Step 2: Route
interface RouteInput {
  classification: ClassifyOutput
  appConfig: AppConfig
}

interface RouteOutput {
  action: 'respond' | 'silence' | 'escalate_human' | 'escalate_instructor' | 'escalate_urgent'
  reason: string
}

// Step 3: Gather
interface GatherInput {
  message: ClassifyInput
  classification: ClassifyOutput
  appId: string
}

interface GatherOutput {
  user: User | null
  purchases: Purchase[]
  knowledge: KnowledgeItem[]
  history: Message[]
  priorMemory: MemoryItem[]
  gatherErrors: string[] // Track failures but don't expose
}

// Step 4: Draft
interface DraftInput {
  message: ClassifyInput
  classification: ClassifyOutput
  context: GatherOutput
  prompt?: string // Override default
}

interface DraftOutput {
  draft: string
  reasoning?: string
  toolsUsed: string[]
}

// Step 5: Validate
interface ValidateInput {
  draft: string
  context: GatherOutput
}

interface ValidateOutput {
  valid: boolean
  issues: ValidationIssue[]
  suggestion?: string
}

interface ValidationIssue {
  type: 'internal_leak' | 'meta_commentary' | 'banned_phrase' | 'fabrication' | 'length' | 'tone'
  message: string
  match?: string
}
```

## Eval Strategy

Each step has its own eval dataset and metrics:

### classify.eval.ts
- Dataset: Messages with human-labeled categories
- Metrics: Accuracy, precision/recall per category, confidence calibration

### route.eval.ts  
- Dataset: Classifications with expected actions
- Metrics: Correct action rate, false silence rate, false escalation rate

### gather.eval.ts
- Dataset: Messages with expected context (mocked or real DB)
- Metrics: Context completeness, error handling

### draft.eval.ts
- Dataset: Context blobs with quality-scored outputs
- Metrics: Quality scores (leaks, meta, banned, fabrication), helpfulness

### validate.eval.ts
- Dataset: Drafts with known issues
- Metrics: Detection rate, false positive rate

### e2e.eval.ts
- Dataset: Full messages with expected outcomes
- Metrics: End-to-end quality, latency, cost

## File Structure

```
packages/core/src/pipeline/
├── ARCHITECTURE.md      # This file
├── index.ts             # Pipeline orchestrator
├── types.ts             # Shared interfaces
├── steps/
│   ├── classify.ts
│   ├── route.ts
│   ├── gather.ts
│   ├── draft.ts
│   ├── validate.ts
│   └── send.ts
├── prompts/
│   ├── classify.md
│   └── draft.md
└── evals/
    ├── classify.eval.ts
    ├── route.eval.ts
    ├── gather.eval.ts
    ├── draft.eval.ts
    ├── validate.eval.ts
    └── e2e.eval.ts
```

## Migration Path

1. Build pipeline steps locally
2. Eval each step individually
3. Eval end-to-end against production baseline (35.6%)
4. Beat baseline consistently
5. Wire to Inngest for production
6. Gradual rollout with shadow mode

## Key Design Decisions

1. **Route decides silence, not Draft** - If we shouldn't respond, we never even try to draft. No "I won't respond to this" leaks.

2. **Gather errors don't leak** - If lookupUser fails, that's tracked internally but draft just sees "no user found", not "API error: connection refused"

3. **Validate is deterministic** - No LLM, just regex/rules. Fast, predictable, testable.

4. **Prompts are small and focused** - Draft prompt is ONLY about writing good responses, not routing logic.

5. **Each step is independently deployable** - Can swap classifier without touching draft logic.
