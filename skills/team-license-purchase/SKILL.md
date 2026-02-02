---
name: team-license-purchase
description: |
  Organizations inquire about bulk purchasing multiple licenses for their team members.
sample_size: 508
validation:
  required_phrases:
    - "let me know if"
  forbidden_patterns:
    - "(?i)discount code"
    - "(?i)promo code"
    - "(?i)here(?:'s| is) a coupon"
    - "(?i)coupon gives you"
    - "(?i)code=[a-z0-9-]{6,}"
    - "(?i)we can (?:do|offer) \\$"
    - "(?i)we can (?:do|offer) \\d+% off"
    - "(?i)custom (?:bulk|team) pric"
metrics:
  sample_size: 508
  avg_thread_length: 4.98
  top_phrases:
    - phrase: "let me know if"
      count: 177
      percent: 34.8
    - phrase: "https epicreact dev coupon"
      count: 161
      percent: 31.7
    - phrase: "me know if you"
      count: 148
      percent: 29.1
    - phrase: "know if you have"
      count: 133
      percent: 26.2
    - phrase: "if you have any"
      count: 132
      percent: 26.0
    - phrase: "please let me know"
      count: 68
      percent: 13.4
    - phrase: "for your interest in"
      count: 56
      percent: 11
    - phrase: "thanks for your interest"
      count: 53
      percent: 10.4
    - phrase: "your interest in the"
      count: 51
      percent: 10.0
    - phrase: "interest in the course"
      count: 51
      percent: 10.0
---

# Team License Purchase

## Response Patterns (from samples)

Common openings:
- "Hello,"
- "Hi,"
- "Hey David,"

Common core lines:
- "Thanks for your interest in the course!"
- "Thanks for reaching out!"

Common closings:
- "Let me know if you have any additional questions!"
- "Best,"
- "Please let me know if you have any further questions!"

## Phrases That Work (4-gram frequency)

- "let me know if" — 177 (34.8%)
- "https epicreact dev coupon" — 161 (31.7%)
- "me know if you" — 148 (29.1%)
- "know if you have" — 133 (26.2%)
- "if you have any" — 132 (26%)
- "please let me know" — 68 (13.4%)
- "for your interest in" — 56 (11%)
- "thanks for your interest" — 53 (10.4%)
- "your interest in the" — 51 (10%)
- "interest in the course" — 51 (10%)

## Tone Guidance (observed)

- Openings trend toward: "Hello,"
- Closings often include: "Let me know if you have any additional questions!"

## What NOT To Do

- Don't introduce policy details that are not present in the verified response lines above.
- Don't paraphrase or reframe the customer's question in a way that changes meaning.
- Don't add refund/discount promises unless they appear in the extracted responses for this topic.
- Don't invent discount codes or promotional links.
- Don't quote custom bulk pricing unless it is explicitly in the verified response lines above.

## Validation

Draft must:
- [ ] Include at least one of the required phrases from the validation block
- [ ] Stay consistent with the observed response patterns above
