# Phase 1 - Registry + Ingestion

## Goal

Register apps + ingest Front webhooks reliably.

## Deliverables

- App registry + DB schema
- Front webhook ingestion route + signature verify
- DO cache (metadata + last 10 messages + last draft)
- Inngest event dispatch wired
- Retrieval-first guardrail: ingestion stores minimal context + search hooks
- Retrieval-first guardrail: ingestion stores minimal context + search hooks

## PR-Ready Checklist

- `skill init` registers app and stores webhook secret
- HMAC verification passes + rejects replays

## Validation / Tests

- Unit: signature verify, replay protection
- Integration: webhook → inngest event
