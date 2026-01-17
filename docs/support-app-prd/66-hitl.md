# HITL (Slack, Front, Dashboard)

## Slack Approval Flow

```typescript
import { App } from '@slack/bolt'

app.action('approve_action', async ({ ack, body, client }) => {
  await ack()

  const { actionId, approverId } = JSON.parse(body.actions[0].value)
  const result = await executeApprovedAction(actionId, approverId)

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `✅ Approved by <@${approverId}>`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Approved* by <@${approverId}>\n\nResult: ${JSON.stringify(result)}`
        },
      },
    ],
  })
})

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

## Approval Surfaces

- Slack: real-time push, approve/reject, modal for rejection reason
- Dashboard: queue view, bulk actions, search, audit trail
- Front plugin: read + action

## Front Plugin Actions

Read:
- Customer context
- Purchases
- Conversation summary
- Trust scores

Action:
- Approve/edit/reject draft
- Quick refund
- Quick magic link
- Escalate

## Draft Comparison (HITL Scoring)

Token overlap heuristic with pre-tokenize cleanup.

```typescript
function tokenize(text: string): string[] {
  const withoutSig = text
    .replace(/^--\s*[\s\S]*$/m, '')
    .replace(/^(Best|Thanks|Cheers|Regards),?\s*[\s\S]*$/mi, '')

  const withoutQuotes = withoutSig.replace(/^>.*$/gm, '')

  return withoutQuotes
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length > 2)
}

function diffScore(draft: string, sent: string): 'unmodified' | 'edited' | 'rewritten' {
  const draftTokens = new Set(tokenize(draft))
  const sentTokens = new Set(tokenize(sent))
  const intersection = [...draftTokens].filter(t => sentTokens.has(t))
  const overlap = intersection.length / Math.max(draftTokens.size, sentTokens.size)

  if (overlap > 0.95) return 'unmodified'
  if (overlap > 0.50) return 'edited'
  return 'rewritten'
}
```

