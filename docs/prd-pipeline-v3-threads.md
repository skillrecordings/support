# PRD: Thread-Aware Support Pipeline v3

**Status:** Draft  
**Author:** Grimlock + Joel  
**Date:** 2026-01-24  
**Depends on:** prd-pipeline-v2.md (same pipeline, thread-shaped input)

---

## Problem Statement

Pipeline v2 classifies **individual messages**. But support conversations are **threads**:

| What We Have | What's Real |
|--------------|-------------|
| "Banger quote" message | Part of instructor strategy discussion |
| "Can you help?" | Follow-up to a refund request 3 messages back |
| Vendor pitch email | Single-message spam thread |
| Access issue → clarification → resolved | Multi-turn support thread |

**The issue:** A message that looks like spam in isolation might be a legitimate instructor strategy thread when you see the context. Classification accuracy suffers because we're evaluating atoms instead of molecules.

**Current eval results:** 73.3% classify accuracy on single messages. We're measuring the wrong unit.

---

## Goals

### Primary Goal
**Classify threads, not messages.** The pipeline input is a thread (1-N messages). The classifier sees the full conversation. The eval measures thread-level accuracy.

### Secondary Goals
1. **Backwards compatible** - Single-message threads just work
2. **Same pipeline bones** - Classify → Route → Gather → Draft → Validate → Send
3. **Thread-aware fixtures** - Evals run against thread datasets
4. **Category expansion** - Add thread-specific categories (instructor_strategy, multi_turn_support)

### Non-Goals
- Changing the pipeline architecture
- Real-time message aggregation (Front already gives us threads)
- Thread summarization (full context to classifier)

---

## Key Insight: Front Already Gives Us Threads

Front organizes messages into **conversations**. When we get a webhook:
- `conversation_id` groups related messages
- `conversationHistory` is the full thread (already in our dataset!)
- We just need to classify **the thread**, not just the trigger

The data is there. We're just not using it right.

---

## Solution: Thread-First Classification

### Data Model Change

**Before (v2):**
```typescript
interface ClassifyInput {
  subject: string
  body: string
  from?: string
  conversationId?: string
  appId?: string
}
```

**After (v3):**
```typescript
interface ThreadMessage {
  direction: 'in' | 'out'
  body: string
  timestamp: number
  author?: string
  subject?: string  // Only on first message typically
}

interface ClassifyInput {
  conversationId: string
  appId: string
  messages: ThreadMessage[]  // Full thread, chronological
  triggerMessage: ThreadMessage  // The message that triggered processing
}
```

### Classification Changes

**New categories:**
| Category | Description | Example |
|----------|-------------|---------|
| `instructor_strategy` | Instructor discussing business/content strategy | Banger quotes, course planning |
| `multi_turn_support` | Support thread with multiple back-and-forths | Access issue being debugged |
| `resolved` | Thread already resolved (no action needed) | Customer said "thanks, that worked!" |
| `awaiting_customer` | We asked a question, waiting for reply | "What email did you purchase with?" |
| `voc_response` | Customer replies to our automated outreach (email sequences, surveys, course check-ins). Data-gathering responses, not support. | "Thanks for checking in, the course is great", replies to "What interests you about AI?" |

**Modified categories:**
| Category | Change |
|----------|--------|
| `fan_mail` | Now detected even if praise is in message 3 of thread |
| `spam` | Single-message vendor outreach (thread length = 1 is a signal) |
| `support_*` | Classify by the **thread topic**, not just trigger message |

### Classifier Prompt

```markdown
You are classifying a support THREAD, not a single message.

Thread context:
- {N} messages in this conversation
- Started: {first_message_date}
- Last activity: {trigger_message_date}
- Direction pattern: {in/out/in/out...}

Classify based on the OVERALL thread topic, not just the latest message.

Examples:
- A thread where customer asked for refund, we asked why, they said "changed my mind" → support_refund
- A thread where instructor shares a quote they want to tweet → instructor_strategy  
- A single vendor email with no prior history → spam
- A thread where we helped with access and customer said "thanks!" → resolved
```

### Thread Signals

New signals for thread-level classification:

```typescript
interface ThreadSignals {
  // Existing (now computed across thread)
  hasEmailInBody: boolean
  hasPurchaseDate: boolean
  hasErrorMessage: boolean
  mentionsInstructor: boolean
  hasAngrySentiment: boolean
  
  // New thread-specific
  threadLength: number              // Total messages
  threadDurationHours: number       // First to last message
  customerMessageCount: number      // Inbound count
  agentMessageCount: number         // Outbound count
  hasAgentResponse: boolean         // Did we already reply?
  lastMessageDirection: 'in' | 'out'
  threadPattern: string             // e.g., "in-out-in" for back-and-forth
  
  // Resolution signals
  hasThankYou: boolean              // Customer thanked us
  hasResolutionPhrase: boolean      // "that worked", "all set", etc.
  awaitingCustomerReply: boolean    // We asked a question, no reply yet
  
  // Teammate/author signals
  hasTeammateMessage: boolean       // Human teammate responded (not agent)
  hasRecentTeammateResponse: boolean // Teammate responded after last customer msg
  hasInstructorMessage: boolean     // Instructor participated
  instructorIsAuthor: boolean       // Thread started BY instructor
  isInternalThread: boolean         // Only teammates, no customers
  lastResponderType: 'customer' | 'teammate' | 'agent' | 'instructor'
}
```

