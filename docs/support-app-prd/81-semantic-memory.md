# Phase 8.1: Semantic Memory System

> Persistent learning layer for agents and humans - institutional knowledge that survives across sessions.

## Vision

Every support interaction teaches us something. Currently, that knowledge dies with the session. With semantic memory:

- Agent learns "this customer had a refund issue 3 months ago" and adjusts tone
- Agent recalls "we solved this exact error before" and pulls the solution
- Humans can store "Total TypeScript uses this specific license model" for agent reference
- Patterns emerge: "customers mentioning X usually need Y"

**Swarm Learning**: Our support agents operate as a collective. When one agent learns something, all agents benefit. When an agent cites a memory and it leads to a good outcome, that memory gains credibility. When a memory leads to bad outcomes, it loses credibility. The swarm self-corrects over time.

## Success Criteria

1. Sub-100ms retrieval for relevant memories
2. Agents cite prior knowledge in draft reasoning
3. Humans can store/retrieve learnings via CLI and dashboard
4. Cross-product patterns surface (e.g., common Stripe issues across all apps)

## Architecture

### Package: `@skillrecordings/memory`

Core memory service with clean abstractions:

```
packages/memory/
├── src/
│   ├── index.ts              # Public API
│   ├── client.ts             # UpstashVectorClient
│   ├── memory.ts             # MemoryService (store, find, validate)
│   ├── schemas.ts            # Zod schemas for Memory, SearchResult
│   ├── decay.ts              # Confidence decay calculations
│   └── embeddings.ts         # Embedding generation (OpenAI/Upstash)
├── package.json
└── tsconfig.json
```

### Storage Strategy

**Upstash Vector** - Vector storage + metadata in one:
- Vectors stored with namespace per collection
- Metadata embedded in vector records (no separate DB table needed)
- Upstash handles HNSW indexing automatically

**Key difference from reference impl**: No PGlite, no separate metadata table. Upstash Vector stores everything in one place with metadata filtering.

### Data Model

```typescript
interface Memory {
  id: string                    // UUID
  content: string               // The knowledge/learning
  embedding?: number[]          // 1536-dim (OpenAI) or 1024-dim (Upstash)
  metadata: {
    collection: string          // Organization: "learnings", "sessions", "patterns"
    app_slug?: string           // Which app this relates to
    tags: string[]              // Searchable tags
    source: "agent" | "human" | "system"
    confidence: number          // 0-1, decays over time
    created_at: string          // ISO timestamp
    last_validated_at?: string  // Reset decay on validation
  }
}

interface SearchResult {
  memory: Memory
  score: number                 // Final score (after decay)
  raw_score: number             // Before decay
  age_days: number
  decay_factor: number          // 0-1 multiplier
}
```

### Collections

| Collection | Purpose | Sources |
|------------|---------|---------|
| `learnings` | Manual knowledge from humans | CLI, dashboard |
| `sessions` | Auto-captured from agent runs | Inngest workflows |
| `patterns` | Extracted from successful resolutions | Pattern extraction job |
| `customers` | Customer-specific context | Agent observations |

### Decay + Voting Model

**Base decay** - Memories lose relevance over time:

```typescript
const DECAY_HALF_LIFE_DAYS = 30

function calculateDecay(createdAt: Date, lastValidatedAt?: Date): number {
  const referenceDate = lastValidatedAt || createdAt
  const ageDays = (Date.now() - referenceDate.getTime()) / (24 * 60 * 60 * 1000)
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS)
}
```

**Swarm voting** - Agents vote on memory quality through actions:

```typescript
interface MemoryVote {
  memory_id: string
  agent_run_id: string        // Which workflow run
  vote: "upvote" | "downvote" | "cite"
  outcome?: "success" | "failure"  // Filled in after resolution
  timestamp: string
}

interface Memory {
  // ... existing fields
  metadata: {
    // ... existing fields
    votes: {
      upvotes: number         // Explicit "this helped"
      downvotes: number       // Explicit "this was wrong"
      citations: number       // Times retrieved and used
      success_rate: number    // % of citations leading to good outcomes
    }
  }
}
```

**Confidence calculation** combines decay and reputation:

