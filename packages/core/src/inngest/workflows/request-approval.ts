import { inngest } from '../client'
import {
  SUPPORT_APPROVAL_REQUESTED,
  SUPPORT_APPROVAL_DECIDED,
  type SupportApprovalRequestedEvent,
} from '../events'

/**
 * Workflow: Request human approval for agent actions
 *
 * Triggers on support/approval.requested and waits for human decision.
 * Routes approval request to Slack HITL, waits for support/approval.decided
 * event with matching approvalId.
 *
 * Phase 1 implementation uses stubs for DB and Slack integration.
 */
export const requestApproval = inngest.createFunction(
  {
    id: 'request-approval',
    name: 'Request Human Approval',
  },
  { event: SUPPORT_APPROVAL_REQUESTED },
  async ({ event, step }) => {
    const { actionId, conversationId, appId, action, agentReasoning } = event.data

    // Step 1: Create approval request record in DB (stub)
    await step.run('create-approval-request', async () => {
      // TODO: Insert into approvals table with status 'pending'
      // await db.insert(approvals).values({
      //   id: actionId,
      //   conversationId,
      //   appId,
      //   actionType: action.type,
      //   actionParameters: action.parameters,
      //   agentReasoning,
      //   status: 'pending',
      //   createdAt: new Date(),
      // })
      return { created: true, actionId }
    })

    // Step 2: Send Slack notification for HITL approval (stub)
    await step.run('send-slack-notification', async () => {
      // TODO: Call Slack API to post approval request
      // Include: action type, parameters, reasoning, approve/reject buttons
      // await slackClient.postMessage({
      //   channel: env.SLACK_APPROVAL_CHANNEL,
      //   text: `Approval needed for ${action.type}`,
      //   blocks: buildApprovalBlocks({ actionId, action, agentReasoning }),
      // })
      return { notified: true, actionId }
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
        // TODO: Update approval status to 'expired'
        // await db.update(approvals)
        //   .set({ status: 'expired', resolvedAt: new Date() })
        //   .where(eq(approvals.id, actionId))
        return { status: 'expired', actionId }
      })
      return { result: 'timeout', actionId }
    }

    // Step 5: Process approval decision
    const isApproved = decision.data.decision === 'approved'
    await step.run('update-approval-status', async () => {
      // TODO: Update approval record with decision
      // await db.update(approvals)
      //   .set({
      //     status: decision.data.decision,
      //     resolvedBy: decision.data.decidedBy,
      //     resolvedAt: new Date(decision.data.decidedAt),
      //     rejectionReason: decision.data.reason,
      //   })
      //   .where(eq(approvals.id, actionId))
      return { status: decision.data.decision, actionId }
    })

    return {
      result: decision.data.decision,
      actionId,
      decision: decision.data,
    }
  },
)
