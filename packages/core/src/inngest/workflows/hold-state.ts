/**
 * Hold State Workflows
 *
 * Handles conversation hold/snooze state:
 * - conversation_snoozed: Conversation put on hold by human, pause escalation
 * - snooze_expired: Snooze period ended, resume escalation if draft pending
 *
 * These events integrate with the escalation timer system to prevent
 * premature escalations while humans are actively managing conversations.
 */

import { ActionsTable, eq, getDb } from '@skillrecordings/database'
import { createInstrumentedFrontClient } from '../../front/instrumented-client'
import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import { inngest } from '../client'
import { SUPPORT_CONVERSATION_SNOOZED, SUPPORT_SNOOZE_EXPIRED } from '../events'

// ============================================================================
// Constants
// ============================================================================

/** Front tag IDs for hold state tracking - configure via env */
const FRONT_TAG_ON_HOLD = process.env.FRONT_TAG_ON_HOLD
const FRONT_TAG_AGENT_DRAFT = process.env.FRONT_TAG_AGENT_DRAFT

// ============================================================================
// Handle Conversation Snoozed
// ============================================================================

/**
 * When a conversation is snoozed:
 * 1. Log the hold state change
 * 2. Add "on-hold" tag if configured
 * 3. Mark any pending approval requests as paused
 *
 * This prevents escalation timers from firing while the conversation
 * is being actively managed by a human.
 */
export const handleConversationSnoozed = inngest.createFunction(
  {
    id: 'support-conversation-snoozed',
    name: 'Handle Conversation Snoozed',
    retries: 2,
  },
  { event: SUPPORT_CONVERSATION_SNOOZED },
  async ({ event, step }) => {
    const {
      conversationId,
      appId,
      inboxId,
      snoozedAt,
      snoozedUntil,
      snoozedBy,
      traceId,
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'conversation snoozed workflow started', {
      workflow: 'support-conversation-snoozed',
      conversationId,
      appId,
      inboxId,
      snoozedAt,
      snoozedUntil,
      snoozedBy: snoozedBy?.email ?? snoozedBy?.id,
      traceId,
    })

    // Step 1: Add "on-hold" tag to Front conversation
    const tagResult = await step.run('add-hold-tag', async () => {
      const stepStartTime = Date.now()

      const frontToken = process.env.FRONT_API_TOKEN
      if (!frontToken) {
        await log('warn', 'FRONT_API_TOKEN not set, skipping hold tag', {
          workflow: 'support-conversation-snoozed',
          step: 'add-hold-tag',
          conversationId,
        })
        return { tagged: false, error: 'FRONT_API_TOKEN not configured' }
      }

      if (!FRONT_TAG_ON_HOLD) {
        await log('debug', 'FRONT_TAG_ON_HOLD not configured, skipping', {
          workflow: 'support-conversation-snoozed',
          step: 'add-hold-tag',
          conversationId,
        })
        return { tagged: false, error: 'FRONT_TAG_ON_HOLD not configured' }
      }

      try {
        const front = createInstrumentedFrontClient({ apiToken: frontToken })
        await front.conversations.addTag(conversationId, FRONT_TAG_ON_HOLD)

        const durationMs = Date.now() - stepStartTime

        await log('info', 'hold tag added to conversation', {
          workflow: 'support-conversation-snoozed',
          step: 'add-hold-tag',
          conversationId,
          tagId: FRONT_TAG_ON_HOLD,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-conversation-snoozed',
          conversationId,
          appId,
          stepName: 'add-hold-tag',
          durationMs,
          success: true,
          metadata: { tagId: FRONT_TAG_ON_HOLD },
        })

        return { tagged: true, tagId: FRONT_TAG_ON_HOLD }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)

        await log('error', 'failed to add hold tag', {
          workflow: 'support-conversation-snoozed',
          step: 'add-hold-tag',
          conversationId,
          error: errorMsg,
        })

        return { tagged: false, error: errorMsg }
      }
    })

    // Step 2: Pause any pending approval timers for this conversation
    const pauseResult = await step.run('pause-escalation-timers', async () => {
      const stepStartTime = Date.now()

      try {
        const db = getDb()

        // Find pending actions for this conversation and mark them as paused
        // We track pause state via a JSON field in parameters
        const pendingActions = await db
          .select()
          .from(ActionsTable)
          .where(eq(ActionsTable.conversation_id, conversationId))

        const pausedCount = pendingActions.filter(
          (a) => a.requires_approval && !a.approved_at && !a.rejected_at
        ).length

        // Update pending actions to include pause metadata
        for (const action of pendingActions) {
          if (
            action.requires_approval &&
            !action.approved_at &&
            !action.rejected_at
          ) {
            const params =
              typeof action.parameters === 'object' ? action.parameters : {}

            await db
              .update(ActionsTable)
              .set({
                parameters: {
                  ...params,
                  _escalationPaused: true,
                  _pausedAt: snoozedAt,
                  _pausedUntil: snoozedUntil,
                },
              })
              .where(eq(ActionsTable.id, action.id))
          }
        }

        const durationMs = Date.now() - stepStartTime

        await log('info', 'escalation timers paused', {
          workflow: 'support-conversation-snoozed',
          step: 'pause-escalation-timers',
          conversationId,
          pausedCount,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-conversation-snoozed',
          conversationId,
          appId,
          stepName: 'pause-escalation-timers',
          durationMs,
          success: true,
          metadata: { pausedCount },
        })

        return { paused: true, count: pausedCount, error: undefined }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)

        await log('error', 'failed to pause escalation timers', {
          workflow: 'support-conversation-snoozed',
          step: 'pause-escalation-timers',
          conversationId,
          error: errorMsg,
        })

        return { paused: false, count: 0, error: errorMsg }
      }
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'conversation snoozed workflow completed', {
      workflow: 'support-conversation-snoozed',
      conversationId,
      appId,
      tagAdded: tagResult.tagged,
      timersPaused: pauseResult.paused,
      pausedCount: pauseResult.count,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-conversation-snoozed',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        tagAdded: tagResult.tagged,
        timersPaused: pauseResult.paused,
        pausedCount: pauseResult.count,
      },
    })

    return {
      conversationId,
      appId,
      results: {
        tag: tagResult,
        pause: pauseResult,
      },
      totalDurationMs,
    }
  }
)

