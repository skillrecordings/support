import {
  traceApprovalRequested,
  traceSlackNotification,
  traceWorkflowStep,
} from '../../observability/axiom'
import { buildApprovalBlocks } from '../../slack/approval-blocks'
import { postApprovalMessage } from '../../slack/client'
import { ApprovalRequestsTable, eq, getDb } from '@skillrecordings/database'
import { inngest } from '../client'
import {
  SUPPORT_APPROVAL_DECIDED,
  SUPPORT_APPROVAL_REQUESTED,
  type SupportApprovalRequestedEvent,
} from '../events'

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
    const {
      actionId,
      conversationId,
      appId,
      action,
      agentReasoning,
      customerEmail,
      inboxId,
    } = event.data

    console.log('[request-approval] ========== WORKFLOW STARTED ==========')
    console.log('[request-approval] Action ID:', actionId)
    console.log('[request-approval] Conversation:', conversationId)
    console.log('[request-approval] App:', appId)
    console.log('[request-approval] Action type:', action.type)

    // Trace that we received the approval request
    await traceApprovalRequested({
      conversationId,
      appId,
      actionId,
      actionType: action.type,
      customerEmail,
    })

    // Step 1: Create approval request record in DB
    await step.run('create-approval-request', async () => {
      const startTime = Date.now()
      console.log('[request-approval] Creating approval record...')
      const db = getDb()

      await db.insert(ApprovalRequestsTable).values({
        id: actionId,
        action_id: actionId,
        status: 'pending',
        agent_reasoning: agentReasoning,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      })

      await traceWorkflowStep({
        conversationId,
        appId,
        workflowName: 'request-approval',
        stepName: 'create-approval-request',
        durationMs: Date.now() - startTime,
        success: true,
      })

      console.log('[request-approval] Approval record created')
      return { created: true, actionId }
    })

    // Step 2: Send Slack notification for HITL approval
    const slackMessage = await step.run('send-slack-notification', async () => {
      const startTime = Date.now()
      console.log('[request-approval] Building Slack approval blocks...')

      const blocks = buildApprovalBlocks({
        actionId,
        conversationId,
        appId,
        actionType: action.type,
        parameters: action.parameters,
        agentReasoning,
        customerEmail,
        inboxId,
      })

      const channel = process.env.SLACK_APPROVAL_CHANNEL
      if (!channel) {
        const error = 'SLACK_APPROVAL_CHANNEL not configured'
        await traceSlackNotification({
          conversationId,
          appId,
          actionId,
          success: false,
          durationMs: Date.now() - startTime,
          error,
        })
        throw new Error(error)
      }

      // Capitalize action type for notification text
      const actionTypeDisplay = action.type
        .replace(/_/g, ' ')
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')

      console.log('[request-approval] Posting to Slack channel:', channel)

      try {
        const { ts, channel: slackChannel } = await postApprovalMessage(
          channel,
          blocks,
          `Approval needed for ${actionTypeDisplay}`
        )

        console.log('[request-approval] Slack message posted:', ts)

        // Update approval request with Slack message timestamp
        const db = getDb()
        await db
          .update(ApprovalRequestsTable)
          .set({
            slack_message_ts: ts,
            slack_channel: slackChannel,
          })
          .where(eq(ApprovalRequestsTable.id, actionId))

        await traceSlackNotification({
          conversationId,
          appId,
          actionId,
          success: true,
          channel: slackChannel,
          messageTs: ts,
          durationMs: Date.now() - startTime,
        })

        return { notified: true, actionId, ts, channel: slackChannel }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('[request-approval] Slack post failed:', errorMsg)

        await traceSlackNotification({
          conversationId,
          appId,
          actionId,
          success: false,
          channel,
          durationMs: Date.now() - startTime,
          error: errorMsg,
        })

        throw error
      }
    })

    // Step 3: Wait for human decision event
    console.log(
      '[request-approval] Waiting for approval decision (24h timeout)...'
    )
    console.log('[request-approval] Matching on actionId:', actionId)

    const decision = await step.waitForEvent('wait-for-approval-decision', {
      event: SUPPORT_APPROVAL_DECIDED,
      timeout: '24h',
      match: 'data.actionId',
    })

    // Step 4: Handle timeout or decision
    if (!decision) {
      console.log('[request-approval] Approval timed out after 24h')
      // Timeout - mark as expired
      await step.run('handle-timeout', async () => {
        const startTime = Date.now()
        const db = getDb()
        await db
          .update(ApprovalRequestsTable)
          .set({ status: 'expired' })
          .where(eq(ApprovalRequestsTable.id, actionId))

        await traceWorkflowStep({
          conversationId,
          appId,
          workflowName: 'request-approval',
          stepName: 'handle-timeout',
          durationMs: Date.now() - startTime,
          success: true,
          metadata: { actionId, result: 'expired' },
        })

        return { status: 'expired', actionId }
      })
      return { result: 'timeout', actionId }
    }

    console.log('[request-approval] Decision received:', decision.data.decision)

    // Step 5: Process approval decision
    await step.run('update-approval-status', async () => {
      const startTime = Date.now()
      const db = getDb()
      await db
        .update(ApprovalRequestsTable)
        .set({
          status: decision.data.decision,
        })
        .where(eq(ApprovalRequestsTable.id, actionId))

      await traceWorkflowStep({
        conversationId,
        appId,
        workflowName: 'request-approval',
        stepName: 'update-approval-status',
        durationMs: Date.now() - startTime,
        success: true,
        metadata: { actionId, decision: decision.data.decision },
      })

      return { status: decision.data.decision, actionId }
    })

    console.log('[request-approval] ========== WORKFLOW COMPLETED ==========')
    console.log('[request-approval] Final result:', decision.data.decision)

    return {
      result: decision.data.decision,
      actionId,
      decision: decision.data,
    }
  }
)
