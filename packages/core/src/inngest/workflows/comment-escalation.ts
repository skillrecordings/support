/**
 * Comment Escalation Workflow
 *
 * When a draft awaits approval for >4h without activity, adds a reminder
 * comment to the Front conversation. Uses Inngest sleep for timing and
 * tracks escalation state to avoid duplicate reminders.
 *
 * Triggers on: support/approval.requested
 * Behavior:
 * - Sleeps for 4 hours
 * - Checks if approval is still pending
 * - Skips if conversation is on hold
 * - Adds reminder comment if still pending
 */

import { ApprovalRequestsTable, eq, getDb } from '@skillrecordings/database'
import { createFrontClient } from '@skillrecordings/front-sdk'
import { isOnHold } from '../../conversation/hold-state'
import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import { inngest } from '../client'
import { SUPPORT_APPROVAL_REQUESTED } from '../events'

/** Escalation delay - 4 hours */
const ESCALATION_DELAY = '4h'

/** Redis key prefix for tracking escalation state */
const ESCALATION_SENT_PREFIX = 'escalation:sent:'

/**
 * Format the escalation reminder comment
 */
function formatEscalationComment(actionId: string): string {
  return `⏰ **Escalation Reminder**

This draft has been awaiting review for over 4 hours.

Please review and take action:
- **Approve** the draft to send it
- **Edit** if changes are needed
- **Reject** if the response is inappropriate

_Action ID: ${actionId}_`
}

/**
 * Comment Escalation Workflow
 *
 * Adds a reminder comment to conversations with drafts pending approval
 * for more than 4 hours.
 */
export const commentEscalationWorkflow = inngest.createFunction(
  {
    id: 'comment-escalation',
    name: 'Comment Escalation (4h Reminder)',
    retries: 2,
    // Concurrency limit to prevent overwhelming Front API
    concurrency: {
      limit: 5,
      key: 'event.data.conversationId',
    },
  },
  { event: SUPPORT_APPROVAL_REQUESTED },
  async ({ event, step }) => {
    const { actionId, conversationId, appId } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'escalation workflow started', {
      workflow: 'comment-escalation',
      actionId,
      conversationId,
      appId,
      escalationDelay: ESCALATION_DELAY,
    })

    // Step 1: Sleep for 4 hours
    await step.sleep('wait-for-escalation', ESCALATION_DELAY)

    await log('debug', 'escalation delay elapsed, checking status', {
      workflow: 'comment-escalation',
      actionId,
      conversationId,
    })

    // Step 2: Check if conversation is on hold
    const holdStatus = await step.run('check-hold-status', async () => {
      const startTime = Date.now()

      const onHold = await isOnHold(conversationId)

      await log('debug', 'hold status checked', {
        workflow: 'comment-escalation',
        step: 'check-hold-status',
        conversationId,
        onHold,
        durationMs: Date.now() - startTime,
      })

      return { onHold }
    })

    if (holdStatus.onHold) {
      await log('info', 'escalation skipped - conversation on hold', {
        workflow: 'comment-escalation',
        actionId,
        conversationId,
        appId,
        outcome: 'skipped-on-hold',
      })

      await traceWorkflowStep({
        workflowName: 'comment-escalation',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: Date.now() - workflowStartTime,
        success: true,
        metadata: { outcome: 'skipped-on-hold', actionId },
      })

      return {
        conversationId,
        actionId,
        outcome: 'skipped-on-hold',
        reason: 'Conversation is on hold',
      }
    }

    // Step 3: Check if approval is still pending
    const approvalStatus = await step.run('check-approval-status', async () => {
      const startTime = Date.now()
      const db = getDb()

      const [approval] = await db
        .select({ status: ApprovalRequestsTable.status })
        .from(ApprovalRequestsTable)
        .where(eq(ApprovalRequestsTable.action_id, actionId))
        .limit(1)

      const durationMs = Date.now() - startTime

      await log('debug', 'approval status checked', {
        workflow: 'comment-escalation',
        step: 'check-approval-status',
        actionId,
        status: approval?.status ?? 'not-found',
        durationMs,
      })

      return {
        status: approval?.status ?? null,
        stillPending: approval?.status === 'pending',
      }
    })

    if (!approvalStatus.stillPending) {
      const outcome =
        approvalStatus.status === null
          ? 'not-found'
          : `already-${approvalStatus.status}`

      await log('info', 'escalation skipped - approval not pending', {
        workflow: 'comment-escalation',
        actionId,
        conversationId,
        appId,
        approvalStatus: approvalStatus.status,
        outcome,
      })

      await traceWorkflowStep({
        workflowName: 'comment-escalation',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: Date.now() - workflowStartTime,
        success: true,
        metadata: {
          outcome,
          actionId,
          approvalStatus: approvalStatus.status,
        },
      })

      return {
        conversationId,
        actionId,
        outcome,
        reason: `Approval status: ${approvalStatus.status ?? 'not found'}`,
      }
    }

    // Step 4: Add escalation reminder comment to conversation
    const commentResult = await step.run('add-escalation-comment', async () => {
      const startTime = Date.now()

      const frontToken = process.env.FRONT_API_TOKEN
      if (!frontToken) {
        await log(
          'warn',
          'FRONT_API_TOKEN not set, skipping escalation comment',
          {
            workflow: 'comment-escalation',
            step: 'add-escalation-comment',
            actionId,
            conversationId,
          }
        )
        return {
          added: false as const,
          error: 'FRONT_API_TOKEN not configured' as string | undefined,
        }
      }

      try {
        const front = createFrontClient({ apiToken: frontToken })
        const commentBody = formatEscalationComment(actionId)

        await front.conversations.addComment(conversationId, commentBody)

        const durationMs = Date.now() - startTime

        await log('info', 'escalation comment added', {
          workflow: 'comment-escalation',
          step: 'add-escalation-comment',
          actionId,
          conversationId,
          appId,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'comment-escalation',
          conversationId,
          appId,
          stepName: 'add-escalation-comment',
          durationMs,
          success: true,
          metadata: { actionId },
        })

        return { added: true as const, error: undefined as string | undefined }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const durationMs = Date.now() - startTime

        await log('error', 'failed to add escalation comment', {
          workflow: 'comment-escalation',
          step: 'add-escalation-comment',
          actionId,
          conversationId,
          error: errorMsg,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'comment-escalation',
          conversationId,
          appId,
          stepName: 'add-escalation-comment',
          durationMs,
          success: false,
          metadata: { error: errorMsg, actionId },
        })

        return { added: false as const, error: errorMsg as string | undefined }
      }
    })

    const totalDurationMs = Date.now() - workflowStartTime
    const outcome = commentResult.added ? 'escalated' : 'failed'

    await log('info', 'escalation workflow completed', {
      workflow: 'comment-escalation',
      actionId,
      conversationId,
      appId,
      outcome,
      commentAdded: commentResult.added,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'comment-escalation',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: commentResult.added,
      metadata: {
        outcome,
        actionId,
        error: commentResult.error,
      },
    })

    return {
      conversationId,
      actionId,
      outcome,
      commentAdded: commentResult.added,
      error: commentResult.error,
    }
  }
)
