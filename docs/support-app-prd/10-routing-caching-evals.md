# Phase 8 - Routing + Caching + Canned Responses + Evals

## Goal

Reduce expensive inference with fast routing, cached decisions, and reusable canned responses, validated by strong evals.

## Deliverables

- Message router (rules -> canned match -> classifier -> agent)
- Canned response library + templates (Front or internal)
- Decision + template caches (per message + per conversation)
- Evals harness (offline + online)

## PR-Ready Checklist

- Routing decision schema + storage in Durable Object
- Idempotent processing (duplicate Front events dropped)
- Classifier model configured (anthropic/claude-haiku-4-5)
- Canned response hit-rate tracking
- Eval suite with baseline metrics + regression gates
- Gates enforced: routing precision/recall, FP/FN, cost, latency, and override rate

## Validation / Tests

- Unit: router outcomes for rules, canned matches, and classifier fallbacks
- Integration: Front webhook -> routing -> canned response -> no agent call
- Eval: offline labeled set with precision/recall and cost/latency deltas
- Online: shadow routing + canary rollout with rollback flags

## Eval Rubric (Baseline Gates)

- Routing precision (auto-respond) >= 0.92
- Routing recall (needs-response) >= 0.95
- False positive rate (auto-respond when should not) <= 0.03
- False negative rate (no-response when should respond) <= 0.02
- Canned response coverage (eligible threads) >= 0.25 to ship, >= 0.40 stretch
- Cost reduction vs baseline >= 35%
- p95 latency reduction vs baseline >= 25%
- Human override rate on auto-responses <= 0.05

## Relevant Skills

- `.claude/skills/front-webhook`
- `.claude/skills/inngest-workflow`
- `.claude/skills/tdd-red-green-refactor`
- `.claude/skills/vector-search`
