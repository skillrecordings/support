# Swarm Invocation: Phases 6-8

Copy everything below the line to invoke:

---

/swarm:swarm Implement Phases 6-8: Trust Integration + Observability + Routing + Classifier + Evals

## Master Prompt File
**READ FIRST:** @.claude/swarm-prompts/phases-6-7-8.md

This file contains:
- Progress tracker (UPDATE as you complete deliverables)
- All 16 deliverables with specs
- File reservation strategy
- Eval gates
- Hivemind protocol

## Quick Context

### What exists (don't duplicate)
- `packages/core/src/vector/*` - Upstash client, retrieval, redact
- `packages/core/src/trust/score.ts` - calculateTrustScore(), updateTrustScore(), shouldAutoSend()
- `packages/core/src/agent/config.ts` - has TODO(INTEGRATION) at line 417

### What we're building
1. **Phase 6** - Trust DB + wire real values to agent + feedback loop
2. **Phase 7** - Axiom tracing, Langfuse, rate limits, retention, DLQ
3. **Phase 8** - Router (rules→canned→classifier→agent), cache, evals

## Skills to Load
- @.claude/skills/tdd-red-green-refactor/SKILL.md
- @.claude/skills/inngest-workflow/SKILL.md
- @.claude/skills/vector-search/SKILL.md
- @.claude/skills/agent-tool/SKILL.md

## Docs to Reference
- @docs/support-app-prd/08-vector-trust.md
- @docs/support-app-prd/09-polish-ops.md
- @docs/support-app-prd/10-routing-caching-evals.md
- @docs/TESTING.md
- @docs/CONVENTIONS.md

## Coordinator Instructions

1. **Read the master prompt file** - @.claude/swarm-prompts/phases-6-7-8.md
2. **Query hivemind** for existing patterns before decomposing
3. **Create epic** with subtasks matching file reservation strategy
4. **Spawn workers** with clear file boundaries
5. **Update progress tracker** in master prompt file as subtasks complete
6. **Store learnings** to hivemind throughout
7. **Final wiring subtask runs LAST** - depends on all others

## Worker Instructions

1. **Read your subtask section** in master prompt file
2. **Query hivemind** before writing code
3. **Load relevant skill** for your subtask domain
4. **TDD** - write failing test first
5. **Update master prompt file** - mark your deliverable complete, add notes
6. **Store learnings** to hivemind as you discover them
7. **Run typecheck + tests** before reporting complete

## Hivemind Commands

```
# Search before coding
hivemind_find({ query: "your topic" })

# Store discoveries
hivemind_store({
  information: "what you learned",
  tags: "phase6,phase7,phase8,relevant-tags"
})
```

## Completion Criteria

- [ ] All 16 deliverables marked complete in progress tracker
- [ ] All tests pass (235+ baseline + new tests)
- [ ] Typecheck passes
- [ ] Classifier confidence wired to shouldAutoSend()
- [ ] Trust DB lookup wired to agent
- [ ] Observability instrumented on key paths
- [ ] Eval gates pass on sample dataset
- [ ] Exports wired through index.ts
- [ ] Learnings stored to hivemind
