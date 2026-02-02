---
name: technical-issue-course-content
description: |
  Customer reports technical problems with videos, code examples, or course materials not working.
sample_size: 596
validation:
  required_phrases:
    - "thanks for the heads up"
    - "let me know if"
  forbidden_patterns:
    - "(?i)works on my machine"
    - "(?i)can't reproduce"
    - "(?i)cannot reproduce"
    - "(?i)user error"
    - "(?i)your fault"
    - "(?i)not our problem"
metrics:
  sample_size: 596
  avg_thread_length: 3.15
  top_phrases:
    - phrase: "for the heads up"
      count: 79
      percent: 13.3
    - phrase: "thanks for the heads"
      count: 78
      percent: 13.1
    - phrase: "the heads up we'll"
      count: 58
      percent: 9.7
    - phrase: "heads up we'll look"
      count: 58
      percent: 9.7
    - phrase: "up we'll look into"
      count: 58
      percent: 9.7
    - phrase: "let me know if"
      count: 49
      percent: 8.2
    - phrase: "we'll look into this"
      count: 44
      percent: 7.4
    - phrase: "look into this asap"
      count: 41
      percent: 6.9
    - phrase: "thanks for the feedback"
      count: 40
      percent: 6.7
    - phrase: "thanks for reaching out"
      count: 36
      percent: 6.0
---

# Technical Issue with Course Content

## Response Patterns (from samples)

Common openings:
- "Hi,"
- "Thanks for the feedback, it's not perfect for sure. We recommend using VS Code or similar locally if the inline editor is aggravating."
- "Hello,"

Common core lines:
- "Hi,"
- "Thanks for the heads up! We'll look into this ASAP."
- "Best,"

Common closings:
- "Best,"
- "Thanks for the heads up! We'll look into this ASAP."
- "Thanks for the feedback, it's not perfect for sure. We recommend using VS Code or similar locally if the inline editor is aggravating."

## Phrases That Work (4-gram frequency)

- "for the heads up" — 79 (13.3%)
- "thanks for the heads" — 78 (13.1%)
- "the heads up we'll" — 58 (9.7%)
- "heads up we'll look" — 58 (9.7%)
- "up we'll look into" — 58 (9.7%)
- "let me know if" — 49 (8.2%)
- "we'll look into this" — 44 (7.4%)
- "look into this asap" — 41 (6.9%)
- "thanks for the feedback" — 40 (6.7%)
- "thanks for reaching out" — 36 (6.0%)

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