```typescript
function calculateConfidence(memory: Memory): number {
  const decay = calculateDecay(memory.created_at, memory.last_validated_at)
  const votes = memory.metadata.votes

  // Reputation score based on outcomes
  const totalVotes = votes.upvotes + votes.downvotes
  const voteScore = totalVotes > 0
    ? (votes.upvotes - votes.downvotes) / totalVotes
    : 0

  // Citation success matters most
  const citationScore = votes.citations > 0
    ? votes.success_rate
    : 0.5  // Neutral for uncited

  // Combine: decay * weighted(votes, citations)
  const reputationWeight = Math.min(totalVotes + votes.citations, 10) / 10
  const reputation = (voteScore * 0.3 + citationScore * 0.7) * reputationWeight + (1 - reputationWeight) * 0.5

  return decay * reputation
}

// Examples:
// New memory, no votes: confidence = decay * 0.5
// Memory cited 5 times, 80% success: confidence = decay * 0.76
// Memory downvoted by 3 agents: confidence = decay * 0.15
```

**Agent behaviors**:

1. **Retrieve**: Before drafting, agent searches memories
2. **Cite**: If agent uses a memory, record citation
3. **Upvote**: After good outcome, agent upvotes cited memories
4. **Downvote**: After bad outcome (rejection, customer complaint), agent downvotes
5. **Store**: Agent stores new learnings from successful resolutions

**Feedback loop in workflow**:

```typescript
// support/inbound workflow

// 1. Retrieve relevant memories
const memories = await memory.find(context, { limit: 5, min_confidence: 0.4 })

// 2. Cite memories used in draft (recorded automatically)
const citedIds = memories.filter(m => usedInDraft(m, draft)).map(m => m.id)
await memory.cite(citedIds, runId)

// 3. After resolution, record outcome
inngest.on("support/resolved", async ({ data }) => {
  const outcome = data.was_successful ? "success" : "failure"
  await memory.recordOutcome(data.cited_memory_ids, data.run_id, outcome)

  // Auto-vote based on outcome
  if (outcome === "success") {
    await memory.vote(data.cited_memory_ids, "upvote", data.run_id)
  } else {
    await memory.vote(data.cited_memory_ids, "downvote", data.run_id)
  }
})
```

**Pruning** - Low-confidence memories get cleaned up:

```typescript
// Weekly job: remove memories that aren't earning their keep
await memory.prune({
  min_confidence: 0.1,      // Below 10% = delete
  min_age_days: 30,         // Give new memories a chance
  max_downvotes: 5,         // Heavily downvoted = delete regardless of age
})
```

## Agent Prompting

Agents must be explicitly prompted to use memory - it's not automatic. The system prompt includes memory behaviors:

```markdown
## Memory System

You have access to a collective memory shared across all support agents.

### Before responding:
1. **Search memories** for relevant prior knowledge about this customer, product, or issue type
2. **Cite** any memories you use (they'll be tracked for effectiveness)

### After successful resolution:
1. **Store** new learnings that would help future agents
2. **Upvote** memories that helped you
3. **Downvote** memories that were misleading or outdated

### Memory quality guidelines:
- Store facts, not opinions: "Refund window is 30 days" not "I think we should refund"
- Include context: "For Total TypeScript, license transfers require manual approval"
- Be specific: "Error 4001 means the purchase was on a different email" not "Check the email"

### What to store:
- Product-specific policies you discovered
- Customer patterns ("this user has been patient despite multiple issues")
- Resolution patterns ("for this error, the fix is always X")
- Edge cases that aren't in docs

### What NOT to store:
- PII (customer emails, payment details)
- Temporary issues ("site is down right now")
- Opinions or guesses
```

**Tool definitions** for the agent:

```typescript
const memoryTools = [
  {
    name: "memory_search",
    description: "Search collective memory for relevant prior knowledge. Use BEFORE drafting to find helpful context.",
    parameters: {
      query: "Search query - describe what you're looking for",
      limit: "Max results (default 5)",
    }
  },
  {
    name: "memory_store",
    description: "Store a new learning for future agents. Use AFTER successful resolution.",
    parameters: {
      content: "The knowledge to store - be specific and factual",
      tags: "Comma-separated tags for categorization",
    }
  },
  {
    name: "memory_vote",
    description: "Vote on memory quality. Upvote if it helped, downvote if misleading.",
    parameters: {
      memory_id: "ID of the memory to vote on",
      vote: "upvote or downvote",
      reason: "Brief explanation (optional)",
    }
  }
]
```

