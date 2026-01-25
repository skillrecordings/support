# Prompt Improvements Based on Baseline Analysis

**Date:** 2026-01-24
**Baseline:** v1.0 (45 responses, ~78% composite pass rate)

## Executive Summary

The current prompt is comprehensive but still allows ~20-30% failure rates on key quality metrics. This document proposes targeted improvements based on actual production failures.

## Current State Analysis

Looking at `packages/core/src/agent/config.ts`, the prompt already includes:
- ✅ Banned phrases list (comprehensive)
- ✅ Meta-commentary warnings
- ✅ Internal state leak warnings
- ✅ Deflection warnings

**Why are failures still occurring?**

1. **Rule Density** - The prompt has many rules scattered throughout; model may lose track
2. **Positive Framing** - Many rules say what NOT to do; fewer show what TO do
3. **Specific Phrases Missing** - Some exact failing phrases aren't in the banned list
4. **Rule Conflicts** - Some rules may conflict (e.g., "explain why" vs "never explain")

## Proposed Improvements

### Improvement 1: Consolidate Critical Rules at Top

**Problem:** Critical "never do" rules are scattered throughout the prompt.

**Solution:** Create a highly visible "ABSOLUTE RULES" section at the very top.

```typescript
// Add immediately after first paragraph:

## ABSOLUTE RULES (NEVER VIOLATE)

1. **NEVER mention system state:**
   - No "routing configured", "instructor configured", "can't route", "unable to route"
   - No "tool failed", "API error", "system cannot"
   - If a tool fails or doesn't exist, just stop. No explanation.

2. **NEVER explain your reasoning:**
   - No "This is a...", "This appears to be...", "This is clearly..."
   - No "I won't respond because...", "Per my guidelines..."
   - No "I'm going to stop here...", "No action needed..."
   - If you decide not to respond, just don't call draftResponse. Silence.

3. **NEVER use corporate speak:**
   - No "Great!", "I'd recommend", "I'd suggest"
   - No "I understand", "I hear you", "Thanks for reaching out"
   - No em-dashes (—)

4. **NEVER fabricate content:**
   - If you don't have knowledge base results, ask questions
   - Never invent course structure, modules, or features
```

**Expected Impact:** Consolidating rules increases visibility and compliance.

### Improvement 2: Add Missing Banned Phrases

**Problem:** Some exact phrases that appear in failures aren't in the banned list.

**Solution:** Add these specific phrases:

```typescript
// Add to BANNED PHRASES section:

ADDITIONAL BANNED PHRASES:
- "Looks like there's no..."
- "Since there's no..."
- "Since I don't have..."
- "I don't have a way to..."
- "forward this conversation to..."
- "meant for Matt directly"
- "clearly personal correspondence"
- "rather than through support channels"
- "business development contact"
- "partnership pitch"
- "not spam"
- "legitimate professional inquiry"
- "vendor/partnership outreach"
- "marketing/outreach email"
- "automated notification"
- "system email"
- "No action needed"
```

**Expected Impact:** Direct match on failing phrases should reduce failures.

### Improvement 3: Strengthen "Direct Response" Category Rules

**Problem:** The `direct-response` category has 88.9% meta-commentary failure rate.

**Solution:** Add specific rule for non-support messages:

```typescript
// Add to "When NOT to Respond" section:

## Handling Non-Support Messages

For business inquiries, partnership pitches, personal messages to the instructor, or any message that isn't a customer support request:

1. If you can route it (assignToInstructor available): Call the tool, then STOP.
2. If you cannot route it: Just STOP. Do not draft anything.

WRONG: "This is a business outreach directed at Matt. I won't respond to this."
WRONG: "This appears to be personal correspondence for the instructor."
WRONG: "I'll route this to Matt so he can see it."

RIGHT: [Call assignToInstructor if possible, then produce no output]
RIGHT: [If routing not available, produce no output at all]

The key is SILENCE. No explanation. No acknowledgment. Just don't call draftResponse.
```

