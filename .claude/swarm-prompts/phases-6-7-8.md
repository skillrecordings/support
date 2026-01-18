# Swarm: Phases 6-8 Implementation

> Trust Integration + Observability + Routing + Classifier + Evals

## Progress Tracker

| # | Deliverable | Status | Worker | Notes |
|---|-------------|--------|--------|-------|
| 1 | Trust Score Database | ✅ done | abf3883 | Wave 1 |
| 2 | Wire Real Trust to Agent | pending | - | Part of Final Wiring |
| 3 | Trust Score Feedback Loop | ✅ done | a527c06 | Wave 2 |
| 4 | Axiom Tracing | ✅ done | a961740 | Wave 1 |
| 5 | Langfuse LLM Observability | ✅ done | aa9b6e9 | Wave 2 |
| 6 | Rate Limiting | ✅ done | aeea481 | Wave 1 |
| 7 | Retention Policies | ✅ done | a341ffb | Wave 1 |
| 8 | Dead Letter + Alerts | ✅ done | a99aeb1 | Wave 1 |
| 9 | Message Router | ✅ done | ad21140 | Wave 2 |
| 10 | Rules Engine | ✅ done | a01bd8a | Wave 1 |
| 11 | Canned Response Matching | ✅ done | ac6af0a | Wave 2 |
| 12 | Classifier | ✅ done | a08096a | Wave 1 - Fixed zod/v4 import |
| 13 | Decision Cache | ✅ done | a43ddfe | Wave 1 |
| 14 | Evals Harness | ✅ done | a275048 | Wave 3 |
| 15 | Evals CLI Command | ✅ done | ab5d712 | Wave 3 |
| 16 | Final Wiring + Exports | ✅ done | a8b2a43 | Wave 3 |

**Started:** 2026-01-18T21:20
**Completed:** 2026-01-18T22:00
**Tests Passing:** 364 (All phases complete)

---

## Context & References

### PRD Docs
- @docs/support-app-prd/08-vector-trust.md (Phase 6)
- @docs/support-app-prd/09-polish-ops.md (Phase 7)
- @docs/support-app-prd/10-routing-caching-evals.md (Phase 8)

### Reference Docs
- @docs/support-app-prd/70-observability.md
- @docs/support-app-prd/71-vector-search.md
- @docs/support-app-prd/72-context-strategy.md
- @docs/support-app-prd/75-distributed-patterns.md

### Skills (load before relevant subtasks)
- @.claude/skills/tdd-red-green-refactor/SKILL.md - TDD workflow
- @.claude/skills/inngest-workflow/SKILL.md - Workflow patterns
- @.claude/skills/vector-search/SKILL.md - Vector retrieval
- @.claude/skills/agent-tool/SKILL.md - Tool creation patterns

### Conventions
- @docs/TESTING.md - Test requirements, eval specs
- @docs/CONVENTIONS.md - Code style
- @docs/conventions/typescript.md - TS patterns
- @docs/conventions/database.md - DB schema patterns

---

## Existing Infrastructure (DO NOT DUPLICATE)

```
packages/core/src/vector/
├── client.ts      # getVectorIndex(), upsertVector(), queryVectors()
├── retrieval.ts   # buildAgentContext() - already wired to agent
├── redact.ts      # redactPII()
└── types.ts       # VectorDocument, VectorQueryResult

packages/core/src/trust/
├── score.ts       # calculateTrustScore(), updateTrustScore(), shouldAutoSend()
└── types.ts       # TRUST_THRESHOLDS, NEVER_AUTO_SEND_CATEGORIES

packages/core/src/agent/
└── config.ts      # agentTools, runSupportAgent() - has TODO(INTEGRATION) at line 417
```

---

## Deliverables

### PHASE 6: Trust Integration

#### 1. Trust Score Database
**File:** `packages/core/src/trust/repository.ts`
**Schema:** `packages/core/src/db/schema/trust-scores.ts`

