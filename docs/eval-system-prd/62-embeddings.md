# Embedding Strategy

## Overview

The eval system uses Ollama for local embeddings instead of Upstash's hosted embeddings. This ensures:
- No network dependency during eval runs
- Deterministic results (same model, same output)
- Cost savings (no API calls)
- Faster iteration

## Model Selection

### Recommended: `nomic-embed-text`

| Property | Value |
|----------|-------|
| Dimension | 768 |
| Context | 8192 tokens |
| Size | ~274MB |
| Speed | ~50ms per embed (CPU) |

**Why nomic-embed-text:**
- Small, fast, good quality
- Works well on CPU (no GPU required)
- Open weights, deterministic
- Comparable to OpenAI ada-002

### Alternative: `mxbai-embed-large`

| Property | Value |
|----------|-------|
| Dimension | 1024 |
| Context | 512 tokens |
| Size | ~670MB |
| Speed | ~100ms per embed (CPU) |

Use if you need higher quality embeddings and have more compute.

## Setup

### Pull Model (One-Time)

```bash
# If Ollama is in Docker
docker exec support-ollama ollama pull nomic-embed-text

# If Ollama is installed locally
ollama pull nomic-embed-text
```

### Verify Model

```bash
curl http://localhost:11434/api/embeddings \
  -d '{"model": "nomic-embed-text", "prompt": "test"}' | jq '.embedding | length'
# Should return: 768
```

## Usage

### Direct Ollama API

```bash
curl http://localhost:11434/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-embed-text",
    "prompt": "How do I request a refund?"
  }'
```

Response:
```json
{
  "embedding": [0.123, -0.456, 0.789, ...]  // 768 floats
}
```

### In Code

```typescript
import { OllamaEmbeddings } from '@skillrecordings/core/vector/ollama-embeddings'

const embeddings = new OllamaEmbeddings(
  'http://localhost:11434',
  'nomic-embed-text'
)

const vector = await embeddings.embed('How do I request a refund?')
// number[] with 768 dimensions
```

## Qdrant Collection Setup

Create collection with matching dimensions:

```bash
curl -X PUT "http://localhost:6333/collections/support_eval" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'
```

## Seeding Knowledge Base

```typescript
// fixtures/seed-knowledge.ts

async function seedKnowledge() {
  const embeddings = new OllamaEmbeddings()
  const qdrant = new QdrantVectorAdapter('http://localhost:6333', 'support_eval')
  
  // Load knowledge files
  const files = await glob('fixtures/knowledge/**/*.md')
  
  for (const file of files) {
    const { content, metadata } = await parseMarkdownWithFrontmatter(file)
    
    // Generate embedding
    const vector = await embeddings.embed(content)
    
    // Store in Qdrant
    await qdrant.upsert([{
      id: metadata.id || slugify(file),
      vector,
      metadata: {
        ...metadata,
        content,
        source: file,
      }
    }])
  }
}
```

## Production vs Local

| Aspect | Production | Local Eval |
|--------|------------|------------|
| Provider | Upstash Vector | Qdrant |
| Embeddings | Upstash hosted | Ollama local |
| Model | (Upstash default) | nomic-embed-text |
| Dimension | 1536 | 768 |
| Latency | ~100ms | ~50ms |
| Cost | Per-query | Free |

### Dimension Mismatch

Production uses 1536-dim embeddings (OpenAI ada-002 via Upstash). Local uses 768-dim (nomic).

**This is intentional.** The eval environment is isolated from production. We're testing:
- Agent behavior and response quality
- Prompt changes
- Tool call patterns

We're NOT testing:
- Production embedding quality
- Production vector search performance

If you need to test with production-identical embeddings, use Upstash's local emulator (future enhancement).

## Troubleshooting

### "Model not found"

```bash
# Check available models
curl http://localhost:11434/api/tags | jq '.models[].name'

# Pull if missing
ollama pull nomic-embed-text
```

### Slow Embeddings

```bash
# Check if GPU is being used
curl http://localhost:11434/api/show \
  -d '{"name": "nomic-embed-text"}' | jq '.details'

# For CPU-only, expect ~50-100ms per embed
# For GPU, expect ~5-10ms per embed
```

### Out of Memory

```bash
# nomic-embed-text needs ~500MB RAM
# Check Ollama container memory limit
docker stats support-ollama

# Increase if needed in docker/eval.yml:
# deploy:
#   resources:
#     limits:
#       memory: 2G
```

## Batch Embedding Performance

For seeding many documents:

```typescript
// Sequential (safe, ~50ms per doc)
for (const doc of docs) {
  const vector = await embeddings.embed(doc.content)
  await qdrant.upsert([{ id: doc.id, vector, metadata: doc }])
}

// Parallel (faster, watch memory)
const batchSize = 10
for (let i = 0; i < docs.length; i += batchSize) {
  const batch = docs.slice(i, i + batchSize)
  const vectors = await Promise.all(batch.map(d => embeddings.embed(d.content)))
  await qdrant.upsert(batch.map((d, j) => ({ id: d.id, vector: vectors[j], metadata: d })))
}
```