---

## Fixture Format

### Thread Fixture

```typescript
interface ThreadFixture {
  id: string
  name: string
  description: string
  appId: string
  
  // Thread data
  thread: {
    conversationId: string
    messages: ThreadMessage[]
  }
  
  // Expectations
  expected: {
    category: MessageCategory
    action: RouteAction
    signals?: Partial<ThreadSignals>
  }
  
  // Tags for filtering
  tags: string[]  // ['instructor_strategy', 'multi_turn', 'resolution']
}
```

### Example Fixtures

**Instructor Strategy Thread (the banger quote):**
```json
{
  "id": "thread_instructor_strategy_banger",
  "name": "Instructor sharing banger quote",
  "description": "Matt sharing a quote for potential tweet - should route to instructor",
  "appId": "app_tt",
  "thread": {
    "conversationId": "cnv_banger123",
    "messages": [
      {
        "direction": "in",
        "body": "yo check this quote I just found:\n\n\"TypeScript is just JavaScript with guard rails\"\n\nBanger or nah?",
        "timestamp": [PHONE],
        "author": "[EMAIL]"
      }
    ]
  },
  "expected": {
    "category": "instructor_strategy",
    "action": "escalate_instructor"
  },
  "tags": ["instructor_strategy", "single_message", "internal"]
}
```

**Resolved Support Thread:**
```json
{
  "id": "thread_support_resolved",
  "name": "Access issue resolved",
  "description": "Customer had access issue, we helped, they confirmed fixed",
  "appId": "app_tt",
  "thread": {
    "conversationId": "cnv_resolved456",
    "messages": [
      {
        "direction": "in",
        "body": "I can't access my course anymore",
        "timestamp": [PHONE]
      },
      {
        "direction": "out",
        "body": "I've refreshed your access. Try logging out and back in.",
        "timestamp": [PHONE]
      },
      {
        "direction": "in",
        "body": "That worked, thanks!",
        "timestamp": [PHONE]
      }
    ]
  },
  "expected": {
    "category": "resolved",
    "action": "silence",
    "signals": {
      "hasThankYou": true,
      "hasResolutionPhrase": true
    }
  },
  "tags": ["support_access", "multi_turn", "resolved"]
}
```

**Multi-Turn Refund:**
```json
{
  "id": "thread_refund_multi",
  "name": "Refund request with clarification",
  "description": "Customer asks for refund, we ask why, they explain",
  "appId": "app_tt",
  "thread": {
    "conversationId": "cnv_refund789",
    "messages": [
      {
        "direction": "in", 
        "body": "I want a refund please",
        "timestamp": [PHONE]
      },
      {
        "direction": "out",
        "body": "Happy to help. Can you share what's not working for you?",
        "timestamp": [PHONE]
      },
      {
        "direction": "in",
        "body": "I just don't have time to go through it right now",
        "timestamp": [PHONE]
      }
    ]
  },
  "expected": {
    "category": "support_refund",
    "action": "respond"
  },
  "tags": ["support_refund", "multi_turn"]
}
```

**Teammate Already Engaged (support_teammate):**
```json
{
  "id": "thread_teammate_engaged",
  "name": "Teammate handling - agent supports",
  "description": "Human teammate already responded, agent should add context comment not draft",
  "appId": "app_tt",
  "thread": {
    "conversationId": "cnv_teammate123",
    "messages": [
      {
        "direction": "in",
        "body": "I purchased with a different email and can't access",
        "timestamp": [PHONE],
        "author": { "type": "customer", "email": "[EMAIL]" }
      },
      {
        "direction": "out",
        "body": "Let me check your account. What email did you purchase with?",
        "timestamp": [PHONE],
        "author": { "type": "teammate", "email": "[EMAIL]", "teammateId": "tea_haze" }
      },
      {
        "direction": "in",
        "body": "I think it was [EMAIL]",
        "timestamp": [PHONE],
        "author": { "type": "customer", "email": "[EMAIL]" }
      }
    ]
  },
  "expected": {
    "category": "support_access",
    "action": "support_teammate",
    "signals": {
      "hasTeammateMessage": true,
      "hasRecentTeammateResponse": true,
      "lastResponderType": "customer"
    }
  },
  "tags": ["support_access", "multi_turn", "teammate_engaged"]
}
```

---

## Eval Strategy

### Thread-Level Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| Thread accuracy | Correct category for whole thread | 90%+ |
| Action accuracy | Correct route action | 95%+ |
| Resolution detection | Correctly identify resolved threads | 90%+ |
| False silence rate | Real issues marked as resolved/spam | < 2% |

### Dataset Requirements

**Dataset Built:** `fixtures/datasets/combined-threads.json` (130 scenarios)

| Category | Count | Notes |
|----------|-------|-------|
| fan_mail | 51 | Survey responses, appreciation |
| spam | 35 | Vendor pitches, partnerships |
| support_technical | 14 | General questions |
| support_access | 12 | Can't access content |
| resolved | 7 | Multi-turn completed threads |
| support_refund | 7 | Refund requests |
| support_billing | 2 | Invoice requests |
| instructor_strategy | 1 | Internal discussion |
| system | 1 | Automated messages |

