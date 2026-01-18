# Glossary

- **Agent**: LLM-driven support brain that drafts and executes actions.
- **HITL**: Human-in-the-loop approvals via Slack or dashboard.
- **Front**: Source of truth for conversations and message state.
- **Inbox**: One per product (Front inbox IDs map to products).
- **Inngest**: Workflow engine for orchestration.
- **Tool**: Atomic agent action with schema + approval policy.
- **Approval**: Gate for risky actions (e.g., refunds beyond policy).
- **Registry**: App integration metadata + capabilities.
- **Upstash Vector**: Hybrid vector + keyword retrieval store.
- **Trust decay**: Confidence reduction over time (see PRD defaults).