**Encouraging active use** - The agent is scored on memory engagement:

```typescript
// In agent evaluation/feedback
const memoryEngagement = {
  searched_before_draft: boolean,    // Did agent search memories?
  cited_memories: number,            // How many were cited?
  stored_after_success: boolean,     // Did agent contribute back?
  vote_participation: number,        // Votes cast this session
}

// Low engagement triggers prompt reinforcement
if (!memoryEngagement.searched_before_draft) {
  systemPrompt += "\n\nREMINDER: Search memories before drafting. Prior knowledge often helps."
}
```

## Integration Points

### CLI (`skill memory`)

```bash
# Store a learning
skill memory store "Total TypeScript licenses are perpetual with 1yr updates"
skill memory store "Refund window is 30 days for all products" --tags "refunds,policy"

# Search
skill memory find "refund policy"
skill memory find "license" --app total-typescript
skill memory find "stripe error" --collection patterns

# Manage
skill memory list --collection learnings
skill memory get mem_abc123
skill memory validate mem_abc123    # Reset decay
skill memory delete mem_abc123

# Stats
skill memory stats
```

### Inngest Workflows

Auto-capture at key points:

```typescript
// In support workflow, after successful resolution
await memory.store({
  content: `Resolved ${classification.category} for ${customer.email}: ${summary}`,
  metadata: {
    collection: "sessions",
    app_slug: appSlug,
    tags: [classification.category, outcome],
    source: "agent",
    confidence: 0.8,
  }
})

// Before drafting, retrieve relevant context
const relevant = await memory.find(message.subject + " " + message.body, {
  limit: 5,
  threshold: 0.7,
  app_slug: appSlug,
})
```

### Agent Context

Inject into agent's context window:

```typescript
// In agent tool definitions
const priorKnowledge = await memory.find(query, { limit: 3 })

const context = priorKnowledge.map(r =>
  `[${r.decay_factor > 0.5 ? 'recent' : 'older'}] ${r.memory.content}`
).join('\n')

// Add to system prompt
`You have access to prior learnings:\n${context}`
```

### Dashboard

- View all memories with search
- Manual store/edit/delete
- Validate memories (reset decay)
- See what agent is learning over time

### Front Plugin

Show relevant memories in sidebar when viewing conversation:
- Prior interactions with this customer
- Similar issues and resolutions
- Relevant policies

### Slack Bot

When posting approval requests, include relevant context:
```
Relevant memories:
- [95%] Customer had refund issue 2 weeks ago (validated)
- [72%] Similar error resolved by checking license status
```

## API Design

### MemoryService

```typescript
interface MemoryService {
  // Core operations
  store(content: string, metadata?: Partial<MemoryMetadata>): Promise<Memory>
  find(query: string, options?: SearchOptions): Promise<SearchResult[]>
  get(id: string): Promise<Memory | null>
  delete(id: string): Promise<void>
  validate(id: string): Promise<void>

  // Batch operations
  storeBatch(items: StoreInput[]): Promise<Memory[]>
  findSimilar(memoryId: string, limit?: number): Promise<SearchResult[]>

  // Admin
  stats(): Promise<MemoryStats>
  prune(options?: PruneOptions): Promise<number>  // Remove low-confidence memories
}

interface SearchOptions {
  limit?: number           // Default 10
  threshold?: number       // Min similarity (default 0.5)
  collection?: string      // Filter by collection
  app_slug?: string        // Filter by app
  tags?: string[]          // Filter by tags (AND)
  include_stale?: boolean  // Include <25% confidence (default false)
}
```

### Upstash Vector Client

```typescript
interface UpstashVectorClient {
  upsert(vectors: VectorInput[]): Promise<void>
  query(vector: number[], options: QueryOptions): Promise<QueryResult[]>
  delete(ids: string[]): Promise<void>
  fetch(ids: string[]): Promise<VectorRecord[]>
  info(): Promise<IndexInfo>
}
```

## Implementation Plan

