# Artifact Registry

Central index of all outputs from the FAQ Mining epic (#94).

## How to Use

- **Producers:** Add row when your task completes, update status
- **Consumers:** Check status before depending on artifact
- **Versioning:** All artifacts use `v{n}/` directories, `latest/` symlink points to current

## Phase 0: Exploration

| Artifact | Location | Format | Producer | Consumers | Status |
|----------|----------|--------|----------|-----------|--------|
| Conversation embeddings | `artifacts/phase-0/embeddings/` | Parquet | #95 | #96, #102 | ✅ Complete |
| Cluster assignments | `artifacts/phase-0/clusters/v1/assignments.json` | JSON | #96 | #97, #100, #102 | ✅ Complete |
| Cluster labels | `artifacts/phase-0/clusters/v1/labels.json` | JSON | #96 | #100, #102 | ✅ Complete |
| Cluster metrics | `artifacts/phase-0/clusters/v1/metrics.json` | JSON | #96 | #100 | ✅ Complete |
| Cluster iterations | `artifacts/phase-0/clusters/v1/iterations.json` | JSON | #96 | #100 | ✅ Complete |
| Golden responses | `artifacts/phase-0/golden/v1/responses.json` | JSON | #97 | #100, #103 | ✅ Complete |
| Response templates | `artifacts/phase-0/golden/v1/templates.json` | JSON | #97 | #100, #103 | ✅ Complete |
| Golden stats | `artifacts/phase-0/golden/v1/stats.json` | JSON | #97 | #100 | ✅ Complete |
| Resolution efficiency | `artifacts/phase-0/metrics/v1/resolution.json` | JSON | #98 | #100, #102 | ✅ Complete |
| Tag co-occurrence | `artifacts/phase-0/metrics/v1/cooccurrence.json` | JSON | #99 | #100, #102 | ✅ Complete |
| Temporal patterns | `artifacts/phase-0/metrics/v1/temporal.json` | JSON | #99 | #100 | ✅ Complete |
| Phase 0 synthesis | `docs/phase-0-synthesis.md` | Markdown | #100 | All Phase 1 | ✅ Complete |
| Phase 0 decisions | `docs/phase-0-decisions.md` | Markdown | #100 | All Phase 1 | ✅ Complete |

## Phase 1: Implementation

| Artifact | Location | Format | Producer | Consumers | Status |
|----------|----------|--------|----------|-----------|--------|
| DuckDB miner adapter | `packages/core/src/faq/duckdb-source.ts` | TypeScript | #101 | #102, #103 | ⬜ Pending |
| Production clusters | `artifacts/phase-1/clustering/` | JSON | #102 | #103 | ⬜ Pending |
| FAQ candidates | Redis `faq:pending:{appId}` | JSON | #103 | #104 | ⬜ Pending |
| Approved FAQs | Redis `faq:approved:{appId}` | JSON | #104 | KB | ⬜ Pending |
| Validation report | `artifacts/phase-1/validation/report.md` | Markdown | #105 | #94 | ⬜ Pending |

## Status Legend

- ⬜ Pending — not started
- 🔄 In Progress — being generated
- ✅ Complete — ready for consumption
- 🔁 Iterating — multiple passes, check version
- ❌ Failed — see issue for details
- ⏪ Rolled Back — reverted to previous version
