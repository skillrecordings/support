import { ApprovalRequestsTable, eq, getDb } from '@skillrecordings/database'
import {
  initializeAxiom,
  log,
  traceApprovalRequested,
  traceSlackNotification,
  traceWorkflowStep,
} from '../../observability/axiom'
import { buildApprovalBlocks } from '../../slack/approval-blocks'
import { postApprovalMessage } from '../../slack/client'
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

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'request-approval workflow started', {
      workflow: 'request-approval',
      actionId,
      conversationId,
      appId,
      actionType: action.type,
      hasCustomerEmail: !!customerEmail,
      hasInboxId: !!inboxId,
      agentReasoningLength: agentReasoning?.length ?? 0,
    })

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

      await log('debug', 'creating approval record in database', {
        workflow: 'request-approval',
        step: 'create-approval-request',
        actionId,
        conversationId,
      })

      const db = getDb()

      await db.insert(ApprovalRequestsTable).values({
        id: actionId,
        action_id: actionId,
        status: 'pending',
        agent_reasoning: agentReasoning,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      })

      const durationMs = Date.now() - startTime

      await log('info', 'approval record created', {
        workflow: 'request-approval',
        step: 'create-approval-request',
        actionId,
        conversationId,
        durationMs,
      })

      await traceWorkflowStep({
        conversationId,
        appId,
        workflowName: 'request-approval',
        stepName: 'create-approval-request',
        durationMs,
        success: true,
        metadata: { actionId },
      })

      return { created: true, actionId }
    })

    // Step 2: Send Slack notification for HITL approval
    const slackMessage = await step.run('send-slack-notification', async () => {
      const startTime = Date.now()

      await log('debug', 'building Slack approval blocks', {
        workflow: 'request-approval',
        step: 'send-slack-notification',
        actionId,
        actionType: action.type,
        conversationId,
      })

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

        await log('error', error, {
          workflow: 'request-approval',
          step: 'send-slack-notification',
          actionId,
          conversationId,
        })

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

      await log('debug', 'posting approval message to Slack', {
        workflow: 'request-approval',
        step: 'send-slack-notification',
        actionId,
        channel,
        actionTypeDisplay,
      })

      try {
        const { ts, channel: slackChannel } = await postApprovalMessage(
          channel,
          blocks,
          `Approval needed for ${actionTypeDisplay}`
        )

        await log('info', 'Slack approval message posted', {
          workflow: 'request-approval',
          step: 'send-slack-notification',
          actionId,
          conversationId,
          slackChannel,
          messageTs: ts,
          durationMs: Date.now() - startTime,
        })

        // Update approval request with Slack message timestamp
        const db = getDb()
        await db
          .update(ApprovalRequestsTable)
          .set({
            slack_message_ts: ts,
            slack_channel: slackChannel,
          })
          .where(eq(ApprovalRequestsTable.id, actionId))

        const durationMs = Date.now() - startTime

        await traceSlackNotification({
          conversationId,
          appId,
          actionId,
          success: true,
          channel: slackChannel,
          messageTs: ts,
          durationMs,
        })

        await traceWorkflowStep({
          conversationId,
          appId,
          workflowName: 'request-approval',
          stepName: 'send-slack-notification',
          durationMs,
          success: true,
          metadata: { slackChannel, messageTs: ts },
        })

        return { notified: true, actionId, ts, channel: slackChannel }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const durationMs = Date.now() - startTime

        await log('error', 'Slack approval post failed', {
          workflow: 'request-approval',
          step: 'send-slack-notification',
          actionId,
          conversationId,
          channel,
          error: errorMsg,
          durationMs,
        })

        await traceSlackNotification({
          conversationId,
          appId,
          actionId,
          success: false,
          channel,
          durationMs,
          error: errorMsg,
        })

        await traceWorkflowStep({
          conversationId,
          appId,
          workflowName: 'request-approval',
          stepName: 'send-slack-notification',
          durationMs,
          success: false,
          error: errorMsg,
        })

        throw error
      }
    })

    // Step 3: Wait for human decision event
    await log('info', 'waiting for approval decision', {
      workflow: 'request-approval',
      actionId,
      conversationId,
      timeout: '24h',
      matchField: 'data.actionId',
    })

    const decision = await step.waitForEvent('wait-for-approval-decision', {
      event: SUPPORT_APPROVAL_DECIDED,
      timeout: '24h',
      match: 'data.actionId',
    })

    // Step 4: Handle timeout or decision
    if (!decision) {
      await log('warn', 'approval timed out after 24h', {
        workflow: 'request-approval',
        actionId,
        conversationId,
        appId,
      })

      // Timeout - mark as expired
      await step.run('handle-timeout', async () => {
        const startTime = Date.now()

        await log('debug', 'marking approval as expired', {
          workflow: 'request-approval',
          step: 'handle-timeout',
          actionId,
          conversationId,
        })

        const db = getDb()
        await db
          .update(ApprovalRequestsTable)
          .set({ status: 'expired' })
          .where(eq(ApprovalRequestsTable.id, actionId))

        const durationMs = Date.now() - startTime

        await log('info', 'approval marked as expired', {
          workflow: 'request-approval',
          step: 'handle-timeout',
          actionId,
          conversationId,
          durationMs,
        })

        await traceWorkflowStep({
          conversationId,
          appId,
          workflowName: 'request-approval',
          stepName: 'handle-timeout',
          durationMs,
          success: true,
          metadata: { actionId, result: 'expired' },
        })

        return { status: 'expired', actionId }
      })

      const totalDurationMs = Date.now() - workflowStartTime

      await log('info', 'request-approval workflow completed - timeout', {
        workflow: 'request-approval',
        actionId,
        conversationId,
        appId,
        outcome: 'timeout',
        totalDurationMs,
      })

      await traceWorkflowStep({
        conversationId,
        appId,
        workflowName: 'request-approval',
        stepName: 'complete',
        durationMs: totalDurationMs,
        success: true,
        metadata: { outcome: 'timeout', actionId },
      })

      return { result: 'timeout', actionId }
    }

    await log('info', 'approval decision received', {
      workflow: 'request-approval',
      actionId,
      conversationId,
      appId,
      decision: decision.data.decision,
      decidedBy: decision.data.decidedBy,
    })

    // Step 5: Process approval decision
    await step.run('update-approval-status', async () => {
      const startTime = Date.now()

      await log('debug', 'updating approval status', {
        workflow: 'request-approval',
        step: 'update-approval-status',
        actionId,
        decision: decision.data.decision,
      })

      const db = getDb()
      await db
        .update(ApprovalRequestsTable)
        .set({
          status: decision.data.decision,
        })
        .where(eq(ApprovalRequestsTable.id, actionId))

      const durationMs = Date.now() - startTime

      await log('info', 'approval status updated', {
        workflow: 'request-approval',
        step: 'update-approval-status',
        actionId,
        conversationId,
        decision: decision.data.decision,
        durationMs,
      })

      await traceWorkflowStep({
        conversationId,
        appId,
        workflowName: 'request-approval',
        stepName: 'update-approval-status',
        durationMs,
        success: true,
        metadata: { actionId, decision: decision.data.decision },
      })

      return { status: decision.data.decision, actionId }
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'request-approval workflow completed', {
      workflow: 'request-approval',
      actionId,
      conversationId,
      appId,
      outcome: decision.data.decision,
      totalDurationMs,
    })

    await traceWorkflowStep({
      conversationId,
      appId,
      workflowName: 'request-approval',
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        outcome: decision.data.decision,
        actionId,
      },
    })

    return {
      result: decision.data.decision,
      actionId,
      decision: decision.data,
    }
  }
)
