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

## Phase: Front Message Templates (Canned Responses)

**Goal:** Common questions get instant, pre-approved responses using Front's native template system.

**Why Front Templates:**
- No custom DB/storage needed
- Support team edits templates directly in Front UI
- Templates visible during manual replies
- Folders = organization by product/inbox
- API for programmatic access and creation

**Front API:**
- `GET /message_template_folders` - List folders
- `GET /inboxes/:inbox_id/message_templates` - List templates per inbox
- `POST /inboxes/:inbox_id/message_templates` - Create template

**Folder Structure:**
```
inb_total-typescript/
  refund/
    - within-30-days
    - after-30-days
  billing/
    - invoice-request
    - payment-failed
  access/
    - login-link
    - course-access
```

**Template Selection Options:**

1. **Classifier outputs template name** - Train classifier on template names
2. **Semantic search** - Index template content in vector store, find best match
3. **Folder = category** - Classifier picks category, we pick from that folder

**Implementation:**
```
1. Add to Front client
   - listMessageTemplates(inboxId)
   - listFolders()
   - createMessageTemplate(inboxId, template)

2. Cache templates per inbox
   - Refresh on schedule or webhook
   - Index in vector store for semantic matching

3. Wire to classifier
   - Classifier says "canned_response"
   - Match to template via name, folder, or embedding
   - Send via draft API
```

**Effort:** Medium (1-2 days)

---

## Phase: "Save as Template" HITL Flow

**Goal:** Template library grows organically from actual good responses.

**User Flow:**
1. Agent drafts response
2. Slack shows: `[Approve & Send]` `[Save as Template]` `[Edit]` `[Reject]`
3. "Save as Template" → prompts for name, auto-selects folder based on category
4. `POST /inboxes/:inbox_id/message_templates` creates it in Front
5. Response is also sent to customer
6. Future similar messages match that template

**Template Opportunity Detection:**
- Track response embeddings
- Notice clusters: "5 similar responses this week"
- Surface to reviewer: "This pattern could be a template"
- One-click templatize from Slack

**Implementation:**
```
1. Add "Save as Template" button to Slack approval blocks
2. Modal or thread reply for template name
3. Auto-suggest folder based on classifier category
4. Create template via Front API
5. Optionally index in vector store immediately
```

**Effort:** Low-Medium (1 day)

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

## Phase: Outbound Message Analysis

**Goal:** Learn from human responses captured via Front webhooks.

**Key Insight:** Front webhooks capture outbound messages too. Human responses = ground truth.

**What We Get:**
- What humans actually write (not just what agent proposed)
- Diff between agent draft vs. what human sent = learning signal
- Clusters of similar human responses = template candidates
- Topics humans handle that agent doesn't = capability gaps

**Data Flow:**
```
inbound → agent drafts → human edits → outbound captured
                              ↓
                    compare draft vs sent
                              ↓
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
        high similarity  low similarity  repeated pattern
        (agent was right) (learn from human) (templatize)
```

**Implementation:**
```
1. Index outbound messages
   - Store in vector DB with metadata (appId, category, conversationId)
   - Link to original inbound and agent draft if available

2. Draft vs. Sent comparison
   - On outbound webhook, check if we drafted for this conversation
   - Compute similarity (embedding distance or token overlap)
   - Log as training signal

3. Pattern detection
   - Periodic job to cluster similar outbound messages
   - Surface clusters with 3+ similar responses
   - Suggest as template candidates via Slack notification

4. Trust scoring integration
   - High edit rate for category = lower trust
   - Consistent approval = higher trust
   - Feed into auto-send thresholds
```

**Use Cases:**
- "Find human responses similar to this inbound" → few-shot examples for agent
- "What do humans say about refunds?" → tune prompts
- "5 similar responses this week" → templatize
- "Humans always rewrite billing responses" → agent needs work there

**Effort:** Medium (2-3 days)

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
2. Front Message Templates (medium effort, high volume reduction, no custom storage)
3. "Save as Template" HITL (low effort, grows template library organically)
4. Product Content RAG (medium effort, quality improvement)
5. Outbound Message Analysis (medium effort, self-improving system)
6. Per-Product Personas (low effort, brand consistency)
7. Feedback Loop (medium effort, continuous improvement)