// ============================================================================
// Handle Snooze Expired
// ============================================================================

/**
 * When a snooze expires:
 * 1. Log the state change
 * 2. Remove "on-hold" tag if present
 * 3. Resume any paused escalation timers
 * 4. If a draft is pending, add a comment prompting review
 *
 * This ensures conversations don't get forgotten after a snooze period ends.
 */
export const handleSnoozeExpired = inngest.createFunction(
  {
    id: 'support-snooze-expired',
    name: 'Handle Snooze Expired',
    retries: 2,
  },
  { event: SUPPORT_SNOOZE_EXPIRED },
  async ({ event, step }) => {
    const { conversationId, appId, inboxId, expiredAt, traceId } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'snooze expired workflow started', {
      workflow: 'support-snooze-expired',
      conversationId,
      appId,
      inboxId,
      expiredAt,
      traceId,
    })

    // Step 1: Remove "on-hold" tag from Front conversation
    const tagResult = await step.run('remove-hold-tag', async () => {
      const stepStartTime = Date.now()

      const frontToken = process.env.FRONT_API_TOKEN
      if (!frontToken) {
        await log(
          'warn',
          'FRONT_API_TOKEN not set, skipping hold tag removal',
          {
            workflow: 'support-snooze-expired',
            step: 'remove-hold-tag',
            conversationId,
          }
        )
        return { removed: false, error: 'FRONT_API_TOKEN not configured' }
      }

      if (!FRONT_TAG_ON_HOLD) {
        await log('debug', 'FRONT_TAG_ON_HOLD not configured, skipping', {
          workflow: 'support-snooze-expired',
          step: 'remove-hold-tag',
          conversationId,
        })
        return { removed: false, error: 'FRONT_TAG_ON_HOLD not configured' }
      }

      try {
        const front = createInstrumentedFrontClient({ apiToken: frontToken })
        await front.conversations.removeTag(conversationId, FRONT_TAG_ON_HOLD)

        const durationMs = Date.now() - stepStartTime

        await log('info', 'hold tag removed from conversation', {
          workflow: 'support-snooze-expired',
          step: 'remove-hold-tag',
          conversationId,
          tagId: FRONT_TAG_ON_HOLD,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-snooze-expired',
          conversationId,
          appId,
          stepName: 'remove-hold-tag',
          durationMs,
          success: true,
          metadata: { tagId: FRONT_TAG_ON_HOLD },
        })

        return { removed: true, tagId: FRONT_TAG_ON_HOLD }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)

        // Tag might not be present - not a critical error
        await log('warn', 'failed to remove hold tag (may not be present)', {
          workflow: 'support-snooze-expired',
          step: 'remove-hold-tag',
          conversationId,
          error: errorMsg,
        })

        return { removed: false, error: errorMsg }
      }
    })

    // Step 2: Resume paused escalation timers and check for pending drafts
    const resumeResult = await step.run(
      'resume-escalation-timers',
      async () => {
        const stepStartTime = Date.now()

        try {
          const db = getDb()

          // Find paused actions for this conversation
          const pausedActions = await db
            .select()
            .from(ActionsTable)
            .where(eq(ActionsTable.conversation_id, conversationId))

          let resumedCount = 0
          let hasPendingDraft = false

          for (const action of pausedActions) {
            const params =
              typeof action.parameters === 'object' ? action.parameters : {}

            // Check if this action was paused and is still pending
            if (
              (params as Record<string, unknown>)._escalationPaused &&
              action.requires_approval &&
              !action.approved_at &&
              !action.rejected_at
            ) {
              hasPendingDraft = true
              resumedCount++

              // Clear pause metadata
              const {
                _escalationPaused,
                _pausedAt,
                _pausedUntil,
                ...cleanParams
              } = params as Record<string, unknown>

              await db
                .update(ActionsTable)
                .set({
                  parameters: {
                    ...cleanParams,
                    _escalationResumed: true,
                    _resumedAt: expiredAt,
                  },
                })
                .where(eq(ActionsTable.id, action.id))
            }
          }

          const durationMs = Date.now() - stepStartTime

          await log('info', 'escalation timers resumed', {
            workflow: 'support-snooze-expired',
            step: 'resume-escalation-timers',
            conversationId,
            resumedCount,
            hasPendingDraft,
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'support-snooze-expired',
            conversationId,
            appId,
            stepName: 'resume-escalation-timers',
            durationMs,
            success: true,
            metadata: { resumedCount, hasPendingDraft },
          })

          return {
            resumed: true,
            count: resumedCount,
            hasPendingDraft,
            error: undefined,
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error)

          await log('error', 'failed to resume escalation timers', {
            workflow: 'support-snooze-expired',
            step: 'resume-escalation-timers',
            conversationId,
            error: errorMsg,
          })

          return {
            resumed: false,
            count: 0,
            hasPendingDraft: false,
            error: errorMsg,
          }
        }
      }
    )

    // Step 3: If there's a pending draft, add a reminder comment
    let commentResult: { added: boolean; skipped: boolean; error?: string } = {
      added: false,
      skipped: true,
    }
    if (resumeResult.hasPendingDraft) {
      commentResult = await step.run('add-reminder-comment', async () => {
        const stepStartTime = Date.now()

        const frontToken = process.env.FRONT_API_TOKEN
        if (!frontToken) {
          await log('warn', 'FRONT_API_TOKEN not set, skipping reminder', {
            workflow: 'support-snooze-expired',
            step: 'add-reminder-comment',
            conversationId,
          })
          return {
            added: false,
            skipped: false,
            error: 'FRONT_API_TOKEN not configured',
          }
        }

        try {
          const front = createInstrumentedFrontClient({ apiToken: frontToken })

          const commentBody = `⏰ **Snooze Expired - Draft Pending Review**

This conversation has a pending agent draft that was paused during the snooze period.

Please review and approve/reject the draft, or send a manual response.`

          await front.conversations.addComment(conversationId, commentBody)

          const durationMs = Date.now() - stepStartTime

          await log('info', 'reminder comment added', {
            workflow: 'support-snooze-expired',
            step: 'add-reminder-comment',
            conversationId,
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'support-snooze-expired',
            conversationId,
            appId,
            stepName: 'add-reminder-comment',
            durationMs,
            success: true,
          })

          return { added: true, skipped: false, error: undefined }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error)

          await log('error', 'failed to add reminder comment', {
            workflow: 'support-snooze-expired',
            step: 'add-reminder-comment',
            conversationId,
            error: errorMsg,
          })

          return { added: false, skipped: false, error: errorMsg }
        }
      })
    }

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'snooze expired workflow completed', {
      workflow: 'support-snooze-expired',
      conversationId,
      appId,
      tagRemoved: tagResult.removed,
      timersResumed: resumeResult.resumed,
      resumedCount: resumeResult.count,
      hasPendingDraft: resumeResult.hasPendingDraft,
      reminderAdded: commentResult.added,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-snooze-expired',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        tagRemoved: tagResult.removed,
        timersResumed: resumeResult.resumed,
        resumedCount: resumeResult.count,
        hasPendingDraft: resumeResult.hasPendingDraft,
        reminderAdded: commentResult.added,
      },
    })

    return {
      conversationId,
      appId,
      results: {
        tag: tagResult,
        resume: resumeResult,
        comment: commentResult,
      },
      totalDurationMs,
    }
  }
)
