# Enhancement Ideas (Draft PRD)

> Captured from initial e2e testing. Ideas for improving agent quality and capabilities.

## Immediate Fixes

### 1. From Name in Drafts
**Problem:** Drafts show "Badass Support" instead of product name (e.g., "Total TypeScript Team").

**Options:**
- A. Update Front API user's display name per-inbox (Front config, not code)
- B. Create teammate aliases per product, pass `author_id` to draft creation
- C. Use inbox name in greeting/signature instead of relying on From header

**Recommendation:** Option A is simplest - update the Front API token user's display name in Front settings.

### 2. Response Verbosity
**Status:** Fixed in `e02c428` - updated system prompt for brevity.

**Future:** Could tune per-product (Matt's TT audience expects different tone than Pro Tailwind).

---

## Phase: Knowledge Retrieval (Vector Search)

### Product Content RAG

**Goal:** Agent can reference actual course content, lessons, and resources when answering questions.

**Data Sources:**
- Lesson transcripts (MDX content)
- Module/section descriptions
- FAQ content
- Changelog/release notes
- Product-specific terminology glossary

**Implementation:**
```
1. Content ingestion pipeline
   - Fetch content from each app via SDK integration
   - Chunk appropriately (by lesson, section, semantic boundaries)
   - Embed and store in Upstash Vector with metadata (appId, contentType, lessonId)

2. Retrieval at query time
   - Search vector store scoped to appId
   - Return top-k relevant chunks
   - Inject into agent context

3. Citation tracking
   - Track which chunks influenced the response
   - Optionally link to specific lessons in response
```

**Effort:** Medium (2-3 days)

### Properties/Purchase Context

**Goal:** Agent knows what the customer owns, their purchase history, license status.

**Current State:** `lookupUser` tool fetches via SDK integration, but not always called.

**Improvements:**
- Auto-fetch user context before agent runs (not tool-based)
- Include in system prompt: "Customer owns: Total TypeScript Pro, purchased 2024-01-15"
- Query Stripe Connect for payment status, failed charges, subscription state

**Effort:** Low (already have the plumbing, just need to wire it up)

---

## Phase: Canned Responses

**Goal:** Common questions get instant, pre-approved responses.

**Examples:**
- "How do I access my course?" → Magic link + instructions
- "Can I get a refund?" → Policy + process refund (if eligible)
- "Is there a team license?" → Team pricing info

**Implementation:**
```
1. Canned response registry
   - YAML/JSON definitions with:
     - trigger patterns (intent classification)
     - response template
     - required variables (e.g., {{customerName}})
     - auto-send eligibility

2. Classifier integration
   - Before running full agent, classify message
   - If high-confidence canned match, use template
   - Fallback to full agent for low confidence

3. Template engine
   - Simple variable interpolation
   - Conditional sections based on customer state
```

**Effort:** Medium (1-2 days)

---

## Phase: Per-Product Personas

**Goal:** Each product has its own voice, knowledge, and style.

**Components:**
- Product-specific system prompt extensions
- Creator voice/tone guidelines (Matt Pocock vs Simon Vrachliotis)
- Product-specific FAQ and common issues
- Custom tools per product (e.g., TT has type challenges, Pro Tailwind has design tokens)

**Implementation:**
```typescript
// app-registry stores persona config
{
  slug: 'total-typescript',
  persona: {
    voiceGuidelines: 'Technical but approachable. Matt\'s teaching style.',
    signatureStyle: 'Best,\nThe Total TypeScript Team',
    commonIssues: ['type narrowing confusion', 'generic constraints', ...]
  }
}
```

**Effort:** Low (config-driven, system prompt injection)

---

## Phase: Proactive Suggestions

**Goal:** Agent suggests actions the human might want to take.

**Examples:**
- "This customer has asked about refunds twice. Consider reaching out proactively."
- "Customer mentioned they're struggling with generics. Link to Module 4?"
- "This thread has 5+ messages. Might need escalation."

**Implementation:**
- Post-response analysis step
- Pattern detection on conversation history
- Slack notification with suggested actions

**Effort:** Medium

---

## Phase: Feedback Loop & Learning

**Goal:** Human corrections improve future responses.

**Current State:** Rating buttons in Slack (thumbs up/down) update trust score.

**Improvements:**
- Capture edited responses as training signal
- "Why did you change this?" prompt for major edits
- Store (question, original_response, edited_response) tuples
- Use for prompt tuning and eval dataset

**Effort:** Medium-High

---

## Phase: Multi-Turn Context

**Goal:** Agent maintains context across conversation, not just current message.

**Current State:** Conversation history passed to agent, but not deeply utilized.

**Improvements:**
- Summarize long threads before passing to agent
- Track "open issues" in conversation (unanswered questions)
- Detect when conversation has gone off-track
- Suggest closure when all issues resolved

**Effort:** Medium

---

## Phase: Slack Thread Feedback

**Goal:** Reply to Slack draft notifications to steer the AI or suggest edits.

**User Flow:**
1. AI posts draft notification to Slack with Good/Bad buttons
2. User replies in thread: "make it shorter" or "add info about team licenses"
3. AI regenerates response with that guidance
4. New draft posted to thread and updated in Front

**Implementation:**
```
1. Track Slack message ts when posting draft notifications
2. Subscribe to Slack Events API for `message` events
3. Filter for thread replies to our messages (thread_ts matches our ts)
4. Extract feedback text from reply
5. Re-run agent with original context + feedback as additional instruction
6. Update/replace draft in Front
7. Post regenerated draft to Slack thread
```

**Slash Commands (future):**
- `/regenerate` - try again with same context
- `/shorter` - regenerate with brevity constraint
- `/escalate` - cancel draft and flag for human

**Effort:** Medium (2-3 days)

---

## Quick Wins (< 1 day each)

1. **Greeting detection** - Skip drafting for "Thanks!" / "Got it!" messages
2. **Duplicate detection** - Don't respond to copy-pasted messages
3. **Language detection** - Flag non-English for human (or use translation)
4. **Attachment handling** - Note when customer attached files, suggest viewing
5. **Link validation** - Ensure any links in response are valid/current

---

## Metrics to Track

- **Coverage:** % of messages getting auto-draft (target: 80%)
- **Edit rate:** % of drafts edited before sending (target: <30%)
- **Send rate:** % of drafts sent without edit (target: >50%)
- **Time to draft:** Webhook → draft created (target: <30s)
- **Customer satisfaction:** Reply sentiment, thread resolution rate

---

## Priority Order (Suggested)

1. Properties/Purchase Context (low effort, high value)
2. Canned Responses (medium effort, high volume reduction)
3. Product Content RAG (medium effort, quality improvement)
4. Per-Product Personas (low effort, brand consistency)
5. Feedback Loop (medium effort, continuous improvement)