### Subtask 1: Package scaffold + Upstash client
- Create `packages/memory` with tsconfig, package.json
- Implement `UpstashVectorClient` with Zod schemas
- Test connection and basic operations

### Subtask 2: Memory schemas + decay logic
- Define `Memory`, `SearchResult`, `MemoryMetadata` schemas
- Implement decay calculation
- Unit tests for decay math

### Subtask 3: MemoryService implementation
- `store()` - generate embedding, upsert to Upstash
- `find()` - query Upstash, apply decay, filter
- `get()`, `delete()`, `validate()`
- `stats()`, `prune()`

### Subtask 4: CLI commands
- Add `skill memory` command group
- Implement store, find, list, get, validate, delete, stats
- JSON output support

### Subtask 5: Workflow integration
- Add memory retrieval to support workflow (before classification)
- Add memory storage after resolution
- Test with real conversations

### Subtask 6: App integrations
- Front plugin: show relevant memories in sidebar
- Slack bot: include memories in approval context
- Dashboard: memory management UI

## Environment Variables

```bash
# Required (already have these)
UPSTASH_VECTOR_REST_URL=https://xxx.upstash.io
UPSTASH_VECTOR_REST_TOKEN=xxx

# Optional
MEMORY_DECAY_HALF_LIFE_DAYS=30     # Default 30
MEMORY_DEFAULT_CONFIDENCE=0.8      # Default for new memories
MEMORY_STALE_THRESHOLD=0.25        # Below this = stale
```

## Embedding Strategy

**Option A: Upstash Hosted Embeddings** (recommended)
- Upstash generates embeddings server-side
- No additional API keys needed
- Dimension: 1024 (BGE-M3)

**Option B: OpenAI Embeddings**
- Use existing OpenAI key
- Dimension: 1536 (text-embedding-3-small)
- More accurate but adds latency + cost

Start with Upstash hosted, can swap later.

## Success Metrics

1. **Retrieval latency**: p95 < 100ms
2. **Relevance**: >80% of retrieved memories rated "useful" by human review
3. **Coverage**: Agent cites prior knowledge in >30% of drafts
4. **Growth**: Memory corpus grows by 100+ entries/week from agent activity
5. **Validation rate**: >20% of memories validated within 30 days

## Non-Goals (V1)

- Cross-app memory sharing (V2 - privacy concerns)
- Customer-facing memory ("we remember you")
- Memory editing by agents (humans only)
- Real-time memory sync across instances

## References & Inspiration

### Repos

