# Phase 7 - Polish + Ops

## Goal

Observability, retention, stability.

## Deliverables

- Axiom tracing + Langfuse
- Retention policies enforced
- Rate limit and backpressure

## PR-Ready Checklist

- Traces emitted on webhook → agent → action
- Dead-letter + alerts wired

## Validation / Tests

- E2E: multi-app routing
- E2E: rate limit + cache behavior

