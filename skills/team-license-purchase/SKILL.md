---
name: team-license-purchase
description: Handle team and bulk license purchases. Use when an organization asks to buy multiple licenses for a team.
metadata:
  sample_size: "508"
  validation: "required_phrases:\n  - \"let me know if\"\nforbidden_patterns:\n  - \"(?i)discount code\"\n  - \"(?i)promo code\"\n  - \"(?i)here(?:'s| is) a coupon\"\n  - \"(?i)coupon gives you\"\n  - \"(?i)code=[a-z0-9-]{6,}\"\n  - \"(?i)we can (?:do|offer) \\\\$\"\n  - \"(?i)we can (?:do|offer) \\\\d+% off\"\n  - \"(?i)custom (?:bulk|team) pric\""
  metrics: "sample_size: 508\navg_thread_length: 4.98\ntop_phrases:\n  - phrase: \"let me know if\"\n    count: 177\n    percent: 34.8\n  - phrase: \"https epicreact dev coupon\"\n    count: 161\n    percent: 31.7\n  - phrase: \"me know if you\"\n    count: 148\n    percent: 29.1\n  - phrase: \"know if you have\"\n    count: 133\n    percent: 26.2\n  - phrase: \"if you have any\"\n    count: 132\n    percent: 26.0\n  - phrase: \"please let me know\"\n    count: 68\n    percent: 13.4\n  - phrase: \"for your interest in\"\n    count: 56\n    percent: 11\n  - phrase: \"thanks for your interest\"\n    count: 53\n    percent: 10.4\n  - phrase: \"your interest in the\"\n    count: 51\n    percent: 10.0\n  - phrase: \"interest in the course\"\n    count: 51\n    percent: 10.0"
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