| Repo | Relevance |
|------|-----------|
| [joelhooks/semantic-memory](https://github.com/joelhooks/semantic-memory) | Original inspiration - local-first Effect-TS implementation with PGlite/pgvector. We adapt this for Upstash. |
| [joelhooks/swarm-tools](https://github.com/joelhooks/swarm-tools) | Our swarm coordination layer - memory becomes shared across worker agents |
| [WujiangXu/AgenticMemory](https://github.com/WujiangXu/AgenticMemory) | A-MEM paper implementation - Zettelkasten-style interconnected knowledge networks with dynamic indexing |
| [WujiangXu/A-mem-sys](https://github.com/WujiangXu/A-mem-sys) | Production-ready agentic memory system |
| [mem0ai/mem0](https://github.com/mem0ai/mem0) | Mem0 - scalable memory with graph representations, 26% improvement over OpenAI baseline |
| [getzep/zep](https://github.com/getzep/zep) | Zep - temporal knowledge graph (Graphiti), 90% latency reduction vs full-context |

### Papers & Concepts

**A-MEM: Agentic Memory for LLM Agents** (Xu et al., 2025)
> "Following the basic principles of the Zettelkasten method, we designed our memory system to create interconnected knowledge networks through dynamic indexing and linking. When a new memory is added, we generate a comprehensive note containing multiple structured attributes, including contextual descriptions, keywords, and tags."

Key insight: Memory evolution - new memories trigger updates to existing memories, allowing the network to continuously refine understanding.

**Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory** (Chhikara et al., 2024)
> "Mem0 achieves 26% relative improvements in the LLM-as-a-Judge metric over OpenAI, while Mem0 with graph memory achieves around 2% higher overall score than the base configuration. Mem0 attains a 91% lower p95 latency and saves more than 90% token cost."

Key insight: Graph-based memory representations capture complex relational structures. Memory consolidation from ongoing conversations is critical.

**Zep: Temporal Knowledge Graph Architecture for Agent Memory** (Rasmussen et al., 2025)
> "Zep addresses the fundamental limitation of static document retrieval through Graphiti—a temporally-aware knowledge graph engine that dynamically synthesizes both unstructured conversational data and structured business data while maintaining historical relationships."

Key insight: Temporal awareness matters. Memories need timestamps and the ability to reason about "when" not just "what."

### Pattern: Zettelkasten for AI

The Zettelkasten method (slip-box) principles applied to agent memory:

1. **Atomicity** - Each memory is one discrete piece of knowledge
2. **Connectivity** - Memories link to related memories via semantic similarity
3. **Emergence** - New insights emerge from traversing connection graphs
4. **Evolution** - Existing memories update when new related information arrives

For our support swarm: when one agent learns "refund window is 30 days", that memory links to "Total TypeScript refund policy" and "Stripe refund processing" memories. An agent handling a refund can traverse these links to build full context.

### Pattern: Memory Evolution

From A-MEM:
> "As new memories are integrated, they can trigger updates to the contextual representations and attributes of existing historical memories."

For our system: when an agent stores "Customer X had a second refund issue", it should:
1. Find the prior "Customer X refund issue" memory
2. Update that memory's context: "recurring issue, escalation recommended"
3. Link the two memories bidirectionally

This creates institutional memory that evolves, not just accumulates.

### Pattern: Citation-Based Quality

Traditional PageRank for memories:
- Memories that get cited frequently are more valuable
- Memories that lead to good outcomes gain reputation
- Memories that lead to bad outcomes lose reputation

Combined with decay: a memory that hasn't been cited in 90 days fades, but a frequently-cited memory stays relevant even if old.

### Learning Science Principles

The memory system isn't just storage - it's a learning system. Drawing from instructional design research:

**Retrieval Practice** (Roediger & Karpicke)
> "Deliberately recalling information from memory strengthens long-term retention and learning compared to passive encoding."

For agents: searching memories before drafting is retrieval practice. The act of retrieving strengthens the memory pathway. We should track which memories get retrieved and bias toward them.

**Scaffolding Complex Learning** (Reiser, 2004)
> "Software tools can help structure the learning task, guiding learners through key components and supporting their planning and performance."

For agents: memories scaffold complex support interactions. When an agent encounters "license transfer for Total TypeScript", relevant memories provide structure: "Step 1: verify purchase, Step 2: check transfer count, Step 3: process in Stripe."

**Four-Component Instructional Design** (van Merriënboer & Kirschner)
- **Learning tasks**: Whole, real-world support interactions
- **Supportive information**: Memories that explain "why" and "when"
- **Procedural information**: Memories that explain "how"
- **Part-task practice**: Repeated exposure to common patterns

For agents: organize memories by type:
- `supportive`: "Refund window is 30 days because X"
- `procedural`: "To process a refund: 1, 2, 3"
- `pattern`: "Customers with error 4001 usually need Y"

**Cognitive Load Theory** (Sweller)
> "Sufficient processing capacity must be left for genuine learning."

For agents: don't dump 50 memories into context. Retrieve 3-5 highly relevant ones. The agent's context window is like working memory - overwhelm it and learning (effective drafting) suffers.

**Encoding Variability**
> "Varying context across repeated learning opportunities enhances retention and transfer."

For agents: the same knowledge encountered across different support interactions strengthens transfer. Track which memories appear in diverse contexts vs. narrow ones.

### Books & Papers

| Source | Relevance |
|--------|-----------|
| Ten Steps to Complex Learning (van Merriënboer & Kirschner) | Four-component model for structuring agent learning |
| Taking the Load Off a Learner's Mind (van Merriënboer et al., 2003) | Cognitive load management in rich learning tasks |
| Scaffolding Complex Learning (Reiser, 2004) | How tools structure and problematize learning |
| How People Learn (NRC, 2000) | Foundational learning science |
| Understanding by Design (Wiggins & McTighe) | Backward design for learning outcomes |

## Dependencies

- Upstash Vector index (already provisioned)
- No additional infrastructure needed