```typescript
// Schema
export const trustScores = pgTable('trust_scores', {
  id: text('id').primaryKey(),
  appId: text('app_id').notNull(),
  category: text('category').notNull(),
  score: real('score').notNull().default(0.5),
  sampleCount: integer('sample_count').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Repository
export async function getTrustScore(db, appId, category): Promise<TrustRecord | null>
export async function upsertTrustScore(db, appId, category, update): Promise<void>
```

- Apply decay on read using existing `calculateTrustScore()`
- Composite unique on (appId, category)
- Tests with mock DB

#### 2. Wire Real Trust to Agent
**File:** `packages/core/src/agent/config.ts`

Remove TODO(INTEGRATION) block (lines 417-432). Replace with:

```typescript
// Get category from classifier (or default)
const classifierResult = await classifyMessage(message, context)
const category = classifierResult.category
const confidence = classifierResult.confidence

// Lookup trust from DB
const trustRecord = await getTrustScore(context.db, appId, category)
const trustScore = trustRecord
  ? calculateTrustScore(trustRecord.score, trustRecord.updatedAt)
  : 0.5
const sampleCount = trustRecord?.sampleCount ?? 0

const canAutoSend = shouldAutoSend(category, trustScore, confidence, sampleCount)
```

- Tests for auto-send decision matrix

#### 3. Trust Score Feedback Loop
**File:** `packages/core/src/trust/feedback.ts`

```typescript
export async function recordOutcome(
  db: Database,
  appId: string,
  category: string,
  success: boolean
): Promise<void>
```

- Uses existing `updateTrustScore()` for EMA calculation
- Wire to Inngest approval workflow event handler
- Tests for score drift on approval/rejection sequences

---

### PHASE 7: Observability + Ops

#### 4. Axiom Tracing
**File:** `packages/core/src/observability/axiom.ts`

```typescript
export function withTracing<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string>
): Promise<T>

export function instrumentWebhook(handler): InstrumentedHandler
export function instrumentTool(tool): InstrumentedTool
```

- Wrap: webhook handlers, agent runs, tool executions, Inngest steps
- Attributes: conversationId, appId, traceId, userId
- Tests with mocked `@axiomhq/js`

#### 5. Langfuse LLM Observability
**File:** `packages/core/src/observability/langfuse.ts`

```typescript
export async function traceAgentRun(
  agentRun: AgentRunResult,
  context: ConversationContext
): Promise<{ traceId: string; generationId: string }>

export async function traceClassification(
  input: string,
  output: ClassifierResult,
  usage: TokenUsage
): Promise<string>
```

- Track: model, input/output, tokens, latency, cost estimate
- Link to conversationId + appId for filtering
- Tests with mocked `langfuse`

#### 6. Rate Limiting
**File:** `packages/core/src/middleware/rate-limit.ts`

```typescript
export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter
export function rateLimitMiddleware(limiter: RateLimiter): Middleware
```

- Sliding window algorithm
- Per-app limits from app registry config
- 429 response with Retry-After header
- Tests for enforcement, reset, concurrent requests

#### 7. Retention Policies
**File:** `packages/core/src/services/retention.ts`
**Inngest:** `packages/core/src/inngest/workflows/retention-cleanup.ts`

```typescript
export const RETENTION_DEFAULTS = {
  conversations: 90,  // days
  vectors: 180,
  auditLogs: 365,
  gracePeriod: 7,
}

export async function cleanupExpiredData(db, vectorIndex): Promise<CleanupReport>
```

- Inngest cron: `0 3 * * *` (daily at 3am)
- Soft delete with grace period before hard delete
- Tests for policy enforcement, grace period

#### 8. Dead Letter + Alerts
**File:** `packages/core/src/inngest/dead-letter.ts`

```typescript
export function withDeadLetter<T>(
  fn: InngestFunction<T>,
  options?: DeadLetterOptions
): InngestFunction<T>

export async function alertOnFailure(
  event: FailureEvent,
  consecutiveFailures: number
): Promise<void>
```

- Route failed events to DLQ table
- Alert via Slack after 3+ consecutive failures
- Configurable retry backoff
- Tests for failure routing, alert threshold

