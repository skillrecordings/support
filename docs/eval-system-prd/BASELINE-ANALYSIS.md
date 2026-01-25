# Baseline Analysis Report

**Date:** 2026-01-24
**Dataset:** 45 agent responses from production (Front)
**Dataset Period:** January 2026
**Source:** `fixtures/datasets/comprehensive-dataset.json`

## Executive Summary

The support agent baseline shows significant quality issues that need attention:

| Metric | Pass Rate | Status |
|--------|-----------|--------|
| **Internal State Leakage** | 73.3% (33/45) | ⚠️ Needs work |
| **Meta-Commentary** | 71.1% (32/45) | ⚠️ Needs work |
| **Banned Phrases** | 71.1% (32/45) | ⚠️ Needs work |
| **Product Fabrication** | 93.3% (42/45) | ✅ Good |
| **Helpfulness** | 82.2% (37/45) | ⚠️ Needs work |

**Overall Composite Pass Rate: ~78%**
**Target: >90%**

## Category Breakdown

### By Response Category

| Category | Total | Leak | Meta | Banned | Fabrication | Helpful |
|----------|-------|------|------|--------|-------------|---------|
| tool-assisted | 36 | 72.2% | 86.1% | 72.2% | 91.7% | 77.8% |
| direct-response | 9 | 77.8% | **11.1%** | 66.7% | 100% | 100% |

**Key Finding:** The `direct-response` category has a catastrophic **11.1% meta-commentary pass rate** (1/9). These are responses where the agent explains why it's not responding rather than just staying silent.

## Top Failure Patterns

### 1. Internal State Leakage (12 failures, 26.7%)

The agent exposes internal configuration and routing state to customers.

**Common Phrases:**
- "No instructor routing configured for this app"
- "I can't route this directly"
- "Unable to route this through the system"
- "Since there's no instructor routing set up"
- "Should be routed to"

**Example Failures:**

```
Trigger: "[aih] Banger quote about career anxiety"
Response: "No instructor routing configured for this app, so I can't forward 
it that way. But wanted to flag that this seems like it's meant as personal 
correspondence rather than a support request."
```

```
Trigger: "YouTube Partnership || Open Claude CoWork"
Response: "I'm unable to route this directly to Matt through the system. 
Since this is a business partnership inquiry rather than a product support 
question, it should be forwarded to Matt's business development contact."
```

**Root Cause:** Agent is explaining why it can't do something instead of either:
1. Silently not responding
2. Flagging for human review without explanation

### 2. Meta-Commentary (13 failures, 28.9%)

The agent narrates its own decision-making process instead of just acting.

**Common Phrases:**
- "This is a [description of message type]..."
- "I won't respond to this because..."
- "Per my guidelines..."
- "This is not a support request, so..."
- "I won't draft a response here since..."

**Example Failures:**

```
Trigger: "Collaborate with Volter AI on Portable.dev!"
Response: "This is a business outreach/partnership pitch directed at Matt 
(the instructor), not a customer support request. It's not spam—it's a 
legitimate professional inquiry to the creator.

I won't respond to this. Per my guidelines, this should be routed directly 
to Matt for personal correspondence..."
```

```
Trigger: "This is Crazy"
Response: "This message is clearly not a customer support request — it's 
a casual/joking message without any actual issue to resolve. Per my 
guidelines, I should not draft a response to this.

If Joel has an actual support question..."
```

**Root Cause:** Agent is over-explaining its categorization and decision-making. Should remain silent or take action without narration.

### 3. Banned Phrases (13 failures, 28.9%)

Corporate speak, fake enthusiasm, and AI-typical patterns.

**Triggered Phrases:**
| Phrase | Count |
|--------|-------|
| Em-dash (—) | 6 |
| "I'd suggest/recommend" | 5 |
| "I understand" | 1 |
| "Thanks for reaching out" | 1 |
| "Thanks for sharing" | 1 |
| "Great!" | 1 |
| "Is there a specific area..." | 1 |

**Example Failures:**

```
Trigger: "Please Help me"
Response: "Great! If you're just starting out with TypeScript, I'd recommend 
beginning with the fundamentals..."
```

