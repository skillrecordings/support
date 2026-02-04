# Front Inbox Management

A Claude Code skill for managing Skill Recordings Front inboxes via the `skill` CLI.
This skill is agent-first and optimized for rapid, safe inbox operations.
It includes product inbox aliases, HATEOAS chaining guidance, and daily briefing workflows.

## Activation

Use this skill automatically when a user mentions any of the following:
- inbox
- front
- triage
- archive
- tags
- any product name listed in the alias table

## Scope

This skill is intentionally narrow.
It focuses on Front inbox management and daily cross-inbox briefings.
Do not use it for billing, refunds, or content support.

## Required Environment

- `FRONT_API_TOKEN`

If the token is missing, report the issue and suggest checking `FRONT_API_TOKEN`.

## Inbox Aliases

These aliases resolve to Front inbox IDs.
All aliases are case-insensitive.

| Product | Inbox ID | Aliases |
| --- | --- | --- |
| Total TypeScript | `inb_3srbb` | `TT`, `typescript`, `total` |
| Pro Tailwind | `inb_3pqh3` | `tailwind`, `ptw` |
| AI Hero | `inb_4bj7r` | `ai-hero`, `aihero` |
| Epic React | `inb_1bwzr` | `react`, `kcd` |
| Epic Web | `inb_jqs2t` | `epicweb` |
| Epic AI | `inb_jqs11` | `epicai` |
| egghead | `inb_1c77r` | `egg` |
| Just JavaScript | `inb_2odqf` | `justjs`, `jj` |
| Testing Accessibility | `inb_3bkef` | `a11y` |
| Pro Next.js | `inb_43olj` | `nextjs`, `pro-next` |

When a user provides an alias, expand it to the corresponding inbox ID.
If the alias is ambiguous or unknown, ask a clarifying question.

## Command Reference

Always prefer JSON output for agent parsing.
Use `--json` when running commands.

### `skill front inbox`

Purpose: list all inboxes with pending counts.

Examples:
```bash
skill front inbox --json
```

### `skill front triage`

Purpose: get pending conversations in JSON for a specific inbox.

Examples:
```bash
skill front triage -i inb_3srbb --json
```

### `skill front conversation`

Purpose: fetch full conversation with messages.

Examples:
```bash
skill front conversation cnv_123 -m --json
```

### `skill front bulk-archive`

Purpose: preview bulk actions with `--dry-run`.

Examples:
```bash
skill front bulk-archive -i inb_3srbb --filter "tag:handled" --dry-run --json
```

### `skill front tags`

Purpose: list all tags used in an inbox.

Examples:
```bash
skill front tags inb_3srbb --json
```

## HATEOAS Chaining Rules

The CLI returns HATEOAS metadata for Front resources.
Follow these rules when chaining calls.

Rules:
- Always use `--json` for agent parsing.
- Follow `_actions` from responses to chain operations.
- Non-destructive actions such as `mark-read` or `tag` can be auto-executed.
- Destructive actions such as `archive` or `delete` require explicit user approval.
- Always run with `--dry-run` before `bulk-archive`.
- When `_actions` has multiple items, ask the user which to prioritize.

HATEOAS response fields:
- `_type` identifies the entity type.
- `_links` includes related resources.
- `_actions` includes next-step operations.

## Daily Briefing Flow

Goal: produce a cross-inbox summary and pick a focus area.

Steps:
1. Query all inboxes in parallel with `skill front triage`.
2. Extract pending counts and urgent tags.
3. Synthesize a concise summary.
4. Ask the user: “What should I focus on?”
5. Execute actions based on the user’s response.

Example summary format:
- `TT: 5 pending (2 urgent), AI Hero: 3 pending (0 urgent)`

## Error Handling

Connection errors:
- Suggest checking `FRONT_API_TOKEN`.

Rate limits:
- Use exponential backoff.
- Retry with increasing delays before giving up.

Malformed responses:
- Fall back to text output and ask the user how to proceed.

## Working Notes

Prefer to work inbox-by-inbox unless the user explicitly asks for a global sweep.
Confirm the inbox ID before destructive operations.
Respect human-in-the-loop approval requirements.

## Examples

See the examples in `examples/` for real command flows.
Use these as templates and adapt to the user’s needs.

---

## Extended Guidance

The following sections provide more detailed operational guidance.
They are intentionally verbose to support consistent behavior.

### Triage Principles

