---
name: course-content-locked
description: |
  Customer purchased course but content is locked, unavailable, or not accessible as expected.
sample_size: 520
validation:
  required_phrases:
    - "access the course"
    - "login link"
    - "restore purchases"
  forbidden_patterns:
    - "(?i)refund"
    - "(?i)chargeback"
    - "(?i)purchase order"
    - "(?i)wire transfer"
    - "(?i)bank transfer"
    - "(?i)vat number"
    - "(?i)invoice number"
metrics:
  sample_size: 520
  avg_thread_length: 3.42
  top_phrases:
    - phrase: "let me know if"
      count: 91
      percent: 17.5
    - phrase: "me know if you"
      count: 77
      percent: 14.8
    - phrase: "to access the course"
      count: 52
      percent: 10
    - phrase: "know if you have"
      count: 50
      percent: 9.6
    - phrase: "thanks for the heads"
      count: 50
      percent: 9.6
    - phrase: "for the heads up"
      count: 50
      percent: 9.6
    - phrase: "at the top of"
      count: 50
      percent: 9.6
    - phrase: "you ll need to"
      count: 49
      percent: 9.4
    - phrase: "if you have any"
      count: 48
      percent: 9.2
    - phrase: "let us know if"
      count: 46
      percent: 8.8
---

# Course Content Locked or Unavailable

## Response Patterns (from samples)

Common openings:
- "Hi,"
- "Hello,"
- "Hi there,"

Common core lines:
- "Hi,"
- "Best,"
- "Hello,"

Common closings:
- "Best,"
- "Thanks for the heads up! Everything should be back up and running smoothly now. Let us know if that's not the case."
- "Your original purchase price will be removed from the upgrade to the full unrestricted version if you should choose to upgrade."

## Phrases That Work (4-gram frequency)

- "let me know if" — 91 (17.5%)
- "me know if you" — 77 (14.8%)
- "to access the course" — 52 (10%)
- "know if you have" — 50 (9.6%)
- "thanks for the heads" — 50 (9.6%)
- "for the heads up" — 50 (9.6%)
- "at the top of" — 50 (9.6%)
- "you ll need to" — 49 (9.4%)
- "if you have any" — 48 (9.2%)
- "let us know if" — 46 (8.8%)

## Tone Guidance (observed)

- Openings trend toward: "Hi,"
- Closings often include: "Best,"

## What NOT To Do

- Don't introduce policy details that are not present in the verified response lines above.
- Don't paraphrase or reframe the customer's question in a way that changes meaning.
- Don't add refund/discount promises unless they appear in the extracted responses for this topic.

## Validation

Draft must:
- [ ] Include at least one of the required phrases from the validation block
- [ ] Stay consistent with the observed response patterns above