---

### PHASE 8: Routing + Classifier + Evals

#### 9. Message Router
**File:** `packages/core/src/router/index.ts`

```typescript
export type RouteType = 'rule' | 'canned' | 'classifier' | 'agent'

export interface RouterDecision {
  route: RouteType
  reason: string
  confidence: number
  category: string
  cannedResponseId?: string
  ruleId?: string
}

export async function routeMessage(
  message: string,
  context: RoutingContext
): Promise<RouterDecision>
```

- Pipeline: rules → canned → classifier → agent
- Early exit on rule/canned match
- Tests for each routing path

#### 10. Rules Engine
**File:** `packages/core/src/router/rules.ts`

```typescript
export interface Rule {
  id: string
  priority: number
  type: 'regex' | 'keyword' | 'sender_domain'
  pattern: string
  action: 'auto_respond' | 'no_respond' | 'escalate' | 'route_to_canned'
  response?: string
  cannedResponseId?: string
}

export function matchRules(message: string, sender: string, rules: Rule[]): RuleMatch | null
```

- Priority ordering (lower = higher priority)
- Per-app rule config in app registry
- Tests with labeled examples

#### 11. Canned Response Matching
**File:** `packages/core/src/router/canned.ts`

```typescript
export interface CannedMatch {
  matched: boolean
  response?: string
  templateId?: string
  similarity?: number
}

export async function matchCannedResponse(
  message: string,
  appId: string,
  threshold?: number
): Promise<CannedMatch>

export function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string
```

- Vector search against type='response' docs
- Default threshold: 0.92
- Variable interpolation: `{{customer_name}}`, `{{product_name}}`
- Tests with sample responses

#### 12. Classifier
**File:** `packages/core/src/router/classifier.ts`

```typescript
export const ClassifierResultSchema = z.object({
  category: z.enum([
    'needs_response',
    'no_response',
    'canned_response',
    'human_required',
    'refund',
    'transfer',
    'account_issue',
    'billing',
    'technical',
    'general',
  ]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

export type ClassifierResult = z.infer<typeof ClassifierResultSchema>

export async function classifyMessage(
  message: string,
  context?: { recentMessages?: string[] }
): Promise<ClassifierResult>
```

- Model: `anthropic/claude-haiku-4-5` (cheap)
- Structured output via AI SDK
- **CRITICAL:** confidence feeds into `shouldAutoSend()`
- Tests with mocked responses

#### 13. Decision Cache
**File:** `packages/core/src/router/cache.ts`

```typescript
export interface CacheConfig {
  decisionTtlMs: number    // 1 hour
  contextTtlMs: number     // 24 hours
}

export class RouterCache {
  getDecision(messageId: string): RouterDecision | null
  setDecision(messageId: string, decision: RouterDecision): void
  invalidateConversation(conversationId: string): void
}
```

- Per-message decision cache
- Per-conversation context cache
- Invalidate on new message
- Idempotency for duplicate Front events
- Tests for hit/miss/invalidation/TTL

#### 14. Evals Harness
**File:** `packages/core/src/evals/routing.ts`

```typescript
export interface EvalDatapoint {
  message: string
  expectedCategory: string
  expectedRoute: RouteType
}

export interface EvalReport {
  precision: number
  recall: number
  fpRate: number
  fnRate: number
  byCategory: Record<string, CategoryMetrics>
  cost: { tokens: number; estimatedUsd: number }
  latency: { p50: number; p95: number; p99: number }
  passed: boolean
}

export async function evalRouting(
  dataset: EvalDatapoint[],
  gates?: EvalGates
): Promise<EvalReport>
```

- Offline runner against labeled dataset
- Per-category breakdown
- Regression gates throw if below threshold
- Tests for harness correctness

#### 15. Evals CLI Command
**File:** `packages/cli/src/commands/eval.ts`

```bash
skill eval routing --dataset path/to/dataset.json [--gates strict|relaxed]
```

