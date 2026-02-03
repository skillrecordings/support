/**
 * Handle Validated Draft Workflow
 *
 * Bridges validation and approval:
 * - If validation passed and score is high → auto-approve
 * - If validation failed or score is low → request human approval
 */

import { randomUUID } from 'crypto'
import { markdownToHtml } from '@skillrecordings/core/front/markdown'
import { ActionsTable, getDb } from '@skillrecordings/database'
import { type ChannelList, type InboxList } from '@skillrecordings/front-sdk'
import { eq, sql } from 'drizzle-orm'
import { createInstrumentedFrontClient } from '../../front/instrumented-client'
import {
  initializeAxiom,
  log,
  traceApprovalRequested,
  traceWorkflowStep,
} from '../../observability/axiom'
import { buildDataFlowCheck } from '../../pipeline/assert-data-integrity'
import { formatApprovalComment } from '../../pipeline/steps/comment'
import { inngest } from '../client'
import {
  SUPPORT_ACTION_APPROVED,
  SUPPORT_APPROVAL_REQUESTED,
  SUPPORT_DRAFT_VALIDATED,
} from '../events'

async function getConversationChannelId(
  front: ReturnType<typeof createInstrumentedFrontClient>,
  conversationId: string
): Promise<string | null> {
  const inboxes = await front.raw.get<InboxList>(
    `/conversations/${conversationId}/inboxes`
  )
  const inboxId = inboxes._results?.[0]?.id
  if (!inboxId) return null

  const channels = await front.raw.get<ChannelList>(
    `/inboxes/${inboxId}/channels`
  )
  return channels._results?.[0]?.id ?? null
}