```
Trigger: "I am lost."
Response: "Hey Joel, I hear the frustration—TypeScript can feel overwhelming 
at first, but you've got this..."
```

**Root Cause:** Model defaults to corporate-speak patterns. Em-dashes are particularly common in Claude's writing style.

### 4. Product Fabrication (3 failures, 6.7%)

Making up course content that doesn't exist.

**Example Failure:**

```
Trigger: "AI is so confusing, where do i start?"
Response: "The knowledge base isn't returning results, but here's what I'd 
suggest: Start with the fundamentals section in AI Hero. It covers core 
concepts like how AI models work, prompt engineering basics..."
```

**Root Cause:** When knowledge retrieval fails, agent fabricates plausible-sounding course structure rather than asking clarifying questions.

### 5. Unhelpful Deflection (8 failures, 17.8%)

Agent deflects or pushes responsibility instead of helping.

**Common Patterns:**
- "You'll want to reach out through..."
- "I can't route this directly..."
- "Someone on the team should..."
- "This should get to Matt directly..."

**Example Failure:**

```
Trigger: "AI SDK Course Discount"
Response: "Hi Aminata, Thanks for reaching out. I don't have the ability to 
authorize discounts on pricing, but I'd recommend reaching out directly 
through the product website..."
```

**Root Cause:** Agent treats inability as an endpoint rather than finding workarounds or escalating helpfully.

## Category-Specific Issues

### Direct-Response Category (Critical)

The `direct-response` category has an **88.9% meta-commentary failure rate**. These are mostly:
- Business inquiries (partnership, sponsorship)
- Personal messages to the instructor
- Non-support content (automated emails, bounces)

The agent is incorrectly generating explanatory text for these instead of remaining silent.

**Recommended Fix:** For non-support content, the agent should either:
1. Return no response (silence)
2. Route without explanation
3. Return a minimal "flagged for review" without meta-commentary

## Recommendations

### High Priority (Fix >25% failure rates)

1. **Add explicit "no narration" rule:**
   ```
   NEVER explain your reasoning. Just act or stay silent.
   - Don't start with "This is a..." or "This appears to be..."
   - Don't say "Per my guidelines..."
   - Don't say "I won't respond because..."
   ```

2. **Add "no internal state" rule:**
   ```
   NEVER mention:
   - Routing configuration ("no instructor configured")
   - System capabilities ("I can't route this")
   - Tool state ("unable to forward")
   Just stay silent or escalate without explanation.
   ```

3. **Ban em-dash globally:**
   The em-dash (—) is a stylistic marker of AI-generated text. Use hyphens or rephrase.

4. **Ban hedging language:**
   ```
   Don't use: "I'd suggest", "I'd recommend", "I understand"
   Do use: Direct statements
   ```

### Medium Priority

5. **Add fabrication guard:**
   ```
   If knowledge retrieval fails:
   - Ask clarifying questions
   - Don't invent course content
   Example: "What specifically are you trying to learn?" 
   NOT: "Start with the fundamentals section..."
   ```

6. **Add deflection guard:**
   ```
   Before saying "reach out through..." or "you'll need to...":
   - Try to help first
   - Escalate internally, not externally
   - If truly can't help, escalate to human reviewer
   ```

## Baseline Metrics (v1.0)

Stored in `fixtures/baselines/v1.0.json`:

```json
{
  "total": 45,
  "timestamp": "2026-01-24T16:39:00.276Z",
  "passRates": {
    "internal_state_leakage": { "pass": 33, "fail": 12, "rate": "73.3%" },
    "meta_commentary": { "pass": 32, "fail": 13, "rate": "71.1%" },
    "banned_phrases": { "pass": 32, "fail": 13, "rate": "71.1%" },
    "product_fabrication": { "pass": 42, "fail": 3, "rate": "93.3%" },
    "helpfulness": { "pass": 37, "fail": 8, "rate": "82.2%" }
  }
}
```

## Next Steps

1. Generate 50+ scenarios from these real failures
2. Implement high-priority prompt changes
3. Re-run eval to measure improvement
4. Target: >90% pass rate on all scorers

---

*Generated from production data analysis on 2026-01-24*
