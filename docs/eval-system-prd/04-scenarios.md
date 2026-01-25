# Phase 4 - Scenarios + Coverage

## Goal

Comprehensive test scenarios covering all agent behaviors, failure modes, and edge cases.

## Deliverables

- `fixtures/scenarios/` - Organized scenario files
- Coverage of all major behavior categories
- At least 50 scenarios total
- Documentation of expected behaviors

## Scenario Format

```json
{
  "id": "refund-within-policy",
  "name": "Refund request within 30-day window",
  "category": "refund",
  "tags": ["happy-path", "auto-approve"],
  
  "appId": "app_eval_tt",
  
  "trigger": {
    "subject": "Refund request",
    "body": "Hi, I purchased Total TypeScript Pro last week but realized I don't have time to go through it right now. Can I get a refund?"
  },
  
  "context": {
    "customerId": "user_happy",
    "conversationId": null
  },
  
  "expectedBehavior": "draft-response",
  "expectedToolCalls": ["lookupUser", "draftResponse"],
  
  "qualityChecks": {
    "mustNotContain": [
      "no instructor configured",
      "I can't",
      "I won't",
      "per my guidelines"
    ],
    "mustContain": [
      "refund"
    ],
    "toneMustBe": "helpful-direct"
  },
  
  "notes": "Within 30 days, should auto-approve. Response should confirm refund will be processed, not ask for approval."
}
```

## Scenario Categories

### 1. Refund Scenarios (`fixtures/scenarios/refund/`)

| ID | Name | Expected Behavior |
|----|------|-------------------|
| `refund-within-30` | Within 30 days, straightforward | draft-response, process refund |
| `refund-day-31` | Day 31, edge case | draft-response, request approval |
| `refund-day-45` | Day 45, edge case | draft-response, request approval |
| `refund-day-60` | Beyond policy | draft-response, explain policy |
| `refund-no-purchase` | No purchase found | draft-response, ask for details |
| `refund-already-refunded` | Already refunded | draft-response, inform customer |
| `refund-angry-customer` | Frustrated tone | escalate-to-human |

### 2. Access/Login Scenarios (`fixtures/scenarios/access/`)

| ID | Name | Expected Behavior |
|----|------|-------------------|
| `access-magic-link` | Request login link | draft-response, generate link |
| `access-404-page` | 404 when logging in | draft-response, troubleshoot |
| `access-wrong-email` | Purchased with different email | draft-response, ask to verify |
| `access-transfer` | Transfer to new email | draft-response, process transfer |
| `access-transfer-old` | Transfer after 14 days | draft-response, request approval |

### 3. Technical Questions (`fixtures/scenarios/technical/`)

| ID | Name | Expected Behavior |
|----|------|-------------------|
| `tech-generics-help` | Stuck on generics | draft-response, search KB, help |
| `tech-no-kb-results` | Question with no KB match | draft-response, ask clarifying q |
| `tech-module-error` | Code error in exercise | draft-response, technical help |
| `tech-vague-question` | "How do I start?" | draft-response, probe for specifics |

### 4. Routing Scenarios (`fixtures/scenarios/routing/`)

| ID | Name | Expected Behavior |
|----|------|-------------------|
| `routing-fan-mail` | Fan mail to Matt | assign-to-instructor, NO draft |
| `routing-partnership` | Partnership inquiry | assign-to-instructor, NO draft |
| `routing-spam` | Marketing spam | no-response |
| `routing-auto-reply` | Out-of-office | no-response |
| `routing-bounce` | Mailer-daemon | no-response |
| `routing-thank-you` | "Thanks, that worked!" | no-response (or brief ack) |

### 5. Failure Mode Scenarios (`fixtures/scenarios/failures/`)

These intentionally test bad behaviors that have occurred in production.

| ID | Name | Expected Behavior | Tests For |
|----|------|-------------------|-----------|
| `fail-leak-routing` | Personal msg, no instructor | assign-to-instructor, NO draft | Internal state leakage |
| `fail-meta-spam` | Obvious spam | no-response | Meta-commentary ("This is spam...") |
| `fail-fabricate` | Product question, no KB | ask clarifying q | Product fabrication |
| `fail-corporate` | Standard question | draft-response | Banned phrases |
| `fail-deflection` | Needs real help | draft-response, actually help | Unhelpful deflection |

### 6. Edge Cases (`fixtures/scenarios/edge/`)

| ID | Name | Expected Behavior |
|----|------|-------------------|
| `edge-thread-reply` | Reply in existing thread | draft-response, use context |
| `edge-multiple-issues` | 2+ issues in one msg | draft-response, address both |
| `edge-legal-language` | Mentions lawyer | escalate-to-human |
| `edge-repeat-failure` | 3rd msg, still stuck | escalate-to-human |
| `edge-whale-customer` | High LTV customer | extra care |

## Coverage Matrix

```
                    | draft | escalate | assign | no-resp | TOTAL
--------------------|-------|----------|--------|---------|------
Refund              |   5   |    1     |   0    |    1    |   7
Access              |   4   |    0     |   0    |    1    |   5
Technical           |   4   |    0     |   0    |    0    |   4
Routing             |   0   |    0     |   2    |    4    |   6
Failure modes       |   2   |    0     |   1    |    2    |   5
Edge cases          |   3   |    2     |   0    |    0    |   5
--------------------|-------|----------|--------|---------|------
TOTAL               |  18   |    3     |   3    |    8    |  32
```

Target: 50+ scenarios with all cells covered.

## Creating Scenarios from Production Data

```bash
# Export recent responses with issues
skill responses export --rating bad -o bad-responses.json

# Convert to scenario format
skill eval-local import-scenarios bad-responses.json --output fixtures/scenarios/imported/

# Each imported scenario needs:
# 1. Manual review of expectedBehavior
# 2. Addition of context (customer, conversation)
# 3. Addition of qualityChecks
```

## PR-Ready Checklist

- [ ] At least 50 scenarios created
- [ ] All categories have coverage
- [ ] All expected behaviors have coverage
- [ ] Failure mode scenarios based on real production failures
- [ ] Each scenario has clear expectedBehavior
- [ ] Each scenario has quality checks
- [ ] Scenarios import tool working
- [ ] Coverage matrix documented

## Maintenance

### Adding New Scenarios

When a new failure is discovered in production:

1. Export the conversation: `skill front conversation <id> -m --json`
2. Create scenario file in appropriate category
3. Document expectedBehavior (what SHOULD have happened)
4. Add quality checks based on failure type
5. Run scenario to verify it fails with current prompt
6. Fix prompt, verify scenario passes
7. Commit scenario with prompt fix

### Scenario Review Cadence

- Weekly: Review any new production failures, create scenarios
- Monthly: Run full suite, update baseline metrics
- Per-PR: Run affected scenarios, block merge if regression