### Expanded Dataset (2026-01-24)

**Expanded Dataset:** `fixtures/datasets/llm-labeled-expanded.json` (259 scenarios)

Added 195 threads from Front archive (Total TypeScript) via:
1. `scripts/convert-tt-messages.ts` - Transform raw Front exports to thread format
2. `scripts/label-transformed-dataset.ts` - LLM-label each sample with `classifyThread()`

| Category | Count | % of Total |
|----------|-------|------------|
| spam | 74 | 28.6% |
| system | 53 | 20.5% |
| voc_response | 40 | 15.4% |
| awaiting_customer | 40 | 15.4% |
| support_technical | 11 | 4.2% |
| support_billing | 10 | 3.9% |
| support_access | 9 | 3.5% |
| resolved | 9 | 3.5% |
| fan_mail | 8 | 3.1% |
| support_refund | 3 | 1.2% |
| instructor_strategy | 1 | 0.4% |
| support_transfer | 1 | 0.4% |

**Data sources:**
- Original LLM-labeled dataset (77 samples from AI Hero)
- Front archive export (195 samples from Total TypeScript)

**Eval Results (100 samples):**
- Overall accuracy: 67.0%
- Fast path usage: ~28%
- Categories at 100%: awaiting_customer, instructor_strategy, system
- Categories needing work: spam (36%), support_access (25%), support_billing (17%)

**Key finding:** Many "mismatches" are actually correct — a thread labeled `spam` by request type but classified `awaiting_customer` by thread state is valid. The labeling captured original request type, but eval measures current thread state.

**Building tools:**
- `scripts/batch-label.ts` - Auto-labeling with pattern matching
- `scripts/label-threads.ts` - Interactive labeling tool
- `scripts/eval-production-llm.ts` - Full LLM eval runner

**Labeling approach:**
1. Auto-label obvious cases (spam patterns, explicit refunds, access issues)
2. Detect resolved threads (team response + customer confirmation)
3. Manual review for ambiguous cases

**Key finding:** LLM is better than regex at fan_mail vs spam distinction. Minimal fast path (automated, explicit refund/access only), let LLM handle nuance.

---

## Implementation Plan

### Phase 0: Teammate Detection Service ✅
- [x] Create `packages/core/src/services/teammate-registry.ts`
- [x] Fetch and cache teammates from Front API (5-min TTL)
- [x] `isTeammate(email): boolean`
- [x] `isInstructor(teammateId, appId): boolean`
- [x] `getMessageAuthor(message, app): MessageAuthorInfo`
- [x] Add teammate detection to thread signal computation

### Phase 1: Data Model ✅
- [x] Update `ClassifyInput` type to thread-based (`ThreadClassifyInput`)
- [x] Add `ThreadSignals` computation (including author signals)
- [x] `ThreadMessage` type with author info
- [x] `ThreadMessageAuthor` type (customer/teammate/agent/instructor)

### Phase 2: Classifier Update ✅
- [x] Update classifier prompt for thread context
- [x] Add new categories (instructor_strategy, resolved, awaiting_customer)
- [x] Update fast path patterns for thread signals
- [x] Thread signal computation (pattern, resolution phrases, etc.)
- [x] `llmThreadClassify()` function with thread-aware schema

### Phase 3: Route Update ✅
- [x] Add routing rules for new categories
- [x] `resolved` → silence
- [x] `awaiting_customer` → silence (or escalate if stale)
- [x] `instructor_strategy` → escalate_instructor
- [x] `support_teammate` → add comment with context
- [x] `comment.ts` step for support_teammate action

### Phase 4: Eval ✅
- [x] Build thread dataset from production conversations (130 labeled scenarios)
- [x] LLM-labeled dataset (63 samples via Vercel AI Gateway)
- [x] Few-shot examples extracted from resolved threads (31 examples)
- [x] Run thread-level classify eval (81.7% baseline)
- [x] Expand dataset with Front archive (259 total samples)
- [ ] Tune for 90%+ thread accuracy

### Phase 5: Integration 🔲
- [ ] Update webhook handler to pass full thread
- [ ] Inngest workflow uses thread input
- [ ] End-to-end thread processing

---

## Voice of Customer (VOC) Responses

### The Problem

Replies to email sequences and automation (course check-ins, NPS surveys, "how's it going?" emails) are being misclassified as `fan_mail` or `support_technical`. They're neither — they're **voice of customer data**, valuable for:
- Testimonials and social proof
- Product feedback and feature requests
- Content ideas
- Understanding customer blockers
- Instructor visibility into student experience

### New Category: `voc_response`

**Definition:** Customer replies to automated outreach (email sequences, surveys, course check-ins). These are data-gathering responses, not support requests or fan mail.

**Examples:**
- "Thanks for checking in, the course is great so far!"
- "I've been too busy to start but planning to next week"
- "Loving the content, especially the section on generics"
- "Would be nice to have more exercises"
- NPS survey responses

### Route Action: `catalog_voc`