- Pretty-print results table
- Exit code 1 if gates fail
- JSON output option for CI
- Tests for CLI behavior

#### 16. Final Wiring + Exports
**Files:**
- `packages/core/src/index.ts` - export all new modules
- `packages/core/src/agent/config.ts` - wire classifier → trust → auto-send

Integration checklist:
- [ ] Classifier returns category + confidence
- [ ] Trust repository lookup with decay
- [ ] shouldAutoSend() receives real values
- [ ] Approval outcome → recordOutcome()
- [ ] All tool calls → Axiom spans
- [ ] All LLM calls → Langfuse traces
- [ ] Router decisions cached

---

## Eval Baseline Gates

| Metric | Threshold | Notes |
|--------|-----------|-------|
| Routing precision | >= 0.92 | Auto-respond accuracy |
| Routing recall | >= 0.95 | Needs-response coverage |
| False positive rate | <= 0.03 | Auto-respond when shouldn't |
| False negative rate | <= 0.02 | No-respond when should |
| Canned coverage | >= 0.25 | % eligible for canned |
| Cost reduction | >= 35% | vs full agent baseline |
| p95 latency reduction | >= 25% | vs full agent baseline |
| Human override rate | <= 0.05 | Corrections to auto-sends |

---

## File Reservation Strategy

Prevents edit conflicts between parallel workers:

| Subtask | Reserved Files |
|---------|---------------|
| A: Trust DB | `packages/core/src/trust/repository.ts`, `packages/core/src/trust/feedback.ts`, `packages/core/src/db/schema/trust-scores.ts` |
| B: Observability | `packages/core/src/observability/**` |
| C: Ops Hardening | `packages/core/src/middleware/**`, `packages/core/src/services/retention.ts`, `packages/core/src/inngest/dead-letter.ts`, `packages/core/src/inngest/workflows/retention-cleanup.ts` |
| D: Router Core | `packages/core/src/router/index.ts`, `packages/core/src/router/rules.ts`, `packages/core/src/router/canned.ts` |
| E: Classifier + Cache | `packages/core/src/router/classifier.ts`, `packages/core/src/router/cache.ts` |
| F: Evals | `packages/core/src/evals/**`, `packages/cli/src/commands/eval.ts` |
| G: Final Wiring | `packages/core/src/agent/config.ts`, `packages/core/src/index.ts` (LAST - depends on all others) |

---

## Hivemind Protocol

### Session Start
```
hivemind_find({ query: "trust scoring auto-send routing classifier" })
hivemind_find({ query: "observability axiom langfuse tracing" })
hivemind_find({ query: "rate limiting retention policies" })
```

### During Work - Store Discoveries
```
hivemind_store({
  information: "Classifier must return { category, confidence } - confidence feeds shouldAutoSend() threshold",
  tags: "classifier,trust,phase8"
})

hivemind_store({
  information: "Trust decay uses calculateTrustScore(baseScore, updatedAt, halfLifeDays=30)",
  tags: "trust,phase6"
})
```

### On Completion - Store Patterns
```
hivemind_store({
  information: "Phase 6-8 complete: Router pipeline is rules→canned→classifier→agent. Classifier confidence + trust DB score feed shouldAutoSend(). Observability via Axiom spans + Langfuse generations.",
  tags: "phase6,phase7,phase8,architecture,complete"
})
```

---

## Rules

1. **Query hivemind FIRST** before writing any code
2. **Store learnings** as you discover them - combat context loss
3. **Update this file** - mark deliverables complete, add notes
4. **TDD** - red → green → refactor, no exceptions
5. **Don't duplicate** - use existing trust/vector infrastructure
6. **Check types** - `bun run check-types` before marking complete
7. **All tests pass** - 235+ baseline must still pass
8. **Wire exports** - everything through `packages/core/src/index.ts`
9. **Mock externals** - Stripe, Axiom, Langfuse, Upstash in tests
10. **Load skills** - read relevant SKILL.md before subtask

---

## Memories Log

> Workers: append learnings here as you discover them

- (none yet)