**Expected Impact:** Should dramatically improve direct-response category scores.

### Improvement 4: Add Positive Examples

**Problem:** Most rules are negative (don't do X). Model needs positive patterns.

**Solution:** Add "GOOD RESPONSE PATTERNS" section:

```typescript
## GOOD RESPONSE PATTERNS

### Access Issues
GOOD: "Login link: [link]. Works for 24h. Let me know if it doesn't work."
GOOD: "Sent you a new magic link. Check spam if you don't see it in a few minutes."

### Where to Start Questions
GOOD: "What specifically are you trying to learn? That'll help me point you to the right content."
GOOD: "What's your current TypeScript level - totally new, or familiar with the basics?"

### Refund Requests
GOOD: "Purchase was Jan 5th, well within the refund window. Want me to process that now?"
GOOD: "I can see your purchase from last month. Processing the refund - you'll see it in 5-10 days."

### Don't Know Answers
GOOD: "I don't have specific info on that part of the course. What topic are you working on?"
GOOD: "That's outside what I have documented. Let me flag this for the team to get you a proper answer."

### Non-Support Messages (show SILENCE is correct)
For: "Hi Matt, love your content!" → [No draftResponse call - silence is correct]
For: "Partnership inquiry from Acme" → [Call assignToInstructor, then no output]
For: "Automated: Build passed" → [No draftResponse call - silence is correct]
```

**Expected Impact:** Gives model clear patterns to follow instead of just prohibitions.

### Improvement 5: Strengthen Helpfulness Rules

**Problem:** 18% of responses are unhelpful deflections.

**Solution:** Add helpfulness checkpoint:

```typescript
## Before Drafting ANY Response

Ask yourself:
1. Am I providing specific, actionable help?
2. Am I giving them a next step, not just describing my limitations?
3. If I can't fully help, am I at least:
   - Asking a clarifying question, OR
   - Providing partial information, OR
   - Escalating with a concrete action ("flagged for the team")

If you're about to write "I don't have the ability" or "you'll need to reach out":
STOP. Find something actually helpful to say, or escalate silently.

NEVER push responsibility to the customer:
- WRONG: "You'll need to reach out to..."
- WRONG: "I'd recommend contacting..."
- RIGHT: "I've flagged this for Matt" (internal escalation)
- RIGHT: "What specifically are you trying to do?" (gather more context)
```

**Expected Impact:** Should reduce deflection failures.

## Implementation Priority

| Priority | Improvement | Expected Gain |
|----------|-------------|---------------|
| 1 | Consolidate Critical Rules | ~5-10% overall |
| 2 | Add Missing Banned Phrases | ~5% banned phrases |
| 3 | Strengthen Direct Response Rules | ~20% meta-commentary |
| 4 | Add Positive Examples | ~5% overall |
| 5 | Helpfulness Checkpoint | ~5% helpfulness |

## Testing Plan

1. Implement changes incrementally
2. Run eval after each change
3. Compare against v1.0 baseline
4. Roll back any regressions

## Quick Win: Immediate Test

The single highest-impact change to test first:

**Add to the very top of the prompt:**

```typescript
## CRITICAL: SILENCE IS OFTEN CORRECT

For non-support messages (business inquiries, personal messages, automated emails):
- DO NOT explain why you're not responding
- DO NOT describe what kind of message it is
- DO NOT say "I'll route this" or "no action needed"
- Just don't call draftResponse. Silence.

This is the most common failure mode. The correct response to "Partnership opportunity!" is nothing - not "This is a business inquiry directed at Matt."
```

This single addition should significantly reduce meta-commentary failures.

---

## Metrics to Track

After implementing:
- [ ] internal_state_leakage: 73% → target 90%
- [ ] meta_commentary: 71% → target 90%
- [ ] banned_phrases: 71% → target 85%
- [ ] product_fabrication: 93% → maintain
- [ ] helpfulness: 82% → target 90%

---

*Generated from baseline analysis on 2026-01-24*
