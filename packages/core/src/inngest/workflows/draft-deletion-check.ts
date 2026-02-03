/**
 * Draft Deletion Check Workflow
 *
 * Detects when agent drafts are discarded (not sent) within the timeout window.
 * This is the "negative signal" for the RL loop - when a human decides NOT to
 * use the agent's draft at all.
 *
 * Flow:
 * 1. Triggered when a draft is created (SUPPORT_DRAFT_CREATED)
 * 2. Waits for 2 hours OR an outbound message for this conversation
 * 3. If timeout reached without outbound → records deletion signal
 *
 * Signal value:
 * - Deleted drafts indicate the agent's response was completely rejected
 * - This is a strong negative signal (not just a correction)
 */

import { ActionsTable, getDb } from '@skillrecordings/database'
import { desc, eq } from 'drizzle-orm'
import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import { DELETION_TIMEOUT_MS, markAsDeleted } from '../../rl'
import { inngest } from '../client'
import { SUPPORT_DRAFT_CREATED, SUPPORT_OUTBOUND_MESSAGE } from '../events'

/**
 * Deletion check workflow - scheduled after each draft creation.
 *
 * Uses Inngest's waitForEvent to efficiently wait for either:
 * - An outbound message (draft was sent, possibly edited)
 * - Timeout (draft was discarded)
 */
export const draftDeletionCheckWorkflow = inngest.createFunction(
  {
    id: 'support-draft-deletion-check',
    name: 'Draft Deletion Check',
    retries: 2,
    // Limit concurrency - we'll have many of these running
    concurrency: {
      limit: 50,
    },
  },
  { event: SUPPORT_DRAFT_CREATED },
  async ({ event, step }) => {
    const {
      conversationId,
      appId,
      draft,
      classification,
      traceId,
      senderEmail,
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'draft deletion check started', {
      workflow: 'support-draft-deletion-check',
      conversationId,
      appId,
      traceId,
      category: classification?.category,
      // Guard against undefined draft.content from incomplete event data
      draftLength: draft?.content?.length ?? 0,
    })

    // Find the action ID for this draft (needed for RL signal)
    const actionId = await step.run('find-action', async () => {
      const stepStartTime = Date.now()

      try {
        const db = getDb()

        // Find the most recent send-draft action for this conversation
        const actions = await db
          .select()
          .from(ActionsTable)
          .where(eq(ActionsTable.conversation_id, conversationId))
          .orderBy(desc(ActionsTable.created_at))
          .limit(5)

        const draftAction = actions.find((a) => a.type === 'send-draft')

        const durationMs = Date.now() - stepStartTime

        await log('info', 'found draft action', {
          workflow: 'support-draft-deletion-check',
          step: 'find-action',
          conversationId,
          actionId: draftAction?.id,
          found: !!draftAction,
          durationMs,
        })

        return draftAction?.id ?? null
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const durationMs = Date.now() - stepStartTime

        await log('error', 'failed to find action', {
          workflow: 'support-draft-deletion-check',
          step: 'find-action',
          conversationId,
          error: errorMsg,
          durationMs,
        })

        return null
      }
    })

    // Wait for an outbound message for this conversation
    // Timeout is 2 hours (DELETION_TIMEOUT_MS)
    const outboundMessage = await step.waitForEvent(
      'wait-for-outbound-message',
      {
        event: SUPPORT_OUTBOUND_MESSAGE,
        match: 'data.conversationId',
        timeout: `${DELETION_TIMEOUT_MS}ms`,
      }
    )

    // If we got an outbound message, the draft was sent (possibly edited)
    // The outbound-tracker workflow handles that case
    if (outboundMessage) {
      const totalDurationMs = Date.now() - workflowStartTime

      await log('info', 'draft was sent, skipping deletion check', {
        workflow: 'support-draft-deletion-check',
        conversationId,
        appId,
        traceId,
        outcome: 'sent',
        totalDurationMs,
      })

      await traceWorkflowStep({
        workflowName: 'support-draft-deletion-check',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: totalDurationMs,
        success: true,
        metadata: { outcome: 'sent' },
      })

      return {
        conversationId,
        outcome: 'sent',
        message: 'Draft was sent, outbound-tracker handles signal',
      }
    }

    // Timeout reached - draft was not sent, mark as deleted
    const deletionSignal = await step.run('record-deletion', async () => {
      const stepStartTime = Date.now()

      // Create deletion result
      const result = markAsDeleted(draft.content)

      // Log the deletion signal
      await log('info', 'RL deletion signal recorded', {
        workflow: 'support-draft-deletion-check',
        step: 'record-deletion',
        conversationId,
        appId,
        actionId,
        traceId,
        // RL signal fields
        rl_category: 'deleted',
        rl_outcome: result.outcome,
        rl_has_draft: true,
        rl_action_id: actionId,
        rl_classification_category: classification.category,
        rl_classification_confidence: classification.confidence,
        // Context
        customerEmail: senderEmail,
        draftPreview: draft.content.slice(0, 100),
      })

      const durationMs = Date.now() - stepStartTime

      await traceWorkflowStep({
        workflowName: 'support-draft-deletion-check',
        conversationId,
        appId,
        stepName: 'record-deletion',
        durationMs,
        success: true,
        metadata: {
          outcome: 'deleted',
          actionId,
          category: classification.category,
        },
      })

      return {
        outcome: result.outcome,
        actionId,
        category: classification.category,
        confidence: classification.confidence,
        recordedAt: result.detectedAt,
      }
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'draft deletion check completed', {
      workflow: 'support-draft-deletion-check',
      conversationId,
      appId,
      traceId,
      outcome: deletionSignal.outcome,
      actionId: deletionSignal.actionId,
      category: deletionSignal.category,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-draft-deletion-check',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        outcome: 'deleted',
        actionId: deletionSignal.actionId,
      },
    })

    return {
      conversationId,
      outcome: 'deleted',
      signal: deletionSignal,
    }
  }
)
