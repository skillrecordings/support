# Vector Search (Upstash Vector)

Hybrid search (dense + sparse) with hosted embeddings. Single index, type filters.

```typescript
const index = new Index({
  url: process.env.UPSTASH_VECTOR_URL,
  token: process.env.UPSTASH_VECTOR_TOKEN,
})

await index.upsert([{
  id: conversationId,
  data: redactPII(messageText),
  metadata: { type: 'conversation', appId, category, resolution }
}])

const results = await index.query({
  data: redactPII(queryText),
  topK: 5,
  filter: `appId = '${appId}'`,
  includeData: true,
  includeMetadata: true,
})
```

## PII Redaction

```typescript
function redactPII(text: string, knownNames: string[] = []): string {
  let redacted = text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    .replace(/(\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g, '[PHONE]')
    .replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[CARD]')

  if (knownNames.length > 0) {
    redacted = redacted.replace(
      new RegExp(knownNames.map(escapeRegex).join('|'), 'gi'),
      '[NAME]'
    )
  }

  return redacted
}
```

## Single Index with Type Filter

```typescript
interface VectorDocument {
  id: string
  data: string
  metadata: {
    type: 'conversation' | 'knowledge' | 'response'
    appId: string
    category?: MessageCategory
    resolution?: 'refund' | 'transfer' | 'info' | 'escalated'
    customerSentiment?: 'positive' | 'neutral' | 'negative'
    touchCount?: number
    resolvedAt?: string
    source?: 'docs' | 'faq' | 'policy' | 'canned-response'
    title?: string
    lastUpdated?: string
    trustScore?: number
    usageCount?: number
    conversationId?: string
  }
}
```

## Agent Retrieval Flow

```typescript
async function buildAgentContext(message: string, appId: string) {
  const query = redactPII(message)

  const [similarTickets, knowledge, goodResponses] = await Promise.all([
    index.query({
      data: query,
      topK: 3,
      filter: `appId = '${appId}' AND type = 'conversation' AND resolution != 'escalated'`,
      includeData: true,
      includeMetadata: true,
    }),
    index.query({
      data: query,
      topK: 5,
      filter: `appId = '${appId}' AND type = 'knowledge'`,
      includeData: true,
      includeMetadata: true,
    }),
    index.query({
      data: query,
      topK: 3,
      filter: `appId = '${appId}' AND type = 'response' AND trustScore > 0.85`,
      includeData: true,
      includeMetadata: true,
    }),
  ])

  return { similarTickets, knowledge, goodResponses }
}
```

## Optional: Cohere Rerank

```typescript
async function buildAgentContextWithRerank(message: string, appId: string) {
  const query = redactPII(message)

  const [denseResults, sparseResults] = await Promise.all([
    index.query({ data: query, queryMode: 'DENSE', topK: 30, filter: `appId = '${appId}'`, includeData: true }),
    index.query({ data: query, queryMode: 'SPARSE', topK: 30, filter: `appId = '${appId}'`, includeData: true }),
  ])

  const candidates = dedupeById([...denseResults, ...sparseResults])

  const reranked = await cohere.rerank({
    model: 'rerank-v4.0-pro',
    query: message,
    documents: candidates.map(c => c.data),
    topN: 10,
  })

  const results = reranked.results.map(r => candidates[r.index])
  return {
    similarTickets: results.filter(r => r.metadata.type === 'conversation').slice(0, 3),
    knowledge: results.filter(r => r.metadata.type === 'knowledge').slice(0, 5),
    goodResponses: results.filter(r => r.metadata.type === 'response').slice(0, 3),
  }
}
```

