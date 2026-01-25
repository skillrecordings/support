# Memory Schema + Storage Layer Design

## Overview

This document outlines the memory system for the support agent pipeline, enabling learning from decisions and corrections over time.

## Decision: Hybrid Approach

**Chosen: Option 3 - Extend existing memory package**

### Rationale

1. **Existing infrastructure** - The `@skillrecordings/memory` package already provides:
   - Semantic search via Upstash Vector (hosted embeddings)
   - Time-based decay with 30-day half-life
   - Vote/citation tracking with success rates
   - Validation to reset decay clock
   - Prune operations for low-quality memories

2. **Minimal new code** - We extend metadata, not replace the system
3. **No additional infra** - Uses existing Upstash Vector index
4. **Semantic search is primary use case** - "Find similar situations" is the core query pattern

### What's New

- Support-specific metadata fields (stage, outcome, correction, category)
- Formatted content combining situation + decision
- Collection strategy: `support:{app_slug}` for per-app namespacing
- Helper service wrapping MemoryService with support-specific operations

## Schema

### SupportMemoryMetadata (extends MemoryMetadata)

```typescript
interface SupportMemoryMetadata extends MemoryMetadata {
  // Pipeline stage where decision was made
  stage: 'classify' | 'route' | 'gather' | 'draft' | 'validate'
  
  // Outcome after human review
  outcome: 'success' | 'corrected' | 'failed'
  
  // What should have happened (populated on correction)
  correction?: string
  
  // Support category (e.g., 'refund', 'access', 'technical')
  category?: string
  
  // Conversation reference for audit trail
  conversation_id?: string
}
```

### Content Format

The semantic content combines situation and decision for optimal retrieval:

```
SITUATION: Customer purchased course 3 days ago, requesting refund due to unexpected medical expense.

DECISION: Approved immediate refund via Stripe. Applied empathetic response template.
```

This format enables queries like:
- "Customer wants refund medical emergency" → finds similar situations
- "How did we handle refund approval" → finds similar decisions

## Collection Strategy

Collections organized by app for isolation:
- `support:epic-web` - Epic Web decisions
- `support:total-typescript` - Total TypeScript decisions
- `support:badass` - Badass Courses decisions

Global collection for cross-app patterns:
- `support:global` - Common patterns shared across products

## CRUD Operations

### Store

```typescript
await SupportMemoryService.store({
  situation: "Customer purchased 3 days ago, requesting refund",
  decision: "Approved immediate refund with empathetic template",
  stage: 'draft',
  outcome: 'success',
  category: 'refund',
  app_slug: 'epic-web',
  conversation_id: 'cnv_123'
})
```

### Find Similar

```typescript
const results = await SupportMemoryService.findSimilar(
  "customer asking for refund medical",
  { 
    app_slug: 'epic-web',
    stage: 'draft',  // optional filter
    limit: 5 
  }
)
// Returns memories ranked by semantic similarity × confidence
```

### Record Correction

```typescript
await SupportMemoryService.correct(memoryId, {
  correction: "Should have escalated - amount exceeded auto-approve threshold"
})
// Sets outcome to 'corrected', stores what should have happened
```

### Validate

```typescript
await SupportMemoryService.validate(memoryId)
// Resets decay clock when human confirms memory is still accurate
```

## Confidence Decay

Leverages existing decay system:

```
confidence = decay × reputation

decay = 0.5^(age_days / 30)  // 30-day half-life
reputation = weighted(votes, citations, success_rate)
```

When human validates a memory, `last_validated_at` resets, restoring decay to 1.0.

## Integration Points

### Pipeline Integration

Each pipeline stage can:
1. Query similar situations before deciding
2. Store decisions after completion
3. Update outcomes based on human feedback

```typescript
// In classify stage
const similar = await SupportMemoryService.findSimilar(situation, {
  stage: 'classify',
  app_slug
})

// Use similar decisions to inform classification
const classification = await classifyWithContext(message, similar)

// Store decision for future learning
await SupportMemoryService.store({
  situation,
  decision: `Classified as ${classification.category}`,
  stage: 'classify',
  outcome: 'success',  // Updated later if corrected
  category: classification.category,
  app_slug
})
```

### HITL Feedback Loop

When human approves/rejects:
1. Update outcome to 'success' or 'corrected'
2. Store correction if provided
3. Record vote (upvote for success, downvote for failure)

```typescript
// On approval
await SupportMemoryService.recordOutcome(memoryId, 'success')
await VotingService.vote(memoryId, collection, 'upvote')

// On rejection with correction
await SupportMemoryService.correct(memoryId, {
  correction: feedbackText
})
await VotingService.vote(memoryId, collection, 'downvote')
```

## File Structure

```
packages/memory/src/
├── client.ts           # Upstash Vector client (existing)
├── schemas.ts          # Base schemas (existing)
├── memory.ts           # MemoryService (existing)
├── decay.ts            # Decay calculations (existing)
├── voting.ts           # Voting/pruning (existing)
├── support-schemas.ts  # Support-specific schemas (new)
└── support-memory.ts   # SupportMemoryService (new)
```

## Future Considerations

1. **Structured queries** - If filtering by stage/outcome becomes a bottleneck, add a DB table index. For now, metadata filtering in Upstash is sufficient.

2. **Cross-app learning** - Store high-confidence patterns in `support:global` for sharing.

3. **Memory summarization** - Periodically condense similar memories into synthetic summaries.

4. **A/B testing** - Track which memories led to better outcomes for refinement.
