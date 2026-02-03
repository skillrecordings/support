# Epic 6: Conversational Slack Support Bot

## Overview

Transform the Slack support bot from a notification-only system into a conversational teammate. Team members can @mention the bot or reply to its posts to query status, refine drafts, and trigger actions — all without leaving Slack.

## Why This Matters

1. **Lower friction** — Team supervises support in their natural workspace
2. **Every correction is training data** — Slack feedback feeds the learning loop (Epic 4)
3. **Conversational refinement** — "simplify this" / "add this link" iterates drafts naturally
4. **Proactive assistance** — Bot can surface urgent items without being asked

## Prerequisites

- Epic 2 (KB + RL Loop) — for context retrieval
- Epic 4 (Comment-Based Learning) — for correction capture (can be parallel)
- ✅ Existing Slack bot already running
- ✅ Per-product channels exist (instructor + internal team for each product)
- Channel-to-product mapping not yet configured (can be added later)

## Scope

### In Scope
- @mention handling in support channel
- Threaded reply handling (replies to bot's own messages)
- Status queries ("anything urgent?", "what's pending?")
- Draft refinement via conversation ("simplify", "add link X", "more formal")
- Quick actions ("approve and send", "escalate to [person]", "archive")
- Customer context lookup ("history with X@email.com")
- Conversation state per thread

### Out of Scope (Future)
- Multi-channel support (start with one channel)
- Voice/audio messages
- Proactive suggestions without being asked
- Full agent autonomy (always human-in-loop for sends)

## Acceptance Criteria

### 6.1 @Mention Handling
- [ ] Bot responds to @supportbot mentions in configured channel
- [ ] Mentions parsed for intent (query, action, feedback)
- [ ] Unknown intents get helpful "I can help with..." response
- [ ] Response posted in thread (not channel)

### 6.2 Status Queries
- [ ] "@supportbot anything urgent?" → lists unhandled urgent/high-priority items
- [ ] "@supportbot what's pending?" → summary of open items by category
- [ ] "@supportbot status" → quick health check (items handled today, pending, avg response time)
- [ ] Results include Front links for easy jump

### 6.3 Draft Refinement (Threaded)
- [ ] Reply to draft notification with feedback → bot revises draft
- [ ] Supports: "simplify", "more formal", "shorter", "add [link/info]", "mention [topic]"
- [ ] Revised draft posted in same thread
- [ ] "looks good" / "approve" triggers send (with confirmation)
- [ ] Refinement history tracked for learning (Epic 4 integration)

### 6.4 Quick Actions
- [ ] "approve and send" → sends current draft, archives conversation
- [ ] "escalate to [name]" → reassigns in Front, notifies person
- [ ] "needs more context" → adds internal note, keeps in queue
- [ ] "archive" / "close" → archives without sending
- [ ] Actions logged to Axiom

### 6.5 Customer Context
- [ ] "@supportbot history with X@email.com" → pulls prior conversations
- [ ] Shows: recent tickets, purchase history, prior issues
- [ ] "@supportbot who is X@email.com" → customer profile summary

### 6.6 Conversation State
- [ ] Each thread maintains conversation context
- [ ] Bot remembers what draft/customer is being discussed
- [ ] Context persists for reasonable window (1 hour? configurable)
- [ ] Clear handoff when thread goes stale

## Technical Implementation

### New Components
```
packages/slack/
  src/
    handlers/
      mention.ts        # @mention parser and router
      thread-reply.ts   # Reply handler for bot's messages
    intents/
      status.ts         # Status query handlers
      draft.ts          # Draft refinement logic
      action.ts         # Quick action handlers  
      context.ts        # Customer lookup
    state/
      thread-context.ts # Per-thread conversation state
```

### Integration Points
- **Front API** — conversation queries, draft updates, sends, assignments
- **KB/Memory** — customer history, prior interactions
- **Axiom** — action logging, refinement tracking
- **Epic 4** — correction capture from refinements

### Slack Events Needed
- `app_mention` — @supportbot in channel
- `message` (in thread) — replies to bot messages
- Bot must be in channel with appropriate scopes

## Validation

```bash
bun run check-types && bun run test
# Integration tests for Slack handlers
# E2E: @mention → response in thread
# E2E: draft refinement → updated draft
```

## Mandatory Agent Instructions

**All workers on Epic 6 stories MUST follow these patterns:**

### 1. Heavy High-Cardinality Axiom Logging
- Log EVERY significant event with structured fields
- Include: `traceId`, `conversationId`, `slackThreadTs`, `userId`, `intent`, `action`, `latencyMs`
- Observability designed for AGENTS to query, not human dashboards
- Forensic query toolkit IS the interface
- Pattern: `traceStepBoundary()` helper at every step.run() boundary

### 2. TDD Required
- Write tests FIRST before implementation
- RED → GREEN → REFACTOR cycle mandatory
- Characterization tests to document actual behavior (what IS) before behavior tests (what SHOULD)
- Pattern from memory: "Write 9 tests FIRST covering edge cases, then implement minimal code to pass"

### 3. Progress Check-ins via Moltbot CLI
- Report progress at meaningful milestones (not spam)
- Use: `moltbot send "Epic 6.X: [status] - [what's done] - [what's next]"`
- Frequency: start of work, major milestone, completion, blocker encountered
- Include: files touched, tests passing/failing, learnings

### 4. Check Memories Before Starting
```bash
swarm memory find "slack bot" --limit 5
swarm memory find "[specific feature]" --limit 5
```
- Query hivemind for past learnings on similar work
- Check for: prior implementations, gotchas discovered, patterns that worked/failed
- Don't repeat mistakes already captured in memory

### 5. Save Learnings to Memory on Completion
```bash
swarm memory store "Epic 6.X learning: [what you discovered]" --tags "epic6,slack,..."
```
- Capture: patterns discovered, gotchas found, decisions made and why
- Include: file paths involved, integration points, testing strategies that worked
- Future workers should benefit from your experience

### 6. Core Philosophy (from Oracle Context)
- **Accuracy first** — thorough, don't waste user's time
- **No glazing** — no fabricated LLM bullshit, glazing is worse than being terse
- **Corrections are gold** — every human edit is 10x learning signal
- **Data integrity first** — is the data right? Trace end-to-end before assuming it works
- **Designed for agents** — structured telemetry that coding agents can query

### 7. Worker Survival Checklist (9-step pattern)
1. `swarmmail_init` — coordinate with other workers
2. `hivemind_find` — query past learnings BEFORE starting work
3. Check relevant skills (`skills_list`, read SKILL.md files)
4. Reserve files if editing (`swarmmail_reserve`)
5. Write tests first (TDD)
6. Implement with high-cardinality logging
7. Checkpoint progress to Moltbot
8. Save learnings to hivemind on completion
9. Release file reservations (`swarmmail_release`)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Rate limits on Slack/Front APIs | Batch queries, cache customer data |
| Ambiguous user intent | Clarifying questions, "did you mean...?" |
| Stale thread context | Clear timeout, explicit "new topic" detection |
| Accidental sends | Confirmation step for all sends |

## Success Metrics

- **Adoption**: % of draft reviews done via Slack vs Front
- **Efficiency**: Time from draft → send (should decrease)
- **Learning**: # of corrections captured via Slack refinements
- **Satisfaction**: Team feedback on workflow

## Story Breakdown

1. **6.1** @Mention handling + basic routing
2. **6.2** Status queries (urgent, pending, health)
3. **6.3** Draft refinement in threads
4. **6.4** Quick actions (approve, escalate, archive)
5. **6.5** Customer context lookup
6. **6.6** Thread state management + Epic 4 integration

## Dependencies

```
Epic 2 (KB) ───► Epic 6 (Slack Conversational)
                        ↕ (complementary, not blocking)
                 Epic 4 (Learning)
```

**Epic 6 and Epic 4 are independent and complementary:**
- Neither blocks the other
- Both can feed functionality back and forth
- Slack corrections can inform Epic 4's learning system
- Epic 4's correction patterns can improve Slack refinement suggestions
- Build whichever is ready; integrate learnings as they emerge
