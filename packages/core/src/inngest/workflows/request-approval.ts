import { inngest } from '../client'
import {
  SUPPORT_APPROVAL_REQUESTED,
  SUPPORT_APPROVAL_DECIDED,
  type SupportApprovalRequestedEvent,
} from '../events'
import { getDb, ApprovalRequestsTable, eq } from '@skillrecordings/database'
import { buildApprovalBlocks } from '@skillrecordings/core/slack/approval-blocks'
import { postApprovalMessage } from '@skillrecordings/core/slack/client'

/**
 * Workflow: Request human approval for agent actions
 *
 * Triggers on support/approval.requested and waits for human decision.
 * Routes approval request to Slack HITL, waits for support/approval.decided
 * event with matching approvalId.
 */
export const requestApproval = inngest.createFunction(
  {
    id: 'request-approval',
    name: 'Request Human Approval',
  },
  { event: SUPPORT_APPROVAL_REQUESTED },
  async ({ event, step }) => {
    const { actionId, conversationId, appId, action, agentReasoning } = event.data

    // Step 1: Create approval request record in DB
    await step.run('create-approval-request', async () => {
      const db = getDb()

      await db.insert(ApprovalRequestsTable).values({
        id: actionId,
        action_id: actionId,
        status: 'pending',
        agent_reasoning: agentReasoning,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      })

      return { created: true, actionId }
    })

    // Step 2: Send Slack notification for HITL approval
    const slackMessage = await step.run('send-slack-notification', async () => {
      const blocks = buildApprovalBlocks({
        actionId,
        conversationId,
        appId,
        actionType: action.type,
        parameters: action.parameters,
        agentReasoning,
      })

      const channel = process.env.SLACK_APPROVAL_CHANNEL
      if (!channel) {
        throw new Error('SLACK_APPROVAL_CHANNEL not configured')
      }

      // Capitalize action type for notification text
      const actionTypeDisplay = action.type
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')

      const { ts, channel: slackChannel } = await postApprovalMessage(
        channel,
        blocks,
        `Approval needed for ${actionTypeDisplay}`
      )

      // Update approval request with Slack message timestamp
      const db = getDb()
      await db
        .update(ApprovalRequestsTable)
        .set({
          slack_message_ts: ts,
          slack_channel: slackChannel,
        })
        .where(eq(ApprovalRequestsTable.id, actionId))

      return { notified: true, actionId, ts, channel: slackChannel }
    })

    // Step 3: Wait for human decision event
    const decision = await step.waitForEvent('wait-for-approval-decision', {
      event: SUPPORT_APPROVAL_DECIDED,
      timeout: '24h',
      match: 'data.approvalId',
    })

    // Step 4: Handle timeout or decision
    if (!decision) {
      // Timeout - mark as expired
      await step.run('handle-timeout', async () => {
        const db = getDb()
        await db
          .update(ApprovalRequestsTable)
          .set({ status: 'expired' })
          .where(eq(ApprovalRequestsTable.id, actionId))

        return { status: 'expired', actionId }
      })
      return { result: 'timeout', actionId }
    }

    // Step 5: Process approval decision
    await step.run('update-approval-status', async () => {
      const db = getDb()
      await db
        .update(ApprovalRequestsTable)
        .set({
          status: decision.data.decision,
        })
        .where(eq(ApprovalRequestsTable.id, actionId))

      return { status: decision.data.decision, actionId }
    })

    return {
      result: decision.data.decision,
      actionId,
      decision: decision.data,
    }
  },
)
