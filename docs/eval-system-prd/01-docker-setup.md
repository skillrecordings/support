# Phase 1 - Docker Environment

## Goal

One-command local environment that mirrors production infrastructure.

## Deliverables

- `docker/eval.yml` - Docker Compose file for eval environment
- `docker/init/` - Initialization scripts (schema, seed)
- `.env.eval` - Environment template for local eval
- README section in docs/SETUP-GUIDE.md

## Docker Compose Services

### MySQL 8

```yaml
mysql:
  image: mysql:8.0
  ports:
    - "3306:3306"
  environment:
    MYSQL_ROOT_PASSWORD: eval_root
    MYSQL_DATABASE: support_eval
    MYSQL_USER: eval_user
    MYSQL_PASSWORD: eval_pass
  volumes:
    - mysql_data:/var/lib/mysql
    - ./init/mysql:/docker-entrypoint-initdb.d
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
    interval: 5s
    timeout: 5s
    retries: 10
```

### Redis

```yaml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 5s
    retries: 10
```

### Qdrant (Vector DB)

```yaml
qdrant:
  image: qdrant/qdrant:latest
  ports:
    - "6333:6333"  # REST API
    - "6334:6334"  # gRPC
  volumes:
    - qdrant_data:/qdrant/storage
  environment:
    QDRANT__SERVICE__GRPC_PORT: 6334
```

### Ollama (Embeddings)

```yaml
ollama:
  image: ollama/ollama:latest
  ports:
    - "11434:11434"
  volumes:
    - ollama_data:/root/.ollama
  deploy:
    resources:
      reservations:
        devices:
          - capabilities: [gpu]  # Optional: GPU support
```

## Environment Variables (.env.eval)

```bash
# Database (local MySQL)
DATABASE_URL=mysql://eval_user:eval_pass@localhost:3306/support_eval

# Redis (local)
UPSTASH_REDIS_REST_URL=http://localhost:6379
UPSTASH_REDIS_REST_TOKEN=local_eval_token

# Vector (Qdrant via REST - mimics Upstash Vector API)
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=support_eval

# Embeddings (Ollama)
OLLAMA_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text

# LLM (still uses real Anthropic API)
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

# Eval mode flag
EVAL_MODE=local
```

## Initialization Scripts

### docker/init/mysql/01-schema.sql

```sql
-- Generated from Drizzle schema
-- Run: bun drizzle-kit generate:mysql --out docker/init/mysql

-- Tables: SUPPORT_apps, SUPPORT_conversations, SUPPORT_actions, etc.
```

### docker/init/mysql/02-seed.sql

```sql
-- Test app configuration
INSERT INTO SUPPORT_apps (id, slug, name, integration_base_url, webhook_secret, created_at)
VALUES 
  ('app_eval_tt', 'total-typescript-eval', 'Total TypeScript (Eval)', 'http://host.docker.internal:3456', 'eval_secret_123', NOW()),
  ('app_eval_ah', 'ai-hero-eval', 'AI Hero (Eval)', 'http://host.docker.internal:3457', 'eval_secret_456', NOW());

-- Trust scores (pre-seeded for deterministic behavior)
INSERT INTO SUPPORT_trust_scores (app_id, category, trust_score, sample_count)
VALUES
  ('app_eval_tt', 'refund', 0.85, 50),
  ('app_eval_tt', 'access', 0.92, 100),
  ('app_eval_tt', 'technical', 0.78, 30);
```

## PR-Ready Checklist

- [ ] `docker/eval.yml` created and tested
- [ ] `docker/init/mysql/01-schema.sql` generated from Drizzle
- [ ] `docker/init/mysql/02-seed.sql` with test apps + trust scores
- [ ] `.env.eval.example` template file
- [ ] `docs/SETUP-GUIDE.md` updated with eval environment section
- [ ] Health checks pass for all services
- [ ] Ollama pulls `nomic-embed-text` model on first run

## Validation / Tests

```bash
# Start environment
docker compose -f docker/eval.yml up -d

# Verify services
docker compose -f docker/eval.yml ps  # All healthy

# Test MySQL connection
mysql -h localhost -u eval_user -peval_pass support_eval -e "SELECT COUNT(*) FROM SUPPORT_apps;"

# Test Redis
redis-cli ping  # PONG

# Test Qdrant
curl http://localhost:6333/collections  # {"result":{"collections":[]}...}

# Test Ollama
curl http://localhost:11434/api/tags  # Lists models
ollama pull nomic-embed-text  # If not already pulled

# Run quick agent test
source .env.eval
bun packages/cli/src/index.ts eval-local health
```

## Troubleshooting

### MySQL "Access denied"
```bash
# Reset volumes and restart
docker compose -f docker/eval.yml down -v
docker compose -f docker/eval.yml up -d
```

### Ollama GPU not detected
```bash
# Check NVIDIA driver
nvidia-smi

# Fallback to CPU (slower but works)
# Remove deploy.resources section from ollama service
```

### Qdrant collection not found
```bash
# Collections are created on first use
# Or manually create:
curl -X PUT http://localhost:6333/collections/support_eval \
  -H "Content-Type: application/json" \
  -d '{"vectors": {"size": 768, "distance": "Cosine"}}'
```
