# Eval Analysis Report

**Date:** 2026-01-21
**Dataset:** 37 real agent responses from production
**Eval file:** `packages/core/src/evals/real-responses.eval.ts`

## Summary

- **Total samples:** 37
- **Overall pass rate:** 66% (composite across all scorers)
- **Total eval runs:** 69 (37 samples × 5 scorers, some samples evaluated multiple times)

### Pass/Fail by Scorer

| Scorer | Pattern Detected | Estimated Pass | Estimated Fail |
|--------|-----------------|---------------|---------------|
| **InternalStateLeakage** | "No instructor routing configured", "can't route this", "unable to route" | ~20/37 (54%) | ~17/37 (46%) |
| **MetaCommentary** | "I won't respond to this", "Per my guidelines", "This is clearly..." | ~20/37 (54%) | ~17/37 (46%) |
| **BannedPhrases** | "Great!", "I'd recommend", "Thanks for reaching out", em-dashes | ~27/37 (73%) | ~10/37 (27%) |
| **ProductFabrication** | "Start with the fundamentals section", "covers core concepts" | ~35/37 (95%) | ~2/37 (5%) |
| **Helpfulness** | Deflections vs. helpful indicators (ratio-based 0-1 score) | ~28/37 (76%) | ~9/37 (24%) |

**Note:** These are estimates based on visual inspection of the eval output. Exact counts require parsing the full evalite JSON results.

---

## Failure Patterns

### 1. InternalStateLeakage (46% failure rate)

**Pattern:** Agent exposes internal configuration state, routing decisions, or system limitations to customers.

#### Common Triggers

- **"No instructor routing configured"** - Most common leak (appears in ~15 responses)
- **"I can't route this"** / **"Unable to route"** - Exposes agent capabilities
- **"Looks like there's no..."** - Starts with diagnosis of internal state
- **"You'll want to reach out through..."** - Pushes routing responsibility to customer
- **"Should be routed to..."** - Explains internal forwarding logic

#### Example Failures

```
Input: "Personal correspondence to Matt about partnership opportunity"
Output: "No instructor routing configured for this app, so I can't forward it
that way. But wanted to flag that this seems like it's meant as personal
correspondence rather than a support request."

Root cause: Agent is explaining why it can't perform an action instead of
silently handling or escalating.
```

```
Input: "Partnership inquiry from Leonard Yu"
Output: "Looks like there's no instructor routing configured for this app.
Given that this is a partnership pitch directed at Matt personally rather
than a support issue, it should go to his personal inbox or business contact..."

Root cause: Multi-sentence explanation of internal routing configuration +
advice on external channels.
```

#### Recommended Fixes