Unlike other categories that `silence` or `respond`, VOC responses get cataloged and announced.

**Behavior:**
1. **Classify VOC subtype:**
   - `voc_positive` — praise, success stories, "loving it"
   - `voc_feedback` — suggestions, critiques, feature requests
   - `voc_blocker` — "too busy", "haven't started", obstacles
   - `voc_testimonial_candidate` — compelling quotes worth expanding

2. **Slack announcement** — Post to #voc-responses or #customer-feedback
   ```
   📣 New VOC Response (positive)
   Course: Total TypeScript
   Customer: [EMAIL]
   
   "The section on type guards completely changed how I think about TypeScript. 
   I've already used it in three production projects!"
   
   [View in Front] [Mark as Testimonial]
   ```

3. **Catalog storage** — Store in searchable VOC library:
   - Database table (`voc_responses`)
   - Or tagged Front conversations
   - Or Notion database
   - Indexed by: app, subtype, date, sentiment score

4. **Expansion trigger** — For `voc_testimonial_candidate`:
   - Queue follow-up email: "Thanks for sharing! Would you mind if we featured your experience?"
   - Or: "We'd love to hear more about your journey..."

### VOC Signals

```typescript
interface VOCSignals {
  isReplyToAutomation: boolean    // Responding to sequence/survey
  sentiment: 'positive' | 'neutral' | 'negative'
  hasTestimonialPotential: boolean  // Quotable, specific, enthusiastic
  hasFeedback: boolean             // Suggestions, feature requests
  hasBlocker: boolean              // "Too busy", "haven't started"
  mentionsCourseContent: boolean   // Specific sections, topics
}
```

### Implementation

```typescript
// New route action
case 'voc_response':
  return { action: 'catalog_voc', reason: 'VOC response - catalog and announce' }

// New step: catalog_voc.ts
async function catalogVOC(input: VOCInput): Promise<VOCOutput> {
  const subtype = classifyVOCSubtype(input)
  
  // 1. Store in catalog
  await db.insert(vocResponses).values({
    conversationId: input.conversationId,
    appId: input.appId,
    customerEmail: input.customerEmail,
    subtype,
    content: input.triggerMessage.body,
    sentiment: analyzeSentiment(input.triggerMessage.body),
    createdAt: new Date(),
  })
  
  // 2. Announce to Slack
  await slack.postMessage({
    channel: '#voc-responses',
    blocks: formatVOCSlackMessage(input, subtype),
  })
  
  // 3. Trigger expansion if testimonial candidate
  if (subtype === 'voc_testimonial_candidate') {
    await queueExpansionEmail(input)
  }
  
  return { cataloged: true, subtype, announced: true }
}
```

### Database Schema

```sql
CREATE TABLE voc_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR(255) NOT NULL,
  app_id VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255),
  subtype VARCHAR(50) NOT NULL,  -- positive, feedback, blocker, testimonial_candidate
  content TEXT NOT NULL,
  sentiment DECIMAL(3,2),  -- -1 to 1
  testimonial_approved BOOLEAN DEFAULT FALSE,
  expansion_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT voc_subtype_check CHECK (subtype IN ('voc_positive', 'voc_feedback', 'voc_blocker', 'voc_testimonial_candidate'))
);

CREATE INDEX idx_voc_app ON voc_responses(app_id);
CREATE INDEX idx_voc_subtype ON voc_responses(subtype);
CREATE INDEX idx_voc_created ON voc_responses(created_at);
```

---

## Support Teammate Action

When a human teammate has already responded in a thread, the agent shouldn't draft a competing customer response. Instead, it should **support the teammate** by adding internal context.

### New Route Action: `support_teammate`

**Trigger conditions:**
- Thread has a recent teammate response (not agent/API)
- Customer replied after teammate
- Agent would normally `respond`

**Behavior:**
- Skip `draft` step (no customer-facing response)
- Run `gather` to collect relevant context
- Add **Front comment** (internal note) with:
  - Relevant KB articles
  - Customer purchase history
  - Similar resolved tickets
  - Any useful context for the teammate

### Implementation

```typescript
// In route step
if (signals.hasRecentTeammateResponse && !signals.hasAgentResponse) {
  return {
    action: 'support_teammate',
    reason: 'Teammate already engaged - adding research context as comment'
  }
}
```

```typescript
// New step: ADD_COMMENT (runs instead of DRAFT for support_teammate)
async function addSupportComment(
  conversationId: string,
  context: GatherOutput
): Promise<void> {
  const comment = formatSupportComment(context)
  await front.conversations.addComment(conversationId, comment)
}

function formatSupportComment(context: GatherOutput): string {
  const parts: string[] = ['🤖 **Agent Research Context**\n']
  
  if (context.user) {
    parts.push(`**Customer:** ${context.user.email}`)
    parts.push(`**Purchases:** ${context.purchases.map(p => p.productName).join(', ') || 'None found'}`)
  }
  
  if (context.knowledge.length > 0) {
    parts.push('\n**Relevant KB:**')
    for (const k of context.knowledge.slice(0, 3)) {
      parts.push(`- ${k.title}: ${k.url}`)
    }
  }
  
  if (context.priorMemory.length > 0) {
    parts.push('\n**Similar tickets:**')
    for (const m of context.priorMemory.slice(0, 2)) {
      parts.push(`- ${m.summary}`)
    }
  }
  
  return parts.join('\n')
}
```

