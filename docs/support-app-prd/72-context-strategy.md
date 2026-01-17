# Agent Context Strategy

Based on Malte Ubl's guidance: keep live context tiny, store bulk data in files/DB, and rely on search.

## Principles

- Put only a small slice of data into live context (recent messages + minimal app state).
- Organize larger context into files (phase docs + references) and fetch on demand.
- Keep structured data in databases and access via tools.
- Put everything else behind search (keyword + hybrid retrieval).

## Guardrails (Retrieval-First)

- Never assemble full conversation history in the prompt.
- Always retrieve top-k snippets (hybrid + keyword fallback) and summarize.
- Prefer structured tool calls for purchases/entitlements/approvals/trust stats.
- Enforce a strict context budget; summarize or drop long tails.

## Guardrails (Retrieval-First)

- Never assemble full conversation history in the prompt.
- Always retrieve top-k snippets (hybrid + keyword fallback) and summarize.
- Prefer structured tool calls for purchases/entitlements/approvals/trust stats.
- Enforce a strict context budget; summarize or drop long tails.

## Applied Defaults

- DO cache holds only metadata + last 10 message previews + last draft.
- Raw message bodies stored briefly (30 days), then only hashes + IDs.
- Retrieval pipeline: hybrid search with filters; top-k snippets only.
- Agent uses tools to fetch context rather than manual paste.
