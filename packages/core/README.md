# @skillrecordings/core

Core agent logic, tools, workflows, and registry.

## Purpose
- Agent definition + behavior
- Tool definitions and execution
- Workflow orchestration (Inngest)
- Audit and approvals logic

## Key paths
- `packages/core/src/agent/`
- `packages/core/src/tools/`
- `packages/core/src/workflows/`
- `packages/core/src/registry/`

## Do / Don’t
- Do keep workflows in Inngest
- Don’t add alternate workflow engines
- Do route approvals through HITL