### Thread Signals for Detection

```typescript
interface ThreadAuthorSignals {
  hasTeammateMessage: boolean      // Any human teammate responded
  hasRecentTeammateResponse: boolean  // Teammate responded AFTER last customer message
  hasAgentResponse: boolean        // Agent/API already responded
  teammateResponseCount: number    // How many teammate responses
  lastResponderType: 'customer' | 'teammate' | 'agent' | 'instructor'
}
```

### Example Flow

1. Customer: "I can't access my course"
2. Teammate (Haze): "Let me check your account..."
3. Customer: "I purchased with a different email"
4. **Agent sees this, routes to `support_teammate`**
5. Agent adds comment: "Customer has purchases under [EMAIL] - 2 licenses for Total TypeScript Pro"
6. Teammate sees context, handles it

---

## Teammate/Instructor Detection

Front already gives us the data we need. Here's how to identify who sent each message:

### Front Message Structure

```typescript
interface FrontMessage {
  id: string
  is_inbound: boolean  // true = from customer, false = from teammate
  author: {            // Non-null for OUTBOUND messages only
    id: string         // Teammate ID (e.g., "tea_abc123")
    email: string      // Teammate email
    first_name: string
    last_name: string
    is_admin: boolean
  } | null
  recipients: {
    handle: string     // Email address
    role: 'from' | 'to' | 'cc' | 'bcc' | 'reply-to'
    name?: string
  }[]
}
```

### Detection Logic

```typescript
interface MessageAuthorInfo {
  type: 'customer' | 'teammate' | 'instructor'
  email: string
  name?: string
  teammateId?: string  // Only for teammates
}

async function getMessageAuthor(
  message: FrontMessage,
  appConfig: { instructorTeammateId?: string },
  teammateEmails: Set<string>  // Cached from Front API
): Promise<MessageAuthorInfo> {
  
  // OUTBOUND = sent by a teammate
  if (!message.is_inbound && message.author) {
    const isInstructor = message.author.id === appConfig.instructorTeammateId
    return {
      type: isInstructor ? 'instructor' : 'teammate',
      email: message.author.email,
      name: `${message.author.first_name} ${message.author.last_name}`.trim(),
      teammateId: message.author.id
    }
  }
  
  // INBOUND = usually from customer, but could be internal
  const fromRecipient = message.recipients.find(r => r.role === 'from')
  const email = fromRecipient?.handle || 'unknown'
  
  // Check if this "inbound" is actually from a teammate (internal email)
  if (teammateEmails.has(email.toLowerCase())) {
    return {
      type: 'teammate',  // Instructor emailing support directly
      email,
      name: fromRecipient?.name
    }
  }
  
  return {
    type: 'customer',
    email,
    name: fromRecipient?.name
  }
}
```

### Implementation

1. **On startup / cache refresh:**
   - Call `front.teammates.list()`
   - Build `Map<email, Teammate>` for lookup
   - Cache for 5 minutes (like app registry)

2. **Per message:**
   - Use `is_inbound` + `author` to determine type
   - Match `author.id` against `app.instructorTeammateId` for instructor detection

3. **Thread-level signals:**
   ```typescript
   interface ThreadAuthorSignals {
     hasInstructorMessage: boolean    // Instructor participated
     hasTeammateMessage: boolean      // Any teammate (support/agent)
     instructorIsAuthor: boolean      // Thread started BY instructor
     isInternalThread: boolean        // Only teammates, no customers
   }
   ```

### App Config (already exists)

```sql
-- AppsTable already has this column
instructor_teammate_id VARCHAR(255)  -- e.g., "tea_abc123" for Matt
```

### Edge Cases

| Scenario | Detection | Classification |
|----------|-----------|----------------|
| Matt emails support about a banger quote | `is_inbound=true`, email in `teammateEmails` | `instructor_strategy` |
| Customer replies to Matt's email | `is_inbound=true`, email NOT in `teammateEmails` | normal support |
| Support agent replies to customer | `is_inbound=false`, `author.id` != `instructorTeammateId` | (outbound, not classified) |
| Matt forwards fan mail thread | Thread has instructor message | may need special handling |

---

## Open Questions

1. **Thread freshness:** Should we re-classify old threads when new messages arrive, or cache classification?
2. **Partial threads:** What if we only have the latest N messages (API limit)?
3. ~~**Instructor detection:**~~ ✅ Solved - use `author.id` vs `instructorTeammateId` + teammate email cache
4. **Resolution confidence:** "thanks" could be sarcastic. How confident do we need to be?

---

## Success Criteria

### Must Have
- [ ] Thread-based `ClassifyInput` type
- [ ] Classifier sees full thread context
- [ ] Fixtures are thread-shaped
- [ ] 90%+ thread-level classify accuracy

### Should Have
- [ ] Resolution detection (90%+)
- [ ] Instructor strategy category working
- [ ] Backwards compatible with single-message threads