1. **Negative instruction:** "Never mention internal routing configuration, tool failures, or system limitations to customers"
2. **Positive pattern:** When detecting non-support messages, silently suppress response (don't explain why)
3. **Fallback pattern:** If escalation is needed, use: "I've flagged this for the team" (no details about routing)

---

### 2. MetaCommentary (46% failure rate)

**Pattern:** Agent explains its own reasoning, guidelines, or decision-making process instead of just acting.

#### Common Triggers

- **"This is clearly..."** / **"This appears to be..."** - Agent diagnosing message type
- **"I won't respond to this. Per my guidelines..."** - Explaining refusal to act
- **"This isn't a support request, so I won't draft a response"** - Narrating decision
- **"This falls outside..."** - Defining scope boundaries
- **"Per my guidelines"** - Referencing internal rules

#### Example Failures

```
Input: "Business partnership pitch from Leonardo"
Output: "This is a business outreach/partnership pitch directed at Matt (the
instructor), not a customer support request. It's not spam—it's a legitimate
professional inquiry to the creator.

I won't respond to this. Per my guidelines, this should be routed directly
to Matt for personal correspondence, but since I don't have a conversation ID
from the system, I can't use assignToInstructor.

No action needed—this message will be handled through normal instructor
routing channels."

Root cause: Three-paragraph explanation of reasoning instead of silent handling.
```

```
Input: "Test/casual message from Joel"
Output: "This message is clearly not a customer support request — it's a
casual/joking message without any actual issue to resolve. Per my guidelines,
I should not draft a response to this.

If Joel has an actual support question or issue related to Total TypeScript,
I'm ready to help when he reaches out."

Root cause: Agent is narrating its decision not to respond instead of
remaining silent.
```

#### Recommended Fixes

1. **Negative instruction:** "Never explain your reasoning, guidelines, or decision-making process. Just act."
2. **Negative instruction:** "Never start responses with 'This is...' or 'This appears to be...'"
3. **Positive pattern:** When you decide not to respond, remain completely silent (no explanation)
4. **Positive pattern:** When escalating, use minimal language: "Flagged for the team" (no narrative)

---

### 3. BannedPhrases (27% failure rate)

**Pattern:** Corporate speak, fake enthusiasm, or AI-typical hedging language.

#### Common Triggers

- **"Great!"** - Fake enthusiasm starter (3+ instances)
- **"I'd recommend..."** / **"I'd suggest..."** - Hedging language (~5 instances)
- **"Thanks for reaching out"** / **"Thanks for sharing"** - Corporate pleasantries
- **"Is there a specific area you're curious about?"** - Generic follow-up
- **"I hear you"** / **"I understand"** - Empathy theater
- **"—"** (em-dash) - Stylistic marker of AI-generated text

#### Example Failures

```
Input: "How do I start learning TypeScript?"
Output: "Great! If you're just starting out with TypeScript, I'd recommend
beginning with the fundamentals..."

Root cause: Opens with "Great!" (fake enthusiasm) + "I'd recommend" (hedging)
```

```
Input: "Course feedback from Dan about documentation"
Output: "Thanks Dan, really glad you got through the course so quickly. Your
point about the frontend/backend setup makes sense - that `useChat` endpoint
behavior could definitely be documented more explicitly upfront..."

Root cause: "Thanks" + enthusiastic phrasing ("really glad")
```

#### Recommended Fixes

1. **Negative instruction:** "Never use: 'Great!', 'I'd recommend', 'I'd suggest', 'Thanks for reaching out', 'I hear you', 'I understand'"
2. **Negative instruction:** "No em-dashes (—). Use hyphens (-) or rephrase."
3. **Positive pattern:** Start with direct information: "To start TypeScript: [action]" (not "Great! I'd suggest...")
4. **Positive pattern:** Acknowledge feedback minimally: "Solid feedback. Matt will see this." (not "Thanks, really glad...")

---

### 4. ProductFabrication (5% failure rate)

**Pattern:** Agent invents course content, modules, or features that don't exist.

#### Common Triggers

- **"Start with the fundamentals section"** - Generic advice dressed as specific
- **"It covers core concepts like..."** - Fabricating curriculum details
- **"The course teaches..."** - Inventing structure

#### Example Failures

```
Input: "Where should I start in AI Hero?"
Output: "The knowledge base isn't returning results, but here's what I'd
suggest: Start with the fundamentals section in AI Hero. It covers core
concepts like how AI models work, prompt engineering basics, and common use
cases..."

Root cause: Knowledge base returned no results, but agent fabricated course
structure anyway.
```

#### Recommended Fixes

1. **Negative instruction:** "If you don't have course structure or content information, say so. Never invent modules, sections, or curriculum details."
2. **Positive pattern:** "I don't have the course structure. What specifically are you trying to learn?" (ask instead of fabricate)
3. **Tool requirement:** Ensure knowledge base retrieval is working before referencing specific content

---

### 5. Helpfulness (24% failure rate)

**Pattern:** Agent deflects instead of helping, or provides no actionable next steps.

#### Common Triggers

- **"I don't have the ability..."** - Capability limitation without workaround
- **"Reach out directly through..."** - Pushing customer to external channels
- **"You'll need to..."** - Shifting responsibility without assistance
- **"Someone else will..."** - Deferring to unnamed parties

#### Example Failures

```
Input: "Does the site support light mode?"
Output: "I don't have documentation on that feature. What I can do is escalate
this to someone who can give you a definitive answer about light mode support.

Are you currently experiencing an issue with the display, or just checking if
it's available before purchasing?"

Root cause: Agent admits inability and escalates without providing any
immediate value. Could probe for more context first.
```

```
Input: "Reply about AI interests from follower"
Output: "Since this is a direct response to Matt's personal email asking what
you want to learn about AI, he'll want to see this. I'd recommend replying
directly to him at [EMAIL] so he gets your message directly
rather than through support channels."

Root cause: Tells customer to use a different channel instead of handling
internally.
```

#### Recommended Fixes

1. **Negative instruction:** "Don't say 'I don't have the ability' without offering a concrete next step or workaround"
2. **Negative instruction:** "Never tell customers to 'reach out through...' external channels. Handle internally or escalate silently."
3. **Positive pattern:** When lacking information, probe for specifics: "What specifically are you trying to do?" (gather context before escalating)
4. **Positive pattern:** When escalating, be concrete: "I've flagged this for Matt" (not "you should reach out to...")

---

## Root Causes Summary

### 1. Over-explaining Agent Behavior

**Why it happens:** Agent prompts may contain too much detail about internal decision-making, which the model echoes back in responses.

**Fix:** Remove explanatory context from system prompts. Use directives like "Act, don't explain" or "Never mention your reasoning."

### 2. Exposing Tool/Configuration State

**Why it happens:** Agent debugging information (e.g., "no instructor configured") leaks into customer-facing responses.

**Fix:** Separate internal logging from customer responses. Add explicit "Never mention routing configuration" rules.

### 3. Corporate Speak in Training Data

**Why it happens:** Model trained on customer service examples that include pleasantries and hedging.

**Fix:** Use negative examples in few-shot prompts. Explicitly ban phrases like "Great!", "I'd recommend", "Thanks for reaching out".

### 4. Fabrication When Knowledge Retrieval Fails

**Why it happens:** Agent defaults to generic advice when knowledge base returns empty, fabricating plausible but false details.

**Fix:** Enforce "If unsure, probe don't fabricate" rule. Add check for empty knowledge base results before generating curriculum advice.

### 5. Deflection Over Assistance

**Why it happens:** Agent prioritizes scope adherence over helpfulness, pushing customers to other channels instead of attempting to help.

**Fix:** Reframe prompts to prioritize assistance. Add pattern: "If you can't fully solve, provide partial help + escalate" (not just escalate).

---

## Recommendations for Prompt Changes

### High Priority (Fix > 40% failure rates)

1. **Add to system prompt:**
   ```
   CRITICAL RULES:
   - Never mention internal routing, configuration, or tool state
   - Never explain your reasoning or guidelines to customers
   - Act silently. If you can't respond, don't explain why.
   - Never start with "This is clearly..." or "This appears to be..."
   ```

2. **Add negative examples to few-shot:**
   ```
   BAD: "No instructor routing configured for this app, so I can't..."
   GOOD: [silent - no response sent]

   BAD: "I won't respond to this. Per my guidelines..."
   GOOD: [silent - no response sent]
   ```

3. **Add banned phrase list:**
   ```
   NEVER USE:
   - "Great!"
   - "I'd recommend" / "I'd suggest"
   - "Thanks for reaching out" / "Thanks for sharing"
   - "Per my guidelines"
   - "This is clearly..."
   - "I don't have the ability"
   - Em-dashes (—)
   ```

### Medium Priority (Fix 20-30% failure rates)

4. **Add helpfulness guardrails:**
   ```
   BEFORE saying "I don't have the ability":
   1. Check if you can provide partial help
   2. Probe for more context: "What specifically are you trying to do?"
   3. Only escalate after attempting to help
   ```

5. **Add fabrication prevention:**
   ```
   If knowledge base returns no results:
   - DO: Ask clarifying questions
   - DON'T: Invent course structure or content details

   Example: "I don't have the course structure. What specifically are you
   trying to learn?" (not "Start with the fundamentals section...")
   ```

### Low Priority (Fix < 10% failure rates)

6. **Refine knowledge base retrieval:**
   - Ensure KB queries are working before referencing course content
   - Add fallback: "Let me check on that for you" (not fabrication)

---

## Testing Next Steps

1. **Update agent prompts** with high-priority changes
2. **Re-run eval** on same 37 samples to measure improvement
3. **Target metrics:**
   - InternalStateLeakage: < 10% failure (currently 46%)
   - MetaCommentary: < 10% failure (currently 46%)
   - BannedPhrases: < 10% failure (currently 27%)
   - Overall pass rate: > 85% (currently 66%)

4. **Expand dataset** to 100+ samples once baseline improves
5. **Add online eval** for live traffic (shadow mode)

---

## Appendix: Specific Bad Phrases to Remove

From the eval output, these exact phrases appeared in failing responses:

### Internal State Leaks
- "No instructor routing configured"
- "Looks like there's no instructor routing"
- "I can't route this directly"
- "I don't have an instructor configured"
- "You'll want to reach out through"
- "Should be routed to"
- "Falls outside"

### Meta-Commentary
- "This is clearly"
- "This appears to be"
- "I won't respond to this"
- "Per my guidelines"
- "This isn't a support request, so I won't draft a response"
- "No action needed"

### Banned Phrases
- "Great!" (start of response)
- "I'd recommend"
- "I'd suggest"
- "Thanks for reaching out"
- "Thanks for sharing"
- "I hear you"
- "I understand"
- "Is there a specific area you're curious about"
- "—" (em-dash)

### Deflections
- "I don't have the ability"
- "Reach out directly through"
- "You'll need to"
- "Someone else will"
- "I can escalate this to someone who"
