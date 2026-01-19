# Skills Index

Skills are model-invoked: Claude automatically uses them based on description matching.

## Available Skills

| Skill | Triggers on |
|-------|-------------|
| `agent-tool` | tool, agent tool, define tool, refund, license transfer |
| `ai-sdk` | ai sdk, generateText, streamText, tool(), v6, multi-step |
| `front-webhook` | front, webhook, inbound, conversation, message handler |
| `hitl-approval` | hitl, approval, slack approval, human-in-the-loop, review queue |
| `inngest-workflow` | inngest, workflow, step.run, createFunction, async, durable |
| `ops-setup` | setup, configure, env, credentials, API keys |
| `react-best-practices` | react, component, Next.js, performance, bundle size |
| `sdk-adapter` | sdk, adapter, integration, SupportIntegration, onboarding app |
| `stripe-connect` | stripe, connect, oauth, refund, charge, payment |
| `tdd-red-green-refactor` | test, tdd, vitest, red green, failing test |
| `vector-search` | vector, embed, semantic, rag, retrieval, knowledge |
| `vercel-cli` | deploy, vercel, env vars, production, domains |

## How It Works

1. Claude loads skill names + descriptions at startup
2. When your request matches a description, Claude activates the skill
3. Full SKILL.md content is loaded into context
4. Claude follows the skill's instructions

## Skill Format

Each skill has a `SKILL.md` with YAML frontmatter:

```yaml
---
name: skill-name
description: What it does. Use when [trigger phrases].
allowed-tools: Read, Edit, Bash  # optional
---

# Skill Content
Instructions for Claude...
```

## Adding Skills

1. Create directory: `.claude/skills/my-skill/`
2. Add `SKILL.md` with frontmatter
3. Write clear trigger phrases in description
4. Keep under 500 lines (use progressive disclosure for more)