### Nice to Have
- [ ] Thread summarization for very long threads (10+ messages)
- [ ] Stale thread detection (awaiting reply for 7+ days)
- [ ] Thread velocity signals (rapid back-and-forth vs slow)

---

## Eval Results (2026-01-24)

### LLM Classification Results

**Dataset:** 130 labeled production threads

**First run (45 scenarios, v2 labels):**
- 46.7% accuracy (labels were wrong, not classifier)
- fan_mail vs spam confusion due to mislabeling

**After proper labeling (60 scenarios):**
- 81.7% accuracy
- fan_mail: 96%
- spam: 95%
- support_access: 50% (some labeled as access were actually resolved)

**Key findings:**
1. **LLM beats regex for nuance** - fan_mail vs spam distinction requires understanding intent
2. **Thread state matters** - Many "failures" were LLM correctly identifying resolved threads
3. **Labeling quality is critical** - Most accuracy gains came from fixing labels, not tuning classifier

### Category vs State (Design Decision Needed)

The eval reveals a conceptual issue: **thread state** and **request type** are orthogonal:

| Request Type | Thread State |
|--------------|--------------|
| support_access | open / resolved / awaiting_customer |
| support_refund | open / resolved / awaiting_customer |
| etc. | etc. |

Current categories mix these. Options:

**Option A: State as category** (current)
- Categories: resolved, awaiting_customer, support_access, etc.
- A resolved refund thread is `resolved`, not `support_refund`
- Simpler for routing (what action now?)

**Option B: Separate state field**
- Category: what the thread is about (access, refund, etc.)
- State: thread state (open, resolved, awaiting)
- Better for analytics, requires schema change

**Recommendation:** Keep Option A for v3. The classifier's job is "what should we do now?" A resolved thread → silence, regardless of what it was about. Track original category in logs if needed for analytics.

### Prompt Improvements

Added to classifier prompt:
```
Critical Distinctions:
- fan_mail vs spam: Is the person SELLING something? → spam. 
  Sharing their journey/interests? → fan_mail.
  "Big fan" + business pitch → spam (the "fan" is a hook)
  "Big fan" + personal journey → fan_mail
```

### Fast Path Simplification

**2026-01-25 Update: Complete removal of category regex patterns**

Joel's directive: "the regex fuckin sucks... remove it entirely and we will use classifiers for everything"

**Problem:** Fast-path regex for categories like billing, refund, and access was too aggressive:
- `support_refund` → misclassified as billing (mentioned invoice)
- `resolved` → misclassified as billing (contained "receipt" in context)
- Accuracy plateaued at 74% with regex catching the wrong cases

**Solution:** Fast path now handles ONLY thread state, not content classification:

| Fast Path Handles | Why |
|-------------------|-----|
| `system` | Sender is no-reply/noreply, no commercial intent |
| `resolved` | Thread structure: we responded + customer confirmed explicitly |
| `awaiting_customer` | Thread state: our last message is outbound |
| `instructor_strategy` | Author metadata: instructor started thread |

| LLM Handles | Why |
|-------------|-----|
| All `support_*` categories | Nuanced intent detection (billing vs refund vs access) |
| `fan_mail` vs `spam` | Distinguishing appreciation from commercial pitch |
| `voc_response` | Detecting reply-to-automation requires context |

**Code change:** `fastClassifyThread()` in `classify.ts` reduced from ~60 lines of regex to ~40 lines of pure thread-state logic.

**Tradeoffs:**
- ✅ Simpler, more maintainable code
- ✅ No more regex whack-a-mole for edge cases
- ✅ LLM handles nuance better (billing vs refund distinction)
- ⚠️ Slightly higher latency (more LLM calls)
- ⚠️ Higher cost per classification (but accuracy matters more)

**Signal extraction remains:** The `thread-signals.ts` file still extracts signals (hasEmailInBody, hasPurchaseDate, etc.) — these are passed to the LLM as context, not used for fast-path routing.

---

## State-Aware Few-Shot Dataset

### Concept

Resolved threads are **ground truth** — we know the outcome, so we can work backwards to extract decision points and patterns. Instead of hand-crafting few-shot examples, we **disassemble real resolved threads** into training examples.

### What We Extract

From each resolved thread:

1. **Signal extraction examples** — "Given this message, these are the signals"
   - Input: raw message/thread
   - Output: detected signals (verified by outcome)

2. **Action selection examples** — "Given these signals + context, this was the correct action"
   - Input: signals + thread state
   - Output: action taken that led to resolution

3. **Response patterns** — "For this action type, this tone/structure worked"
   - Input: situation (refund, access, etc.)
   - Output: response that resolved the issue

### Why Resolved Threads Work

| Advantage | Explanation |
|-----------|-------------|
| Ground truth | Resolution status is explicit, not inferred |
| Full trajectory | We see every decision point that led to success |
| Natural distribution | Examples match real support patterns |
| Action verification | We know the action worked (customer confirmed) |

### Extraction Process

