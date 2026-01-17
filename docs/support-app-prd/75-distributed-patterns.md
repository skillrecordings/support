# Distributed Systems Patterns

- Idempotency + dedupe: all actions accept an `actionId` and ignore repeats; Stripe actions use idempotency keys
- Transactional outbox: persist inbound events + intended side effects in DB, then emit to Inngest
- Cache staleness: DO cache is best-effort; expose `lastSyncedAt`, allow forced refresh, reconcile periodically
- Backpressure: batch vector upserts/exports, cap concurrency, respect provider rate limits
- Audit log = replay log: keep immutable action/event history for replays and debugging

