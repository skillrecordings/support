# Local Eval System PRD (Overview)

> Deterministic, prod-like evaluation environment for testing prompt changes and measuring response quality.

## Purpose

Run the full support agent pipeline locally with real infrastructure (Docker), enabling prompt A/B testing with proof. No mocks. No "it works differently in prod" bullshit.

## Problem Statement

Current state:
- 45 eval data points from Front
- Quality scorers that detect bad patterns (leaks, meta-commentary, banned phrases)
- **No way to test prompt changes** - can only analyze recorded outputs
- Production failures (51% pass rate) happen because tool responses + context differ from expectations

Desired state:
- Spin up full system locally in one command
- Run agent against test scenarios with real DB, real vector search, real LLM
- Score outputs, compare baselines, prove improvements
- Deterministic and reproducible

## Success Criteria

1. `docker compose up` starts full local environment
2. `skill eval-local run` executes all scenarios and reports quality metrics
3. `skill eval-local compare --candidate prompts/v2.md` shows delta vs baseline
4. Setup guide is copy-paste-able, works first try
5. Scenarios cover all major failure modes (leaks, meta-commentary, routing errors)

## Non-Goals (This Phase)

- CI/CD integration (future)
- Automated prompt optimization
- Production traffic replay (just scenarios for now)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Local Eval Environment                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │  MySQL   │    │  Redis   │    │  Qdrant  │    │  Ollama  │ │
│   │  :3306   │    │  :6379   │    │  :6333   │    │  :11434  │ │
│   └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘ │
│        │               │               │               │        │
│        └───────────────┴───────────────┴───────────────┘        │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    │   Agent Runner    │                        │
│                    │  (bun/packages)   │                        │
│                    └─────────┬─────────┘                        │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    │  Quality Scorers  │                        │
│                    └───────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Index

### Phase Docs (PR-ready)
- Phase 1: Docker Environment → ./01-docker-setup.md
- Phase 2: Seed Data + Fixtures → ./02-seed-fixtures.md
- Phase 3: Eval CLI Commands → ./03-eval-cli.md
- Phase 4: Scenarios + Coverage → ./04-scenarios.md

### Reference Docs
- Local Environment Config → ./60-local-config.md
- Quality Scorers → ./61-quality-scorers.md
- Embedding Strategy → ./62-embeddings.md

## Quick Start (Target UX)

```bash
# 1. Start local infra
cd support
docker compose -f docker/eval.yml up -d

# 2. Seed test data
skill eval-local seed

# 3. Run eval suite
skill eval-local run

# 4. Test a prompt change
skill eval-local compare --candidate prompts/v2.md --baseline current
```

## Locked Decisions

- **Vector DB**: Qdrant (local Docker, API-compatible, easy setup)
- **Embeddings**: Ollama with `nomic-embed-text` (local, fast, good quality)
- **Database**: MySQL 8 (matches PlanetScale behavior)
- **Redis**: Standard Redis (API-compatible with Upstash)
- **LLM for agent**: Anthropic API (same as prod, uses real API key)

## Dependencies on Existing System

- `packages/core/src/agent/config.ts` - agent runner + prompt
- `packages/core/src/evals/response-quality.eval.ts` - quality scorers
- `packages/cli/data/eval-dataset.json` - test data from Front
- `packages/database/src/schema.ts` - DB schema

## Relevant Skills

- `.claude/skills/skill-cli`
- `.claude/skills/data-refresh-eval`
- `.claude/skills/ops-setup`