```typescript
interface ResolvedThreadExample {
  // Source
  threadId: string
  resolutionType: 'customer_confirmed' | 'issue_fixed' | 'refund_completed'
  
  // Extracted examples
  signalExamples: Array<{
    messageIndex: number
    inputMessage: string
    expectedSignals: Partial<ThreadSignals>
  }>
  
  actionExample: {
    threadState: ThreadState
    signals: ThreadSignals
    correctAction: RouteAction
    actionResult: 'resolved' | 'escalated' | 'continued'
  }
  
  responseExample?: {
    category: MessageCategory
    customerMessage: string
    agentResponse: string
    resolutionConfirmed: boolean
  }
}
```

### Resolution Detection

How to identify resolved threads:

```typescript
const resolutionSignals = {
  // Explicit confirmation
  customerPhrases: [
    'that worked', 'thanks', 'all set', 'perfect', 
    'got it', 'appreciate it', "you're the best"
  ],
  
  // Implicit resolution
  threadPatterns: {
    agentResponseThenSilence: true,  // We replied, no follow-up for 48h+
    refundProcessed: true,            // Refund action completed in logs
    accessGranted: true               // Access restored + no follow-up
  },
  
  // Front status
  frontStatus: ['archived', 'resolved']  // Explicit close by teammate
}
```

### Few-Shot Template

```markdown
## Example: Access Issue Resolution

**Customer:** "I can't access my course anymore"
**Signals detected:** hasAccessIssue, noRecentPurchase, returningCustomer
**Action:** respond (gather context first)

**Agent:** "I've refreshed your access. Try logging out and back in."
**Customer:** "That worked, thanks!"

**Outcome:** resolved (customer confirmed)
---

## Example: Refund with Clarification

**Customer:** "I want a refund"
**Signals detected:** explicitRefundRequest, hasActivePurchase
**Action:** respond (ask for reason)

**Agent:** "Happy to help. Can you share what's not working for you?"
**Customer:** "Just don't have time right now"
**Action:** process_refund

**Outcome:** resolved (refund completed)
```

### Build Script: `scripts/build-fewshot-from-resolved.ts`

```bash
# Extract few-shot examples from resolved threads
pnpm tsx scripts/build-fewshot-from-resolved.ts \
  --min-confidence 0.8 \
  --output fixtures/fewshot/resolved-examples.json

# Filter by category
pnpm tsx scripts/build-fewshot-from-resolved.ts \
  --category support_refund \
  --limit 20
```

### Integration with Classifier

The classifier prompt would include dynamically-selected few-shot examples:

```typescript
async function buildClassifierPrompt(thread: Thread): Promise<string> {
  // Get similar resolved threads for few-shot
  const examples = await getFewShotExamples({
    category: predictedCategory(thread),  // Rough guess from signals
    limit: 3
  })
  
  return `
${BASE_CLASSIFIER_PROMPT}

## Examples from resolved threads:
${examples.map(formatExample).join('\n---\n')}

## Current thread to classify:
${formatThread(thread)}
`
}
```

---

## VOC (Voice of Customer) Handling

### Overview

VOC responses are replies to our automated outreach (email sequences, surveys, course check-ins). These aren't support requests—they're **valuable customer intelligence**:

- Sentiment signals about courses/products
- Testimonial candidates for marketing
- Feature feedback and suggestions
- Obstacles/blockers to address
- Content ideas for future courses

**Key insight:** VOC responses were previously classified as `fan_mail` or `support_technical` and silenced. Now we recognize them as a distinct category deserving special handling.

### Route Action: `catalog_voc`

Instead of `silence`, VOC responses trigger `catalog_voc` which:

1. **Analyze** - Classify sentiment and extract themes
2. **Catalog** - Store in searchable VOC library
3. **Notify** - Post to Slack for visibility
4. **Expand** (conditional) - Request testimonial expansion for compelling quotes

### VOC Sentiment Classification

```typescript
type VocSentiment = 
  | 'voc_positive'              // Praise, success stories, "loving it"
  | 'voc_feedback'              // Suggestions, critiques, feature requests
  | 'voc_blocker'               // "Too busy", "haven't started", obstacles
  | 'voc_testimonial_candidate' // Compelling quotes worth expanding
```

**Classification signals:**

| Sentiment | Signals | Examples |
|-----------|---------|----------|
| `voc_positive` | Gratitude, success language, enthusiasm | "Your course changed how I think about TS" |
| `voc_feedback` | Suggestions, "would be nice", feature asks | "I'd love to see more on generics" |
| `voc_blocker` | Time constraints, obstacles, hesitation | "Been too busy to start", "Not sure where to begin" |
| `voc_testimonial_candidate` | Specific results, quotable, story arc | "Went from confused to shipping production TS in 2 weeks" |

### VOC Analysis Schema

```typescript
interface VocAnalysis {
  sentiment: VocSentiment
  confidence: number
  themes: string[]              // ["course_quality", "time_constraints", "ai_interest"]
  quotableExcerpt?: string      // Best quote for testimonial use
  shouldRequestExpansion: boolean
  expansionReason?: string      // Why this is worth following up
}
```

### Slack Notification

Post to `#voc-responses` (or configured channel):

```
📣 New VOC Response

**Sentiment:** 🎉 Positive (testimonial candidate)
**From:** [EMAIL]
**Source:** AI Hero survey response

> "Vibe coding with AI has changed everything. I can move from an idea 
> to a preview environment in minutes. Software is having its 
> 'horse to engine' moment."

**Themes:** #ai-adoption #productivity #testimonial-candidate
**Action:** Requesting expansion for testimonial use

[View in Front →]
```

