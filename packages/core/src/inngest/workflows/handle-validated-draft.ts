/**
 * Handle Validated Draft Workflow
 *
 * Bridges validation and approval:
 * - If validation passed and score is high → auto-approve
 * - If validation failed or score is low → request human approval
 */

import { ActionsTable, getDb } from '@skillrecordings/database'
import { randomUUID } from 'crypto'
import {
  initializeAxiom,
  log,
  traceApprovalRequested,
  traceWorkflowStep,
} from '../../observability/axiom'
import { inngest } from '../client'
import {
  SUPPORT_ACTION_APPROVED,
  SUPPORT_APPROVAL_REQUESTED,
  SUPPORT_DRAFT_VALIDATED,
} from '../events'

export const handleValidatedDraft = inngest.createFunction(
  {
    id: 'support-handle-validated',
    name: 'Handle Validated Draft',
    retries: 2,
  },
  { event: SUPPORT_DRAFT_VALIDATED },
  async ({ event, step }) => {
    const { conversationId, messageId, appId, draft, validation } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'handle-validated workflow started', {
      workflow: 'support-handle-validated',
      conversationId,
      messageId,
      appId,
      valid: validation.valid,
      issueCount: validation.issues?.length ?? 0,
      score: validation.score,
    })

    const decision = await step.run('decide-approval', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'evaluating approval decision', {
        workflow: 'support-handle-validated',
        step: 'decide-approval',
        conversationId,
        valid: validation.valid,
        score: validation.score,
      })

      const autoApproveThreshold = 0.8
      const score = validation.score ?? (validation.valid ? 1.0 : 0.0)

      const autoApprove = validation.valid && score >= autoApproveThreshold
      const reason = autoApprove
        ? 'Validation passed with high confidence'
        : validation.issues?.join(', ') || 'Validation did not pass threshold'

      const durationMs = Date.now() - stepStartTime

      await log('info', 'approval decision made', {
        workflow: 'support-handle-validated',
        step: 'decide-approval',
        conversationId,
        appId,
        autoApprove,
        score,
        threshold: autoApproveThreshold,
        reason,
        durationMs,
      })

      await traceWorkflowStep({
        workflowName: 'support-handle-validated',
        conversationId,
        appId,
        stepName: 'decide-approval',
        durationMs,
        success: true,
        metadata: {
          autoApprove,
          score,
          threshold: autoApproveThreshold,
          validationPassed: validation.valid,
          issueCount: validation.issues?.length ?? 0,
        },
      })

      return { autoApprove, reason, score }
    })

    if (decision.autoApprove) {
      const actionId = await step.run('create-approved-action', async () => {
        const stepStartTime = Date.now()

        await log('debug', 'creating auto-approved action', {
          workflow: 'support-handle-validated',
          step: 'create-approved-action',
          conversationId,
        })

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
            validationScore: decision.score,
          },
          requires_approval: false,
          created_at: new Date(),
        })

        const durationMs = Date.now() - stepStartTime

        await log('info', 'auto-approved action created', {
          workflow: 'support-handle-validated',
          step: 'create-approved-action',
          conversationId,
          appId,
          actionId: id,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-handle-validated',
          conversationId,
          appId,
          stepName: 'create-approved-action',
          durationMs,
          success: true,
          metadata: { actionId: id, autoApproved: true },
        })

        return id
      })

      await log('debug', 'emitting action approved event', {
        workflow: 'support-handle-validated',
        conversationId,
        actionId,
      })

      await step.sendEvent('emit-auto-approved', {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: 'auto',
          approvedAt: new Date().toISOString(),
        },
      })

      const totalDurationMs = Date.now() - workflowStartTime

      await log('info', 'handle-validated workflow completed - auto-approved', {
        workflow: 'support-handle-validated',
        conversationId,
        messageId,
        appId,
        actionId,
        outcome: 'auto-approved',
        totalDurationMs,
      })

      await traceWorkflowStep({
        workflowName: 'support-handle-validated',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: totalDurationMs,
        success: true,
        metadata: { outcome: 'auto-approved', actionId },
      })

      return { conversationId, messageId, autoApproved: true, actionId }
    }

    // Request human approval
    const actionId = await step.run('create-pending-action', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'creating pending action for approval', {
        workflow: 'support-handle-validated',
        step: 'create-pending-action',
        conversationId,
        reason: decision.reason,
      })

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
          validationScore: decision.score,
        },
        requires_approval: true,
        created_at: new Date(),
      })

      const durationMs = Date.now() - stepStartTime

      await log('info', 'pending action created', {
        workflow: 'support-handle-validated',
        step: 'create-pending-action',
        conversationId,
        appId,
        actionId: id,
        durationMs,
      })

      await traceWorkflowStep({
        workflowName: 'support-handle-validated',
        conversationId,
        appId,
        stepName: 'create-pending-action',
        durationMs,
        success: true,
        metadata: { actionId: id, autoApproved: false },
      })

      return id
    })

    await log('debug', 'emitting approval requested event', {
      workflow: 'support-handle-validated',
      conversationId,
      actionId,
    })

    await step.sendEvent('emit-approval-requested', {
      name: SUPPORT_APPROVAL_REQUESTED,
      data: {
        actionId,
        conversationId,
        appId,
        action: {
          type: 'send-draft',
          parameters: { draft: draft.content },
        },
        agentReasoning: decision.reason,
      },
    })

    await traceApprovalRequested({
      conversationId,
      appId,
      actionId,
      actionType: 'send-draft',
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'handle-validated workflow completed - approval requested', {
      workflow: 'support-handle-validated',
      conversationId,
      messageId,
      appId,
      actionId,
      outcome: 'approval-requested',
      reason: decision.reason,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-handle-validated',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: { outcome: 'approval-requested', actionId },
    })

    return { conversationId, messageId, autoApproved: false, actionId }
  }
)