Triage is for sorting actionable vs non-actionable conversations.
Use tags to mark status, urgency, and next steps.
Always log actions in a short summary.

Common triage categories:
- Actionable
- Needs follow-up
- Duplicate
- Noise
- Spam

### Tagging Standards

Use tags consistently across inboxes.
If a tag does not exist, ask before creating a new one.
Avoid creating near-duplicate tags.

Examples of standard tags:
- `urgent`
- `billing`
- `account`
- `bug`
- `feature-request`

### Conversation Review

When reading a conversation:
- Check the subject line.
- Check sender and recipient.
- Read the latest message first.
- Verify tags and assignee.

If a response is needed:
- Draft a short response summary.
- Ask for approval before sending.

### Bulk Archive Guidance

Bulk archive should be used carefully.
Always run with `--dry-run` first.
Ensure the filter is specific and includes a tag or status.
Confirm with the user before executing without `--dry-run`.

### HATEOAS Examples

Example: chain from inbox list to triage.

1. Run inbox list.
```bash
skill front inbox --json
```

2. Choose the inbox with highest pending count.
3. Follow `_actions.triage` for that inbox.
4. Run triage with the resolved inbox ID.

Example: mark read.

1. Get conversation details.
```bash
skill front conversation cnv_123 -m --json
```

2. Follow `_actions.mark-read` and execute.

Example: archive.

1. Get conversation details.
2. If `_actions.archive` exists, ask the user for approval.
3. Execute the archive action after approval.

### Daily Briefing Deep Dive

The daily briefing is a repeatable flow.
It should be fast, consistent, and non-destructive.

Recommended flow order:
- Total TypeScript
- Pro Tailwind
- AI Hero
- Epic React
- Epic Web
- Epic AI
- egghead
- Just JavaScript
- Testing Accessibility
- Pro Next.js

For each inbox:
- Capture pending count.
- Count urgent items.
- Note any blocked or escalated threads.

Synthesize into a single sentence summary.
Ask the user what to focus on next.

### Structured Summary Template

Use this format when reporting to the user:

```
Summary: TT: X pending (Y urgent), AI Hero: X pending (Y urgent), Epic React: X pending (Y urgent)
Recommendation: Focus on TT and AI Hero first.
Question: What should I focus on?
```

### Suggested Next Actions

If the user asks for a plan, propose one of these:
- Start with highest urgent count.
- Clear handled-tagged conversations via bulk archive.
- Review recent unassigned threads.

### Safety Checks

Before destructive actions:
- Confirm the inbox and filter.
- Re-run `--dry-run` if the filter changed.
- Ask for explicit approval.

### Troubleshooting

If commands fail:
- Confirm CLI is installed and `skill` resolves.
- Confirm `FRONT_API_TOKEN` is set.
- Retry with `--json` for full response detail.

### Escalation Path

If the user reports unexpected failures:
- Suggest running `skill front inbox --json`.
- Ask for the error output.
- Provide targeted guidance based on the error.

### Support Boundaries

Do not send messages directly.
Always ask for approval before drafting or sending replies.
Avoid auto-archiving when context is unclear.

### Recap Checklist

Use this checklist before closing a triage session:
- Inbox processed
- Urgent items identified
- Bulk actions reviewed with `--dry-run`
- Summary shared with the user

### Additional References

- `skill front inbox`
- `skill front triage`
- `skill front conversation`
- `skill front bulk-archive`
- `skill front tags`

### Output Format Expectations

JSON output should be parseable and consistent.
If JSON output fails, fall back to text and ask for guidance.

### Example: Alias Expansion

User: “Check TT inbox.”
Action: Expand `TT` to `inb_3srbb` and proceed with triage.

User: “Check Pro Next.”
Action: Expand `pro-next` to `inb_43olj` and proceed.

### Example: Urgent Tag Sweep

Run triage for each inbox.
Collect tags with `urgent` or `escalated`.
Report counts and ask for focus.

### Example: Safe Bulk Archive

1. Run `--dry-run` with a specific tag filter.
2. Share the preview with the user.
3. If approved, re-run without `--dry-run`.

### Example: Conversation Detail Follow-up

When the user asks for details:
- Fetch the conversation.
- Summarize the latest message.
- Offer next actions using `_actions`.

### Example: Cross-Inbox Summary

Provide a compact summary in one line.
Follow it with a clear question asking for focus.

### End State

This skill should make inbox management predictable and safe.
Always prefer clarity over speed when making decisions.