Slack message includes:
- Sentiment emoji (🎉 positive, 💡 feedback, ⏰ blocker, ⭐ testimonial)
- Customer email (for lookup)
- Quotable excerpt
- Themes as hashtags
- Link to Front conversation

### Expansion Request

For `voc_testimonial_candidate` responses, optionally send a follow-up:

**Trigger conditions:**
- Sentiment = `testimonial_candidate` with confidence > 0.8
- Contains specific results/outcomes
- Story has clear before/after arc
- Not already expanded in last 30 days

**Template:**

```
Hi {name},

Thanks so much for sharing that with us! Your experience really resonated.

Would you be open to sharing a bit more about your journey? We'd love to 
feature your story (with your permission) to help others see what's possible.

No pressure at all—just reply if you're interested.

Best,
{instructor}
```

### VOC Catalog/Library

Store VOC responses in a searchable catalog:

**Storage options:**
1. **Database table** (preferred) - `voc_responses` in existing Postgres
2. **Front tags** - Tag conversations with VOC metadata
3. **Notion database** - For marketing team access

**Schema:**

```sql
CREATE TABLE voc_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR(255) NOT NULL,
  app_id VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255),
  
  -- Analysis
  sentiment VARCHAR(50) NOT NULL,
  confidence FLOAT NOT NULL,
  themes TEXT[],
  quotable_excerpt TEXT,
  
  -- Expansion
  expansion_requested BOOLEAN DEFAULT FALSE,
  expansion_sent_at TIMESTAMP,
  expansion_response TEXT,
  testimonial_approved BOOLEAN,
  
  -- Metadata
  source_campaign VARCHAR(255),  -- Which email sequence triggered this
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Full content for search
  full_message TEXT NOT NULL
);

CREATE INDEX idx_voc_sentiment ON voc_responses(sentiment);
CREATE INDEX idx_voc_themes ON voc_responses USING GIN(themes);
CREATE INDEX idx_voc_app ON voc_responses(app_id);
```

### Pipeline Step: `catalog_voc`

New pipeline step that runs when `action = 'catalog_voc'`:

```typescript
interface CatalogVocInput {
  conversationId: string
  appId: string
  messages: ThreadMessage[]
  classification: ThreadClassifyOutput
}

interface CatalogVocOutput {
  analysis: VocAnalysis
  cataloged: boolean
  catalogId?: string
  slackNotified: boolean
  expansionRequested: boolean
}

async function catalogVoc(input: CatalogVocInput): Promise<CatalogVocOutput> {
  // 1. Analyze sentiment and themes
  const analysis = await analyzeVocResponse(input.messages)
  
  // 2. Store in catalog
  const catalogId = await storeVocResponse({
    conversationId: input.conversationId,
    appId: input.appId,
    ...analysis,
    fullMessage: input.messages.map(m => m.body).join('\n---\n')
  })
  
  // 3. Notify Slack
  await notifySlack({
    channel: '#voc-responses',
    analysis,
    conversationId: input.conversationId
  })
  
  // 4. Maybe request expansion
  let expansionRequested = false
  if (shouldRequestExpansion(analysis)) {
    await sendExpansionRequest(input.conversationId, input.appId)
    expansionRequested = true
  }
  
  return {
    analysis,
    cataloged: true,
    catalogId,
    slackNotified: true,
    expansionRequested
  }
}
```

### Reporting & Analytics

VOC catalog enables:

1. **Sentiment trends** - Track positive/negative over time
2. **Theme clustering** - What topics come up most
3. **Testimonial pipeline** - Queue of expansion candidates
4. **Blocker patterns** - Common obstacles to address
5. **Campaign effectiveness** - Which sequences get best responses

### Implementation Phases

**Phase 1: Basic Catalog** (MVP)
- [x] Add `voc_response` category
- [x] Add `catalog_voc` route action
- [ ] Create `voc_responses` database table
- [ ] Basic Slack notification (no analysis)
- [ ] Store raw responses

**Phase 2: Analysis**
- [ ] VOC sentiment classification prompt
- [ ] Theme extraction
- [ ] Quotable excerpt extraction
- [ ] Rich Slack notifications with analysis

**Phase 3: Expansion**
- [ ] Expansion request logic
- [ ] Template management
- [ ] Response tracking
- [ ] Testimonial approval workflow

**Phase 4: Analytics**
- [ ] Sentiment dashboard
- [ ] Theme trends
- [ ] Testimonial pipeline view
- [ ] Integration with marketing tools

---

## Appendix: Migration Path

**Existing fixtures:**
```typescript
// Before
{ subject: "...", body: "...", ... }

// After  
{ 
  conversationId: "synthetic_123",
  messages: [{ direction: "in", body: "...", subject: "...", timestamp: Date.now() }]
}
```

**Existing evals:**
- Add `--legacy` flag to run single-message mode
- Default to thread mode
- Track both metrics during transition

**Classifier prompt:**
- Keep v2 prompt as fallback
- Thread prompt extends v2 with thread context section
- A/B test during rollout
