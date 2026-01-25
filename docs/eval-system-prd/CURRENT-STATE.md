# Eval System - Current State (2026-01-25)

> This doc exists for context continuity across sessions. Read this first.

## TL;DR

**Pipeline eval complete.** 97.2% pass rate with real Docker tools. **Next: Inngest workflow integration.**

## What Works ✅

| Component | Status | Notes |
|-----------|--------|-------|
| Docker Compose | ✅ Works | `docker compose -f docker/eval.yml up -d` |
| Pipeline steps | ✅ Works | classify, route, gather, draft, validate |
| Real tools | ✅ Works | MySQL + Qdrant + Ollama |
| Eval CLI | ✅ Works | `--parallel`, `--cache-classify`, `--fail-fast`, `--quick` |
| Type checks | ✅ Passes | All packages |
| Presales taxonomy | ✅ Works | faq/consult/team categories |

## Current Baseline (2026-01-25 05:15 UTC) 🎉

**97.2% pass rate** (70/72 scenarios, 2 failures)

| Milestone | Pass Rate | 
|-----------|-----------|
| Production (inflated) | 37.8% |
| Honest baseline | 88.9% |
| + Pattern fixes | 90.3% |
| + Presales taxonomy | 91.7% |
| + Routing order fix | **97.2%** |

### Per-Action Breakdown

| Action | Precision | Recall |
|--------|-----------|--------|
| `silence` | 100% | 100% |
| `escalate_urgent` | 100% | 100% |
| `respond` | 100% | 94% |
| `escalate_instructor` | 96% | 100% |
| `escalate_human` | 75% | 100% |

### Remaining 2-4 Failures (flaky due to LLM variance)
- Edge cases where classifier confidence is borderline
- Could tune prompts or accept ~95%+ as "good enough"

---

## Next Phase: Inngest Workflow Integration

### Architecture: Event-Driven Choreography

**NOT** a single orchestrated workflow with steps. Each pipeline step becomes its own Inngest function, triggered by events:

```
Front webhook (inbound email)
       ↓
  inbound.received
       ↓
┌──────────────────┐
│ classifyWorkflow │ → inbound.classified
└──────────────────┘
       ↓
┌──────────────────┐
│  routeWorkflow   │ → inbound.routed
└──────────────────┘
       ↓ (if action=respond)
┌──────────────────┐
│ gatherWorkflow   │ → context.gathered  
└──────────────────┘
       ↓
┌──────────────────┐
│  draftWorkflow   │ → draft.created
└──────────────────┘
       ↓
┌──────────────────┐
│validateWorkflow  │ → draft.validated
└──────────────────┘
       ↓
┌──────────────────┐
│approvalWorkflow  │ → (human review or auto-approve)
└──────────────────┘
       ↓
┌──────────────────┐
│ executeWorkflow  │ → Send reply via Front API
└──────────────────┘
```

### Why Separate Functions (not steps)

| Benefit | Explanation |
|---------|-------------|
| **Retry granularity** | Classify fails? Retry just classify, not the whole chain |
| **Observability** | Each step visible in Inngest dashboard with timing/logs |
| **Fan-out** | Route can trigger multiple downstream flows (respond vs escalate) |
| **Different timeouts** | Draft (LLM) gets 60s, classify gets 10s |
| **Independent scaling** | High-volume classify, lower-volume draft |

### Events Schema

```typescript
// packages/core/src/inngest/events.ts

type Events = {
  'support/inbound.received': {
    data: {
      conversationId: string
      messageId: string
      subject: string
      body: string
      from: string
      appId: string
    }
  }
  
  'support/inbound.classified': {
    data: {
      conversationId: string
      messageId: string
      classification: ClassifyOutput
    }
  }
  
  'support/inbound.routed': {
    data: {
      conversationId: string
      messageId: string
      classification: ClassifyOutput
      route: RouteOutput
    }
  }
  
  'support/context.gathered': {
    data: {
      conversationId: string
      messageId: string
      context: GatherOutput
    }
  }
  
  'support/draft.created': {
    data: {
      conversationId: string
      messageId: string
      draft: DraftOutput
    }
  }
  
  'support/draft.validated': {
    data: {
      conversationId: string
      messageId: string
      draft: DraftOutput
      validation: ValidateOutput
    }
  }
}
```

### Workflow Skeleton

```typescript
// packages/core/src/inngest/workflows/classify.ts

export const classifyWorkflow = inngest.createFunction(
  { id: 'support-classify', name: 'Classify Inbound Message' },
  { event: 'support/inbound.received' },
  async ({ event, step }) => {
    const result = await step.run('classify', () => 
      classify({
        subject: event.data.subject,
        body: event.data.body,
        appId: event.data.appId,
      })
    )
    
    await step.sendEvent('classified', {
      name: 'support/inbound.classified',
      data: {
        conversationId: event.data.conversationId,
        messageId: event.data.messageId,
        classification: result,
      }
    })
    
    return result
  }
)
```

### Implementation Order

1. **Define events** in `packages/core/src/inngest/events.ts`
2. **Create workflow functions** (classify → route → gather → draft → validate)
3. **Wire to Front webhook** — emit `inbound.received` on new message
4. **Add approval flow** — human review before sending
5. **Execute action** — send via Front API or escalate

---

## Quick Commands

```bash
cd ~/Code/skillrecordings/support

# Start Docker services
docker compose -f docker/eval.yml up -d

# Run eval (fast, parallel)
DATABASE_URL="mysql://eval_user:eval_pass@localhost:3306/support_eval" \
  bun packages/cli/src/index.ts eval-pipeline run --step e2e --real-tools \
  --scenarios "fixtures/scenarios/**/*.json" --parallel 10

# Quick smoke test
bun packages/cli/src/index.ts eval-pipeline run --step e2e \
  --scenarios "fixtures/scenarios/**/*.json" --quick --parallel 10

# Seed fixtures
bun packages/cli/src/index.ts eval-pipeline seed --clean
```

## Recent Commits (feat/eval-pipeline-real-tools)

| Commit | Description |
|--------|-------------|
| `ae52d2f` | Routing order fix + scenario annotations (91.7→97.2%) |
| `b907fd3` | Eval CLI: --parallel, --cache-classify, --fail-fast, --quick |
| `9425d17` | Presales routing rules |
| `41c0e97` | Presales knowledge base fixtures |
| `f16a165` | Pattern detection improvements |
| `98c3bbf` | CLI type error fixes |

---

*Last updated: 2026-01-25 05:20 UTC*
