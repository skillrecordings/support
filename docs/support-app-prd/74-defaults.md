# Defaults (Retention, SLAs, Policies)

## Auto-send Trust

- Trust threshold: 0.85
- Minimum samples: 50
- Confidence floor: 0.90
- Never auto-send: angry-customer, legal, team-license, other

## Retention

- Actions/audit log: 18 months
- Approval requests: 90 days
- Conversation metadata: 24 months
- Raw message bodies in platform DB: 30 days (Front remains source of truth)
- DO cache: 7 days

## SLA / Latency Targets

- Webhook → draft: p95 < 60s, p99 < 120s
- Approval → execution: p95 < 5m
- Dashboard load: p95 < 2s

## Error + Retry Policy

- Front/Slack: exponential backoff, jitter, max 5 retries
- Stripe: max 3 retries, idempotency keys required
- Dead-letter after max retries; alert + manual retry

## Event Schema Versioning

- Versioned event envelope: `version`, `type`, `source`, `occurredAt`
- Backward-compatible changes only; breaking changes require new type or version
- Deprecate old versions after 90 days

## PII Policy

- Redact emails/phones/cards in vectors
- Store message bodies only 30 days; keep hashes + IDs after
- Avoid storing attachments; keep references/IDs only

