# Quality Scorers Reference

## Overview

Quality scorers detect known-bad patterns in agent responses. They're used for:
1. Scoring eval results (pass/fail)
2. Real-time quality gates (before auto-send)
3. Analyzing historical responses

## Scorer List

### 1. Internal State Leakage

Detects when the agent exposes internal system state to customers.

**Patterns detected:**
```
/no instructor (configured|routing|assigned|set up)/i
/can't route this/i
/unable to route/i
/no (instructor|channel|inbox) (is )?configured/i
/system (doesn't|does not|cannot|can't)/i
/not configured for this app/i
/routing (not )?(set up|configured)/i
/tool (failed|error|returned)/i
/API (error|failed|token)/i
/forwarding (to|this)/i
/I'll note that this/i
/You'll want to reach out through/i
/should be routed/i
/should go to/i
/falls outside/i
```

**Why it matters:** Customers should never see internal system errors or routing decisions. This breaks trust and exposes implementation details.

**Example failures:**
- "No instructor routing configured for this app, so I can't forward it"
- "Looks like there's no instructor assignment set up"
- "The tool failed to find your account"

### 2. Meta-Commentary

Detects when the agent explains what it's doing instead of just doing it.

**Patterns detected:**
```
/^This (is|appears to be|seems|looks like) (a |an )?(clearly )?/i
/I (won't|will not|shouldn't|should not) (respond|draft|reply)/i
/I don't need to respond/i
/this (should|needs to) (go to|be forwarded|be routed)/i
/per my guidelines/i
/outside (the scope|my scope|customer support)/i
/not a (support request|customer service issue)/i
/is clearly (not|meant|personal|business)/i
/This (falls|is) outside/i
```

**Why it matters:** The agent should act, not narrate. Meta-commentary is a sign of confusion about role boundaries.

**Example failures:**
- "This is clearly a personal message for Matt rather than a support request"
- "I won't respond to this since it's outside the scope of support"
- "Per my guidelines, I should not draft a response here"

### 3. Banned Phrases

Detects corporate speak, AI-isms, and tone violations.

**Patterns detected:**
```
/^Great!/i
/I'd recommend/i
/I would recommend/i
/I'd suggest/i
/I would suggest/i
/Is there a specific area you're curious about/i
/Would you like help with/i
/Let me know if you have any other questions/i
/I hope this helps/i
/Happy to help/i
/I understand/i
/I hear you/i
/I apologize for any inconvenience/i
/Thanks (so much )?for (reaching out|sharing)/i
/What a wonderful message/i
/I really appreciate/i
/—/  // em dash
```

**Why it matters:** Customers can smell corporate BS. The agent should sound like a competent human, not a chatbot.

**Example failures:**
- "Great question! I'd be happy to help you with that."
- "Thanks so much for reaching out! I understand your frustration."
- "I hope this helps! Let me know if you have any other questions."

### 4. Product Fabrication

Detects when the agent invents product content it hasn't been told about.

**Patterns detected:**
```
/start with the (fundamentals|basics) section/i
/covers core concepts like/i
/the (course|module|section) (covers|teaches|includes)/i
/you('ll| will) learn (about )?(\w+, )+/i
/Start with the basics.*learn how/i
/fundamentals.*It covers/i
```

**Why it matters:** Hallucinated product content is worse than saying "I don't know." It destroys credibility and creates confusion.

**Example failures:**
- "Start with the fundamentals section. It covers core concepts like types, interfaces, and generics."
- "You'll learn about dependency injection, testing patterns, and state management."

### 5. Helpfulness

Measures whether the response actually helps vs deflects.

**Deflection patterns (negative):**
```
/I don't have (the ability|access|information)/i
/reach out (directly |through )/i
/contact.*directly/i
/you('ll| will) (need|have|want) to/i
/someone (else|on the team) (will|can|should)/i
/manually forward/i
/internal process/i
```

**Helpful patterns (positive):**
```
/Login link:/i
/your (purchase|account|order)/i
/I'?ve (sent|processed|updated)/i
/refund/i
/transfer/i
/\b(here'?s|here is)\b/i
```

**Scoring:** `helpful_count / (helpful_count + deflection_count)`

**Why it matters:** A response that pushes work back to the customer is a failure, even if it's technically correct.

## Using Scorers

### In Eval CLI

```typescript
import { scoreResponse } from '@skillrecordings/core/evals'

const result = scoreResponse(agentOutput)

console.log(result)
// {
//   internalLeaks: { passed: true, matches: [] },
//   metaCommentary: { passed: false, matches: ["This is clearly"] },
//   bannedPhrases: { passed: true, matches: [] },
//   productFabrication: { passed: true, matches: [] },
//   helpfulness: { score: 0.8 },
//   passed: false,  // Any failure = overall fail
// }
```

### Real-Time Gate (Pre-Send)

```typescript
// In approval workflow, before auto-send
const scores = scoreResponse(draftBody)

if (!scores.passed) {
  // Block auto-send, require human review
  await createApproval({
    type: 'draft-review',
    reason: `Quality check failed: ${scores.failureReasons.join(', ')}`,
    draft: draftBody,
  })
  return
}

// Quality passed, proceed with auto-send logic
```

## Adding New Scorers

1. Identify pattern from production failures
2. Add regex to appropriate scorer (or create new scorer)
3. Add test cases to `response-quality.eval.ts`
4. Run eval suite to verify no regressions
5. Document pattern and rationale

```typescript
// Example: Adding a new leak pattern
const newLeakPattern = /I'm unable to access/i

// Add to leakPatterns array in response-quality.eval.ts
const leakPatterns = [
  // ... existing patterns
  /I'm unable to access/i,  // NEW: Agent shouldn't admit access limitations
]
```

## Scorer Weights (Future)

Currently all scorers are binary (pass/fail). Future enhancement:

```typescript
const weights = {
  internalLeaks: 1.0,      // Critical - always fail
  metaCommentary: 1.0,     // Critical - always fail
  bannedPhrases: 0.8,      // High - fail unless borderline
  productFabrication: 1.0, // Critical - always fail
  helpfulness: 0.5,        // Medium - factor into overall score
}
```