export const handleValidatedDraft = inngest.createFunction(
  {
    id: 'support-handle-validated',
    name: 'Handle Validated Draft',
    retries: 2,
  },
  { event: SUPPORT_DRAFT_VALIDATED },
  async ({ event, step }) => {
    const {
      conversationId,
      messageId,
      appId,
      subject,
      body,
      senderEmail,
      classification,
      draft,
      validation,
      context,
      traceId,
    } = event.data

    // Read classification metadata: prefer top-level classification, fallback to context
    const category = classification?.category ?? context?.category ?? undefined
    const confidence =
      classification?.confidence ?? context?.confidence ?? undefined
    const reasoning =
      classification?.reasoning ?? context?.reasoning ?? undefined

    const workflowStartTime = Date.now()
    initializeAxiom()

    // Data flow check: log what we received from validate-draft
    await log('info', 'handle-validated workflow started', {
      workflow: 'support-handle-validated',
      conversationId,
      messageId,
      appId,
      traceId,
      valid: validation.valid,
      issueCount: validation.issues?.length ?? 0,
      score: validation.score,
      ...buildDataFlowCheck('support-handle-validated', 'receiving', {
        subject,
        body,
        category,
        confidence,
        reasoning,
        draftContent: draft.content,
        signals: classification?.signals,
        purchases: context?.purchaseCount
          ? Array(context.purchaseCount)
          : undefined,
      }),
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

      // AUTO-SEND DISABLED: Always require human approval
      // Previously: autoApproveThreshold = 0.8, auto-sent if score >= threshold
      // Changed 2026-02-02 per Joel's request for safety
      const autoApproveThreshold = Infinity // Effectively disabled
      const score = validation.score ?? (validation.valid ? 1.0 : 0.0)

      const autoApprove = false // Always require human approval
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
            // Flatten key metadata for easy access (from classification)
            category,
            confidence: confidence ?? decision.score,
            reasoning,
            // Original message for audit trail
            subject: subject ?? '',
            body: body ?? '',
            senderEmail: senderEmail ?? '',
            // Keep full context for backward compatibility
            context: context ?? undefined,
          },
          // Dedicated columns for queryability
          category,
          confidence: confidence ?? decision.score,
          reasoning,
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
          traceId,
        },
      })

      const totalDurationMs = Date.now() - workflowStartTime

      await log('info', 'handle-validated workflow completed - auto-approved', {
        workflow: 'support-handle-validated',
        conversationId,
        messageId,
        appId,
        traceId,
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

    // Check if this is a tool-based approval (e.g., refund, transfer)
    const hasToolCalls = draft.toolCalls && draft.toolCalls.length > 0
    const isToolBasedApproval = draft.requiresApproval && hasToolCalls

    // Request human approval
    const actionId = await step.run('create-pending-action', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'creating pending action for approval', {
        workflow: 'support-handle-validated',
        step: 'create-pending-action',
        conversationId,
        reason: decision.reason,
        isToolBasedApproval,
        toolCallCount: draft.toolCalls?.length ?? 0,
      })

      const db = getDb()
      const id = randomUUID()

      // Determine action type based on whether tool calls are present
      const actionType = isToolBasedApproval ? 'tool-execution' : 'send-draft'

      // Build parameters based on action type
      const parameters = isToolBasedApproval
        ? {
            // Tool-based action parameters
            toolCalls: draft.toolCalls,
            draft: draft.content,
            messageId,
            validationIssues: validation.issues,
            validationScore: decision.score,
            // Flatten key metadata for easy access (from classification)
            category,
            confidence: confidence ?? decision.score,
            reasoning,
            // Original message for audit trail
            subject: subject ?? '',
            body: body ?? '',
            senderEmail: senderEmail ?? '',
            // Keep full context for backward compatibility
            context: context ?? undefined,
          }
        : {
            // Standard draft action parameters
            draft: draft.content,
            messageId,
            validationIssues: validation.issues,
            validationScore: decision.score,
            // Flatten key metadata for easy access (from classification)
            category,
            confidence: confidence ?? decision.score,
            reasoning,
            // Original message for audit trail
            subject: subject ?? '',
            body: body ?? '',
            senderEmail: senderEmail ?? '',
            // Keep full context for backward compatibility
            context: context ?? undefined,
          }

      await db.insert(ActionsTable).values({
        id,
        conversation_id: conversationId,
        app_id: appId,
        type: actionType,
        parameters,
        // Dedicated columns for queryability
        category,
        confidence: confidence ?? decision.score,
        reasoning,
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
        actionType,
        isToolBasedApproval,
        toolCallCount: draft.toolCalls?.length ?? 0,
        durationMs,
      })

      await traceWorkflowStep({
        workflowName: 'support-handle-validated',
        conversationId,
        appId,
        stepName: 'create-pending-action',
        durationMs,
        success: true,
        metadata: {
          actionId: id,
          autoApproved: false,
          actionType,
          isToolBasedApproval,
          toolCallCount: draft.toolCalls?.length ?? 0,
        },
      })

      return id
    })

    // Create Front draft for human review/editing
    const draftResult = await step.run('create-front-draft', async () => {
      const stepStartTime = Date.now()

      const frontToken = process.env.FRONT_API_TOKEN
      if (!frontToken) {
        await log('warn', 'FRONT_API_TOKEN not set, skipping Front draft', {
          workflow: 'support-handle-validated',
          step: 'create-front-draft',
          conversationId,
        })
        return { created: false, error: 'FRONT_API_TOKEN not configured' }
      }

      try {
        const front = createInstrumentedFrontClient({ apiToken: frontToken })

        // Get channel ID for creating draft
        const channelId = await getConversationChannelId(front, conversationId)

        if (!channelId) {
          await log('warn', 'no channel found for draft creation', {
            workflow: 'support-handle-validated',
            step: 'create-front-draft',
            conversationId,
          })
          return { created: false, error: 'Could not determine channel' }
        }

        // Create draft in Front
        const frontDraft = await front.drafts.createReply(conversationId, {
          body: markdownToHtml(draft.content),
          channel_id: channelId,
          mode: 'shared',
        })

        const durationMs = Date.now() - stepStartTime

        await log('info', 'Front draft created for review', {
          workflow: 'support-handle-validated',
          step: 'create-front-draft',
          conversationId,
          appId,
          draftId: frontDraft.id,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-handle-validated',
          conversationId,
          appId,
          stepName: 'create-front-draft',
          durationMs,
          success: true,
          metadata: { draftId: frontDraft.id },
        })

        return { created: true, draftId: frontDraft.id }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)

        await log('error', 'failed to create Front draft', {
          workflow: 'support-handle-validated',
          step: 'create-front-draft',
          conversationId,
          error: errorMsg,
        })

        await traceWorkflowStep({
          workflowName: 'support-handle-validated',
          conversationId,
          appId,
          stepName: 'create-front-draft',
          durationMs: Date.now() - stepStartTime,
          success: false,
          metadata: { error: errorMsg },
        })

        return { created: false, error: errorMsg }
      }
    })

    if (draftResult.created && 'draftId' in draftResult) {
      const db = getDb()

      await db
        .update(ActionsTable)
        .set({
          parameters: sql`JSON_SET(parameters, '$.draftId', ${JSON.stringify(
            draftResult.draftId
          )})`,
        })
        .where(eq(ActionsTable.id, actionId))
    }

    // Add approval comment to Front conversation
    await step.run('add-approval-comment', async () => {
      const stepStartTime = Date.now()

      const frontToken = process.env.FRONT_API_TOKEN
      if (!frontToken) {
        await log(
          'warn',
          'FRONT_API_TOKEN not set, skipping approval comment',
          {
            workflow: 'support-handle-validated',
            step: 'add-approval-comment',
            conversationId,
          }
        )
        return { added: false, error: 'FRONT_API_TOKEN not configured' }
      }

      try {
        const front = createInstrumentedFrontClient({ apiToken: frontToken })

        const commentBody = formatApprovalComment({
          draft: draft.content,
          reviewReason: decision.reason,
          confidence: confidence ?? decision.score,
          category,
          customerEmail: senderEmail ?? context?.customerEmail,
        })

        await front.conversations.addComment(conversationId, commentBody)

        const durationMs = Date.now() - stepStartTime

        await log('info', 'approval comment added to conversation', {
          workflow: 'support-handle-validated',
          step: 'add-approval-comment',
          conversationId,
          appId,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-handle-validated',
          conversationId,
          appId,
          stepName: 'add-approval-comment',
          durationMs,
          success: true,
        })

        return { added: true }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)

        await log('error', 'failed to add approval comment', {
          workflow: 'support-handle-validated',
          step: 'add-approval-comment',
          conversationId,
          error: errorMsg,
        })

        await traceWorkflowStep({
          workflowName: 'support-handle-validated',
          conversationId,
          appId,
          stepName: 'add-approval-comment',
          durationMs: Date.now() - stepStartTime,
          success: false,
          metadata: { error: errorMsg },
        })

        return { added: false, error: errorMsg }
      }
    })

    await log('debug', 'emitting approval requested event', {
      workflow: 'support-handle-validated',
      conversationId,
      actionId,
      isToolBasedApproval,
      toolCallCount: draft.toolCalls?.length ?? 0,
    })

    // Build action type and parameters based on whether this is tool-based
    const actionType = isToolBasedApproval ? 'tool-execution' : 'send-draft'
    const actionParameters = isToolBasedApproval
      ? { draft: draft.content, toolCalls: draft.toolCalls }
      : { draft: draft.content }

    await step.sendEvent('emit-approval-requested', {
      name: SUPPORT_APPROVAL_REQUESTED,
      data: {
        actionId,
        conversationId,
        appId,
        action: {
          type: actionType,
          parameters: actionParameters,
        },
        agentReasoning: decision.reason,
        customerEmail: senderEmail || undefined,
        // inboxId is not available at this boundary — it exists in the original
        // webhook event (INBOUND_RECEIVED) but is not threaded through the
        // classify→route→gather→draft→validate chain. Needs pipeline-wide
        // threading to populate here (tracked in Epic 1.5 data flow repairs).
        traceId,
      },
    })

    await traceApprovalRequested({
      conversationId,
      appId,
      actionId,
      actionType,
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log(
      'info',
      'handle-validated workflow completed - approval requested',
      {
        workflow: 'support-handle-validated',
        conversationId,
        messageId,
        appId,
        traceId,
        actionId,
        outcome: 'approval-requested',
        reason: decision.reason,
        isToolBasedApproval,
        actionType,
        toolCallCount: draft.toolCalls?.length ?? 0,
        totalDurationMs,
      }
    )

    await traceWorkflowStep({
      workflowName: 'support-handle-validated',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        outcome: 'approval-requested',
        actionId,
        actionType,
        isToolBasedApproval,
        toolCallCount: draft.toolCalls?.length ?? 0,
      },
    })

    return { conversationId, messageId, autoApproved: false, actionId }
  }
)
