# Phase 6 - Vector + Trust + Auto-send

## Goal

Hybrid retrieval and trust-based auto-send gating.

## Deliverables

- Upstash Vector single index with type filters
- Retrieval flow in agent context
- Trust scoring + auto-send gating
- Retrieval-first context pipeline (hybrid + keyword fallback)
- Retrieval-first context pipeline (hybrid + keyword fallback)

## PR-Ready Checklist

- Retrieval returns similar tickets/knowledge/response examples
- Auto-send gated by trust + confidence

## Validation / Tests

- Integration: upsert/query with includeData
- E2E: trust thresholds block/allow auto-send
