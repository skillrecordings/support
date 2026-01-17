# Phase 2 - Agent Core + Actions

## Goal

Agent with action tools + audited execution.

## Deliverables

- Mastra support-agent
- Tool registry and action executor
- Audit log entries for actions
- Retrieval-first prompt assembly (top-k snippets + summaries only)
- Retrieval-first prompt assembly (top-k snippets + summaries only)

## PR-Ready Checklist

- Agent produces action + draft on a fixture
- Tool execution writes audit record

## Validation / Tests

- Unit: tool requiresApproval logic, action logging
- Integration: agent → tool exec → audit
