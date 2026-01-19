# packages/core

Agent logic, router, tools, workflows, trust scoring, and vector search.

## Modules

```
src/
  agent/       Support agent config (AI SDK, system prompt)
  router/      Message classifier, routing rules, canned responses
  tools/       Agent tools (Stripe, search, lookup)
  inngest/     Workflow definitions (handle-inbound, approval, refund)
  trust/       Trust scoring, decay, auto-send logic
  vector/      Upstash Vector client, retrieval, redaction
  front/       Front API client
  slack/       Slack client, approval blocks
  observability/  Axiom, Langfuse tracing
  redis/       Upstash Redis client
  services/    App registry, retention
  webhooks/    Webhook verification
```

## Key Exports

- `runSupportAgent` - Main agent runner
- `classifyMessage` - Message classification (Haiku)
- `shouldAutoSend` - Trust-based auto-send check
- `createFrontClient` - Front API operations
- `inngest` - Inngest client
- `handleInboundMessage` - Main workflow

## Tools

- `process-refund` - Issue Stripe refund
- `stripe-payment-history` - Query payment history
- `stripe-subscription-status` - Check subscription
- `lookup-user` - Look up user by email
- `search-knowledge` - Vector search
- `searchProductContent` - Search product content for recommendations (SDK 0.3.0+)

## Dev

```bash
bun run test --filter=packages/core
```
