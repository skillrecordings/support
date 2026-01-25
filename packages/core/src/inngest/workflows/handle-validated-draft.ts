import { ActionsTable, getDb } from '@skillrecordings/database'
import { randomUUID } from 'crypto'
import { inngest } from '../client'
import {
  SUPPORT_ACTION_APPROVED,
  SUPPORT_APPROVAL_REQUESTED,
  SUPPORT_DRAFT_VALIDATED,
} from '../events'

/**
 * Workflow: Handle Validated Draft
 *
 * Bridges the gap between validation and approval.
 * - If validation passed and score is high → auto-approve
 * - If validation failed or score is low → request human approval
 *
 * Triggered by: support/draft.validated
 * Emits: support/approval.requested OR support/action.approved
 */
export const handleValidatedDraft = inngest.createFunction(
  {
    id: 'support-handle-validated',
    name: 'Handle Validated Draft',
    retries: 2,
  },
  { event: SUPPORT_DRAFT_VALIDATED },
  async ({ event, step }) => {
    const { conversationId, messageId, appId, draft, validation } = event.data

    console.log('[handle-validated] ========== WORKFLOW STARTED ==========')
    console.log('[handle-validated] Conversation:', conversationId)
    console.log('[handle-validated] Valid:', validation.valid)
    console.log('[handle-validated] Issues:', validation.issues?.length ?? 0)

    // Decide: auto-approve or request human approval
    const decision = await step.run('decide-approval', async () => {
      // Auto-approve if:
      // 1. Validation passed
      // 2. No critical issues
      // 3. Score meets threshold (if available)
      const autoApproveThreshold = 0.8
      const score = validation.score ?? (validation.valid ? 1.0 : 0.0)

      if (validation.valid && score >= autoApproveThreshold) {
        console.log('[handle-validated] Auto-approving (score:', score, ')')
        return { autoApprove: true, reason: 'Validation passed with high confidence' }
      }

      console.log('[handle-validated] Requesting human approval (score:', score, ')')
      return {
        autoApprove: false,
        reason: validation.issues?.join(', ') || 'Validation did not pass threshold',
      }
    })

    if (decision.autoApprove) {
      // Create action record and auto-approve
      const actionId = await step.run('create-approved-action', async () => {
        const db = getDb()
        const id = randomUUID()

        await db.insert(ActionsTable).values({
          id,
          conversation_id: conversationId,
          app_id: appId,
          type: 'send-draft',
          parameters: {
            draft: draft.content,
            messageId,
            autoApproved: true,
          },
          requires_approval: false,
          created_at: new Date(),
        })

        return id
      })

      // Emit action approved for execution
      await step.sendEvent('emit-auto-approved', {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: 'auto',
          approvedAt: new Date().toISOString(),
        },
      })

      console.log('[handle-validated] ========== AUTO-APPROVED ==========')
      return { conversationId, messageId, autoApproved: true, actionId }
    }

    // Request human approval
    const actionId = await step.run('create-pending-action', async () => {
      const db = getDb()
      const id = randomUUID()

      await db.insert(ActionsTable).values({
        id,
        conversation_id: conversationId,
        app_id: appId,
        type: 'send-draft',
        parameters: {
          draft: draft.content,
          messageId,
          validationIssues: validation.issues,
        },
        requires_approval: true,
        created_at: new Date(),
      })

      return id
    })

    // Emit approval request
    await step.sendEvent('emit-approval-requested', {
      name: SUPPORT_APPROVAL_REQUESTED,
      data: {
        actionId,
        conversationId,
        appId,
        action: {
          type: 'send-draft',
          parameters: {
            draft: draft.content,
          },
        },
        agentReasoning: decision.reason,
      },
    })

    console.log('[handle-validated] ========== APPROVAL REQUESTED ==========')
    return { conversationId, messageId, autoApproved: false, actionId }
  }
)
