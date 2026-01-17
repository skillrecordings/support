---
name: hitl-approval
description: Implement human-in-the-loop approval flows. Use when adding Slack approvals, dashboard review queues, action gating, or trust-based auto-approval.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Human-in-the-Loop Approval

Core differentiator: **agent proposes, human approves**. Every sensitive action requires human approval until trust is established.

## Approval Surfaces

| Surface | Use Case | Capabilities |
|---------|----------|--------------|
| **Slack** | Real-time push notifications | Approve/reject buttons, rejection reason modal |
| **Dashboard** | Bulk review, audit trail | Queue view, search, bulk actions |
| **Front Plugin** | In-context approval | View customer data, quick actions |

## Slack Approval Flow

```typescript
import { App } from '@slack/bolt'

// Approve action
app.action('approve_action', async ({ ack, body, client }) => {
  await ack()

  const { actionId, approverId } = JSON.parse(body.actions[0].value)
  const result = await executeApprovedAction(actionId, approverId)

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `Approved by <@${approverId}>`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Approved* by <@${approverId}>\n\nResult: ${JSON.stringify(result)}`
        },
      },
    ],
  })
})

// Reject action (opens modal for reason)
app.action('reject_action', async ({ ack, body, client }) => {
  await ack()

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'rejection_reason',
      title: { type: 'plain_text', text: 'Rejection Reason' },
      blocks: [
        {
          type: 'input',
          block_id: 'reason',
          element: { type: 'plain_text_input', action_id: 'reason_input' },
          label: { type: 'plain_text', text: 'Why are you rejecting this action?' },
        },
      ],
      submit: { type: 'plain_text', text: 'Submit' },
      private_metadata: JSON.stringify({ actionId: body.actions[0].value }),
    },
  })
})
```

## Authority Levels

```typescript
// AUTO-APPROVE (execute immediately)
- Magic link requests
- Password reset requests
- Refunds within 30 days of purchase
- Transfers within 14 days of purchase
- Email/name updates

// REQUIRE-APPROVAL (draft action, wait for human)
- Refunds 30-45 days after purchase
- Transfers after 14 days
- Bulk seat management
- Account deletions

// ALWAYS-ESCALATE (flag for human, do not act)
- Angry/frustrated customers (sentiment detection)
- Legal language (lawsuit, lawyer, etc.)
- Repeated failed interactions
- Anything uncertain
```

## Draft Comparison (HITL Scoring)

Track how much humans modify agent drafts to build trust:

```typescript
function diffScore(draft: string, sent: string): 'unmodified' | 'edited' | 'rewritten' {
  const draftTokens = new Set(tokenize(draft))
  const sentTokens = new Set(tokenize(sent))
  const intersection = [...draftTokens].filter(t => sentTokens.has(t))
  const overlap = intersection.length / Math.max(draftTokens.size, sentTokens.size)

  if (overlap > 0.95) return 'unmodified'  // Trust++
  if (overlap > 0.50) return 'edited'       // Trust neutral
  return 'rewritten'                         // Trust--
}
```

## Trust Decay

Trust score uses exponential decay with 30-day half-life. High-trust agents can auto-send drafts.

## File Locations

- Slack handlers: `apps/slack/app/api/slack/interactions/route.ts`
- Approval request logic: `packages/core/src/hitl/`
- Dashboard approval UI: `apps/web/app/approvals/`

## Reference Docs

For full details, see:
- `docs/support-app-prd/66-hitl.md`
