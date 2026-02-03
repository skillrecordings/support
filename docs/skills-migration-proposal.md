# Skills Migration Proposal: Qdrant → Upstash Vector

## Overview

This document outlines the migration strategy for skills data from local Qdrant (development) to Upstash Vector + Redis (production).

**Key Insight:** Export TEXT to Upstash, not Qdrant embeddings — Upstash auto-embeds with its own model for consistent search.

## Architecture

```mermaid
flowchart LR
    subgraph Development
        Q[Qdrant<br/>1536D OpenAI]
        S[Skills Collection]
        C[Conversations Collection]
    end
    
    subgraph Export
        E[Export Script]
        T[TEXT + Metadata<br/>No Vectors]
    end
    
    subgraph Production
        UV[Upstash Vector<br/>Auto-Embedding]
        UR[Upstash Redis<br/>Metadata Cache]
    end
    
    Q --> E
    S --> E
    C --> E
    E --> T
    T --> UV
    T --> UR
```

## Data Flow

```mermaid
flowchart TD
    subgraph Source["Source (Qdrant)"]
        SK1[Skill Record]
        SK2[skill_id: string]
        SK3[content: string]
        SK4[vector: float[1536]]
        SK5[metadata: object]
    end
    
    subgraph Transform["Transform (Export)"]
        TR1[Extract TEXT fields]
        TR2[Preserve metadata]
        TR3[Drop vectors]
        TR4[Format for Upstash]
    end
    
    subgraph Target["Target (Upstash)"]
        UP1[Skill Record]
        UP2[id: string]
        UP3[data: string]
        UP4[metadata: object]
        UP5[vector: auto-generated]
    end
    
    SK1 --> TR1
    SK3 --> TR1
    SK5 --> TR2
    SK4 -.->|DROPPED| TR3
    TR1 --> TR4
    TR2 --> TR4
    TR4 --> UP1
    UP1 --> UP5
```

## Embedding Strategy

```mermaid
flowchart LR
    subgraph "❌ Wrong Approach"
        W1[Qdrant Vector<br/>OpenAI 1536D]
        W2[Export Vector]
        W3[Import to Upstash]
        W4[Dimension Mismatch!]
        
        W1 --> W2 --> W3 --> W4
    end
    
    subgraph "✅ Correct Approach"
        C1[Qdrant Record]
        C2[Export TEXT Only]
        C3[Upstash Ingests]
        C4[Auto-Embeds<br/>Native Model]
        C5[Consistent Search]
        
        C1 --> C2 --> C3 --> C4 --> C5
    end
```

### Why Export TEXT, Not Vectors

| Aspect | Export Vectors | Export Text |
|--------|---------------|-------------|
| Dimension compatibility | ❌ Must match exactly | ✅ Upstash decides |
| Model consistency | ❌ Mixed models = poor search | ✅ Single model |
| Future flexibility | ❌ Locked to original model | ✅ Upstash can upgrade |
| Simplicity | ❌ Complex dimension handling | ✅ Just text + metadata |

## Validator Integration (Epic 3)

```mermaid
flowchart TD
    subgraph "Epic 3: Validator Overhaul"
        V1[Incoming Draft]
        V2[Skill Retrieval]
        V3[Context Assembly]
        V4[Validation Check]
        V5[Pass/Fail Decision]
    end
    
    subgraph "Upstash Vector"
        UV1[Skills Index]
        UV2[Semantic Search]
        UV3[Top-K Results]
    end
    
    subgraph "Upstash Redis"
        UR1[Skill Metadata Cache]
        UR2[Fast Lookup]
    end
    
    V1 --> V2
    V2 -->|Query| UV1
    UV1 --> UV2
    UV2 --> UV3
    UV3 --> V3
    V2 -->|Metadata| UR1
    UR1 --> UR2
    UR2 --> V3
    V3 --> V4
    V4 --> V5
```

### Integration Points

1. **Skill Retrieval** — Query Upstash Vector with draft context
2. **Metadata Lookup** — Redis cache for fast skill metadata access
3. **Context Assembly** — Combine relevant skills with draft for validation
4. **Validation** — Enhanced validator with skill-aware context

## Migration Steps

1. **Export from Qdrant**
   ```bash
   bun scripts/export-skills-text.ts --output artifacts/skills-export.jsonl
   ```

2. **Transform for Upstash**
   ```bash
   bun scripts/transform-for-upstash.ts --input artifacts/skills-export.jsonl
   ```

3. **Import to Upstash Vector**
   ```bash
   bun scripts/import-upstash-vector.ts --input artifacts/skills-upstash.jsonl
   ```

4. **Populate Redis Cache**
   ```bash
   bun scripts/populate-upstash-redis.ts --input artifacts/skills-metadata.jsonl
   ```

## Related

- [DATA-ARCHITECTURE.md](./DATA-ARCHITECTURE.md) — Full local vs production architecture
- [Epic 3: Validator Overhaul](https://github.com/skillrecordings/support/issues/28)
- [Upstash Vector Docs](https://upstash.com/docs/vector/overall/getstarted)

## References

- Vercel: [Use skills in AI SDK agents via bash-tool](https://vercel.com/changelog/use-skills-in-your-ai-sdk-agents-via-bash-tool)
