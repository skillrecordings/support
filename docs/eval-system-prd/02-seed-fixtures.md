# Phase 2 - Seed Data + Fixtures

## Goal

Deterministic test data that exercises all agent behaviors and failure modes.

## Deliverables

- `fixtures/apps/` - Test app configurations
- `fixtures/knowledge/` - Knowledge base entries for vector search
- `fixtures/customers/` - Test customer profiles + purchase history
- `fixtures/conversations/` - Pre-existing conversation context
- `skill eval-local seed` command

## Directory Structure

```
fixtures/
├── apps/
│   ├── total-typescript-eval.json
│   └── ai-hero-eval.json
├── knowledge/
│   ├── total-typescript/
│   │   ├── refund-policy.md
│   │   ├── access-faq.md
│   │   └── course-content.md
│   └── ai-hero/
│       ├── workshop-info.md
│       └── pricing.md
├── customers/
│   ├── happy-customer.json
│   ├── frustrated-customer.json
│   └── no-purchase.json
└── conversations/
    ├── ongoing-thread.json
    └── escalated.json
```

## Fixture Formats

### App Configuration

```json
// fixtures/apps/total-typescript-eval.json
{
  "id": "app_eval_tt",
  "slug": "total-typescript-eval",
  "name": "Total TypeScript (Eval)",
  "integration_base_url": "http://localhost:3456",
  "webhook_secret": "eval_secret_tt",
  "instructor_teammate_id": "tea_instructor_matt",
  "stripe_account_id": "acct_eval_tt",
  "settings": {
    "auto_send_threshold": 0.85,
    "refund_window_days": 30,
    "transfer_window_days": 14
  }
}
```

### Knowledge Base Entry

```json
// fixtures/knowledge/total-typescript/refund-policy.md
---
type: policy
app: total-typescript-eval
tags: [refund, policy, money-back]
---

# Refund Policy

Total TypeScript offers a 30-day money-back guarantee. No questions asked.

**Within 30 days:** Full refund, processed within 3-5 business days.
**31-45 days:** Case-by-case basis, requires manager approval.
**After 45 days:** No refunds.

To request a refund, reply to your purchase receipt or contact [EMAIL].
```

### Customer Profile

```json
// fixtures/customers/happy-customer.json
{
  "id": "user_happy",
  "email": "[EMAIL]",
  "name": "Happy Customer",
  "purchases": [
    {
      "id": "purch_happy_1",
      "product": "Total TypeScript Pro",
      "product_id": "prod_tt_pro",
      "stripe_charge_id": "ch_happy_1",
      "amount_cents": 49900,
      "purchased_at": "2025-12-15T10:00:00Z",
      "status": "active"
    }
  ],
  "traits": {
    "sentiment": "positive",
    "previous_tickets": 1,
    "lifetime_value": 499
  }
}
```

### Conversation Context

```json
// fixtures/conversations/ongoing-thread.json
{
  "id": "cnv_ongoing",
  "customer_email": "[EMAIL]",
  "subject": "Question about advanced generics",
  "messages": [
    {
      "direction": "in",
      "body": "I'm stuck on the generic constraints section...",
      "timestamp": "2025-01-20T14:00:00Z"
    },
    {
      "direction": "out",
      "body": "Have you tried the extends keyword exercise?",
      "timestamp": "2025-01-20T14:30:00Z",
      "author": "support-agent"
    }
  ],
  "tags": ["technical", "course-content"]
}
```

## Seed Command Implementation

```typescript
// packages/cli/src/commands/eval-local/seed.ts

export async function seedEvalEnvironment(options: {
  clean?: boolean  // Drop and recreate tables
  fixtures?: string  // Custom fixtures path
}): Promise<void> {
  const fixturesPath = options.fixtures || 'fixtures'
  
  if (options.clean) {
    await cleanDatabase()
  }
  
  // 1. Seed apps
  const apps = await loadJsonGlob(`${fixturesPath}/apps/*.json`)
  await seedApps(apps)
  
  // 2. Seed customers
  const customers = await loadJsonGlob(`${fixturesPath}/customers/*.json`)
  await seedCustomers(customers)
  
  // 3. Seed conversations
  const conversations = await loadJsonGlob(`${fixturesPath}/conversations/*.json`)
  await seedConversations(conversations)
  
  // 4. Seed knowledge base (vector embeddings)
  const knowledge = await loadMarkdownGlob(`${fixturesPath}/knowledge/**/*.md`)
  await seedKnowledgeBase(knowledge)  // Uses Ollama for embeddings
  
  // 5. Seed trust scores
  await seedTrustScores(apps)
  
  console.log('✅ Eval environment seeded')
}
```

## Knowledge Base Embedding

```typescript
// Uses Ollama locally instead of Upstash embeddings
async function embedAndStore(doc: KnowledgeDoc): Promise<void> {
  // Generate embedding via Ollama
  const embedding = await ollama.embeddings({
    model: 'nomic-embed-text',
    prompt: doc.content,
  })
  
  // Store in Qdrant
  await qdrant.upsert('support_eval', {
    points: [{
      id: doc.id,
      vector: embedding.embedding,
      payload: {
        content: doc.content,
        type: doc.type,
        app: doc.app,
        tags: doc.tags,
      }
    }]
  })
}
```

## PR-Ready Checklist

- [ ] `fixtures/` directory structure created
- [ ] At least 3 test apps (TT, AI Hero, generic)
- [ ] At least 10 knowledge base entries per app
- [ ] At least 5 customer profiles (happy, frustrated, new, whale, banned)
- [ ] At least 3 conversation contexts (new, ongoing, escalated)
- [ ] `skill eval-local seed` command implemented
- [ ] `skill eval-local seed --clean` drops and recreates
- [ ] Ollama embedding integration working
- [ ] Qdrant storage working

## Validation / Tests

```bash
# Seed from scratch
skill eval-local seed --clean

# Verify data
skill eval-local verify

# Output:
# ✅ Apps: 3 seeded
# ✅ Customers: 5 seeded  
# ✅ Conversations: 3 seeded
# ✅ Knowledge: 30 documents, 30 embeddings
# ✅ Trust scores: 15 seeded
```
