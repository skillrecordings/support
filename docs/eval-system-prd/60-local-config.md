# Local Environment Configuration

## Environment Detection

The system detects local eval mode via `EVAL_MODE=local` environment variable.

```typescript
// packages/core/src/config/environment.ts

export function isEvalMode(): boolean {
  return process.env.EVAL_MODE === 'local'
}

export function getVectorClient() {
  if (isEvalMode()) {
    return createQdrantClient()  // Local Qdrant
  }
  return createUpstashVectorClient()  // Production Upstash
}

export function getEmbeddingProvider() {
  if (isEvalMode()) {
    return createOllamaEmbeddings()  // Local Ollama
  }
  return createUpstashEmbeddings()  // Production Upstash
}

export function getRedisClient() {
  if (isEvalMode()) {
    return createLocalRedisClient()  // Standard Redis
  }
  return createUpstashRedisClient()  // Production Upstash
}
```

## Qdrant Adapter

Qdrant REST API is similar to Upstash Vector but not identical. Adapter maps between them.

```typescript
// packages/core/src/vector/qdrant-adapter.ts

import { QdrantClient } from '@qdrant/js-client-rest'

export class QdrantVectorAdapter {
  private client: QdrantClient
  private collection: string
  
  constructor(url: string, collection: string) {
    this.client = new QdrantClient({ url })
    this.collection = collection
  }
  
  async upsert(documents: VectorDocument[]): Promise<void> {
    await this.client.upsert(this.collection, {
      points: documents.map(doc => ({
        id: doc.id,
        vector: doc.vector,
        payload: doc.metadata,
      }))
    })
  }
  
  async query(vector: number[], topK: number): Promise<VectorQueryResult[]> {
    const results = await this.client.search(this.collection, {
      vector,
      limit: topK,
      with_payload: true,
    })
    
    return results.map(r => ({
      id: r.id as string,
      score: r.score,
      data: r.payload?.content as string,
      metadata: r.payload as Record<string, unknown>,
    }))
  }
}
```

## Ollama Embeddings Adapter

```typescript
// packages/core/src/vector/ollama-embeddings.ts

export class OllamaEmbeddings {
  private baseUrl: string
  private model: string
  
  constructor(baseUrl = 'http://localhost:11434', model = 'nomic-embed-text') {
    this.baseUrl = baseUrl
    this.model = model
  }
  
  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    })
    
    const data = await response.json()
    return data.embedding
  }
  
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't have native batch, so we parallelize
    return Promise.all(texts.map(t => this.embed(t)))
  }
}
```

## Local Redis Client

Standard Redis client (compatible with Upstash REST API pattern).

```typescript
// packages/core/src/redis/local-client.ts

import { createClient } from 'redis'

export class LocalRedisClient {
  private client: ReturnType<typeof createClient>
  
  constructor(url = 'redis://localhost:6379') {
    this.client = createClient({ url })
  }
  
  async connect(): Promise<void> {
    await this.client.connect()
  }
  
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key)
    return value ? JSON.parse(value) : null
  }
  
  async set(key: string, value: unknown, options?: { ex?: number }): Promise<void> {
    const serialized = JSON.stringify(value)
    if (options?.ex) {
      await this.client.setEx(key, options.ex, serialized)
    } else {
      await this.client.set(key, serialized)
    }
  }
}
```

## Full .env.eval Example

```bash
# =============================================================================
# Local Eval Environment Configuration
# =============================================================================

# Mode flag - REQUIRED
EVAL_MODE=local

# -----------------------------------------------------------------------------
# Database (MySQL via Docker)
# -----------------------------------------------------------------------------
DATABASE_URL=mysql://eval_user:eval_pass@localhost:3306/support_eval

# -----------------------------------------------------------------------------
# Vector Search (Qdrant via Docker)
# -----------------------------------------------------------------------------
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=support_eval

# -----------------------------------------------------------------------------
# Embeddings (Ollama via Docker)
# -----------------------------------------------------------------------------
OLLAMA_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text

# Embedding dimension (nomic-embed-text = 768)
EMBEDDING_DIMENSION=768

# -----------------------------------------------------------------------------
# Cache (Redis via Docker)
# -----------------------------------------------------------------------------
REDIS_URL=redis://localhost:6379

# For Upstash-style REST API compatibility (if needed)
UPSTASH_REDIS_REST_URL=http://localhost:6379
UPSTASH_REDIS_REST_TOKEN=unused_in_local_mode

# -----------------------------------------------------------------------------
# LLM (Real Anthropic API)
# -----------------------------------------------------------------------------
# Still uses real API - copy from your main .env.local
ANTHROPIC_API_KEY=sk-ant-...

# Model for agent (can override for cost savings in eval)
AGENT_MODEL=anthropic/claude-haiku-4-5

# -----------------------------------------------------------------------------
# Front (Optional - for importing real conversations)
# -----------------------------------------------------------------------------
FRONT_API_TOKEN=...

# -----------------------------------------------------------------------------
# Observability (Optional - disable for local)
# -----------------------------------------------------------------------------
# AXIOM_TOKEN=
# AXIOM_DATASET=
# LANGFUSE_SECRET_KEY=
# LANGFUSE_PUBLIC_KEY=

# -----------------------------------------------------------------------------
# Eval-specific settings
# -----------------------------------------------------------------------------
# Fail threshold for CI (not used locally, but good to have)
EVAL_FAIL_THRESHOLD=0.8

# Timeout for individual scenarios (ms)
EVAL_SCENARIO_TIMEOUT=30000

# Parallel scenario execution (careful with rate limits)
EVAL_PARALLEL=1
```

## Setup Script

```bash
#!/bin/bash
# scripts/setup-eval.sh

set -e

echo "🔧 Setting up local eval environment..."

# 1. Copy env template
if [ ! -f .env.eval ]; then
  cp .env.eval.example .env.eval
  echo "📝 Created .env.eval - please add your ANTHROPIC_API_KEY"
fi

# 2. Start Docker services
echo "🐳 Starting Docker services..."
docker compose -f docker/eval.yml up -d

# 3. Wait for services to be healthy
echo "⏳ Waiting for services..."
docker compose -f docker/eval.yml ps --format json | jq -r '.[].Health' | grep -q "healthy" || sleep 5

# 4. Pull Ollama model
echo "🤖 Pulling embedding model..."
docker exec support-ollama ollama pull nomic-embed-text

# 5. Create Qdrant collection
echo "📊 Creating vector collection..."
curl -X PUT "http://localhost:6333/collections/support_eval" \
  -H "Content-Type: application/json" \
  -d '{"vectors": {"size": 768, "distance": "Cosine"}}' \
  2>/dev/null || true

# 6. Run database migrations
echo "🗄️ Running migrations..."
source .env.eval
bun drizzle-kit push:mysql

# 7. Seed test data
echo "🌱 Seeding test data..."
bun packages/cli/src/index.ts eval-local seed

echo ""
echo "✅ Local eval environment ready!"
echo ""
echo "Run evals with:"
echo "  source .env.eval"
echo "  skill eval-local run"
```
