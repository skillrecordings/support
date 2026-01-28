/**
 * Outbound Message Tracker Workflow
 *
 * THE core signal for the RL loop. When a teammate sends a message:
 * 1. Fetch the full message from Front API
 * 2. Find the most recent agent draft for this conversation
 * 3. Compare draft vs sent message
 * 4. Store signal for RL loop consumption
 *
 * Signal categories:
 * - unchanged: Draft sent as-is → strong positive signal
 * - minor_edit: Small edits (typos, wording) → weak positive
 * - major_rewrite: Significant changes → correction signal (10x learning value!)
 * - no_draft: No agent draft existed → manual response (baseline)
 */

import { ActionsTable, getDb } from '@skillrecordings/database'
import { createFrontClient } from '@skillrecordings/front-sdk'
import { desc, eq } from 'drizzle-orm'
import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import { inngest } from '../client'
import { type DraftDiffCategory, SUPPORT_OUTBOUND_MESSAGE } from '../events'

/**
 * Compute text similarity using Levenshtein distance normalized to [0,1]
 * 1.0 = identical, 0.0 = completely different
 */
function computeSimilarity(a: string, b: string): number {
  const textA = normalizeText(a)
  const textB = normalizeText(b)

  if (textA === textB) return 1.0
  if (textA.length === 0 || textB.length === 0) return 0.0

  // Use a simpler approach for long texts: compare word overlap
  const wordsA = new Set(textA.split(/\s+/).filter(Boolean))
  const wordsB = new Set(textB.split(/\s+/).filter(Boolean))

  if (wordsA.size === 0 || wordsB.size === 0) return 0.0

  // Jaccard similarity
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size

  return intersection / union
}

/**
 * Normalize text for comparison: strip HTML, lowercase, collapse whitespace
 */
function normalizeText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ') // Strip HTML tags
    .replace(/&nbsp;/g, ' ') // Replace HTML entities
    .replace(/&[a-z]+;/gi, ' ') // Other HTML entities
    .replace(/\s+/g, ' ') // Collapse whitespace
    .toLowerCase()
    .trim()
}

/**
 * Categorize the diff between draft and sent message
 */
export function categorizeDiff(
  draftText: string | null | undefined,
  sentText: string
): { category: DraftDiffCategory; similarity: number } {
  // No draft → manual response
  if (!draftText) {
    return { category: 'no_draft', similarity: 0 }
  }

  const similarity = computeSimilarity(draftText, sentText)

  // Thresholds for categorization
  // >= 0.95: unchanged (very minor formatting differences allowed)
  // >= 0.70: minor_edit (small wording changes, typo fixes)
  // < 0.70: major_rewrite (substantial changes = correction signal)
  if (similarity >= 0.95) {
    return { category: 'unchanged', similarity }
  } else if (similarity >= 0.7) {
    return { category: 'minor_edit', similarity }
  } else {
    return { category: 'major_rewrite', similarity }
  }
}

/**
 * RL Signal record stored for feedback loop
 */
export interface RLSignal {
  /** Conversation ID */
  conversationId: string
  /** Message ID of the sent message */
  messageId: string
  /** App identifier */
  appId: string
  /** Action ID of the original draft (if exists) */
  actionId: string | null
  /** Diff category */
  category: DraftDiffCategory
  /** Similarity score (0-1) */
  similarity: number
  /** Original draft text (if exists) */
  draftText: string | null
  /** Sent message text */
  sentText: string
  /** Author who sent the message */
  authorId: string | null
  /** Timestamp when signal was recorded */
  recordedAt: string
  /** Trace ID for correlation */
  traceId?: string
}

export const outboundTrackerWorkflow = inngest.createFunction(
  {
    id: 'support-outbound-tracker',
    name: 'Outbound Message Tracker',
    retries: 2,
  },
  { event: SUPPORT_OUTBOUND_MESSAGE },
  async ({ event, step }) => {
    const {
      conversationId,
      messageId,
      appId,
      author,
      sentAt,
      _links,
      traceId,
      inboxId,
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'outbound tracker workflow started', {
      workflow: 'support-outbound-tracker',
      conversationId,
      messageId,
      appId,
      traceId,
      authorId: author?.id,
    })

    // Step 1: Fetch full message from Front API
    const message = await step.run('fetch-message', async () => {
      const stepStartTime = Date.now()

      const frontToken = process.env.FRONT_API_TOKEN
      if (!frontToken) {
        await log('warn', 'FRONT_API_TOKEN not set, cannot fetch message', {
          workflow: 'support-outbound-tracker',
          step: 'fetch-message',
          conversationId,
        })
        return null
      }

      try {
        const front = createFrontClient({ apiToken: frontToken })
        const msg = await front.messages.get(messageId)

        const durationMs = Date.now() - stepStartTime

        await log('info', 'fetched outbound message', {
          workflow: 'support-outbound-tracker',
          step: 'fetch-message',
          conversationId,
          messageId,
          bodyLength: msg.body?.length ?? 0,
          textLength: msg.text?.length ?? 0,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-outbound-tracker',
          conversationId,
          appId,
          stepName: 'fetch-message',
          durationMs,
          success: true,
          metadata: {
            bodyLength: msg.body?.length ?? 0,
            textLength: msg.text?.length ?? 0,
          },
        })

        return {
          body: msg.body ?? '',
          text: msg.text ?? '',
          subject: msg.subject,
          authorId: msg.author?.id,
          authorEmail: msg.author?.email,
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const durationMs = Date.now() - stepStartTime

        await log('error', 'failed to fetch outbound message', {
          workflow: 'support-outbound-tracker',
          step: 'fetch-message',
          conversationId,
          messageId,
          error: errorMsg,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-outbound-tracker',
          conversationId,
          appId,
          stepName: 'fetch-message',
          durationMs,
          success: false,
          metadata: { error: errorMsg },
        })

        return null
      }
    })

    // If we couldn't fetch the message, log and bail
    if (!message) {
      await log('warn', 'outbound tracker exiting - could not fetch message', {
        workflow: 'support-outbound-tracker',
        conversationId,
        messageId,
      })
      return {
        conversationId,
        messageId,
        status: 'skipped',
        reason: 'fetch_failed',
      }
    }

    // Step 2: Find most recent draft for this conversation
    const draftAction = await step.run('find-draft', async () => {
      const stepStartTime = Date.now()

      try {
        const db = getDb()

        // Find the most recent send-draft action for this conversation
        const actions = await db
          .select()
          .from(ActionsTable)
          .where(eq(ActionsTable.conversation_id, conversationId))
          .orderBy(desc(ActionsTable.created_at))
          .limit(5) // Get a few recent ones to find send-draft type

        // Find the most recent send-draft action
        const draft = actions.find((a) => a.type === 'send-draft')

        const durationMs = Date.now() - stepStartTime

        if (draft) {
          const draftText = (draft.parameters as Record<string, unknown>)
            ?.draft as string | undefined

          await log('info', 'found draft for correlation', {
            workflow: 'support-outbound-tracker',
            step: 'find-draft',
            conversationId,
            actionId: draft.id,
            draftLength: draftText?.length ?? 0,
            createdAt: draft.created_at?.toISOString(),
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'support-outbound-tracker',
            conversationId,
            appId,
            stepName: 'find-draft',
            durationMs,
            success: true,
            metadata: {
              found: true,
              actionId: draft.id,
              draftLength: draftText?.length ?? 0,
            },
          })

          return {
            actionId: draft.id,
            draftText,
            category: draft.category,
            confidence: draft.confidence,
          }
        }

        await log('info', 'no draft found for conversation', {
          workflow: 'support-outbound-tracker',
          step: 'find-draft',
          conversationId,
          actionsChecked: actions.length,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-outbound-tracker',
          conversationId,
          appId,
          stepName: 'find-draft',
          durationMs,
          success: true,
          metadata: { found: false, actionsChecked: actions.length },
        })

        return null
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const durationMs = Date.now() - stepStartTime

        await log('error', 'failed to find draft', {
          workflow: 'support-outbound-tracker',
          step: 'find-draft',
          conversationId,
          error: errorMsg,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-outbound-tracker',
          conversationId,
          appId,
          stepName: 'find-draft',
          durationMs,
          success: false,
          metadata: { error: errorMsg },
        })

        return null
      }
    })

    // Step 3: Compute diff and categorize signal
    const signal = await step.run('compute-diff', async () => {
      const stepStartTime = Date.now()

      // Use plain text version for comparison (cleaner than HTML)
      const sentText = message.text || message.body
      const draftText = draftAction?.draftText

      const { category, similarity } = categorizeDiff(draftText, sentText)

      const rlSignal: RLSignal = {
        conversationId,
        messageId,
        appId,
        actionId: draftAction?.actionId ?? null,
        category,
        similarity,
        draftText: draftText ?? null,
        sentText,
        authorId: message.authorId ?? author?.id ?? null,
        recordedAt: new Date().toISOString(),
        traceId,
      }

      const durationMs = Date.now() - stepStartTime

      await log('info', 'RL signal computed', {
        workflow: 'support-outbound-tracker',
        step: 'compute-diff',
        conversationId,
        messageId,
        category,
        similarity: Math.round(similarity * 100) / 100,
        hasDraft: !!draftText,
        draftLength: draftText?.length ?? 0,
        sentLength: sentText.length,
        durationMs,
      })

      await traceWorkflowStep({
        workflowName: 'support-outbound-tracker',
        conversationId,
        appId,
        stepName: 'compute-diff',
        durationMs,
        success: true,
        metadata: {
          category,
          similarity: Math.round(similarity * 100) / 100,
          hasDraft: !!draftText,
        },
      })

      return rlSignal
    })

    // Step 4: Store signal for RL loop consumption
    // For now, we log it extensively. In the future, this will:
    // - Update trust scores
    // - Feed into memory system
    // - Train improved draft generation
    await step.run('store-signal', async () => {
      const stepStartTime = Date.now()

      // Log the signal for observability (this IS the RL signal storage for now)
      await log('info', 'RL signal stored', {
        workflow: 'support-outbound-tracker',
        step: 'store-signal',
        conversationId,
        messageId,
        appId,
        signal: {
          category: signal.category,
          similarity: signal.similarity,
          actionId: signal.actionId,
          authorId: signal.authorId,
          hasDraft: !!signal.draftText,
          draftPreview: signal.draftText?.slice(0, 100),
          sentPreview: signal.sentText.slice(0, 100),
        },
        // Structured fields for easy querying in Axiom
        rl_category: signal.category,
        rl_similarity: signal.similarity,
        rl_has_draft: !!signal.draftText,
        rl_action_id: signal.actionId,
        traceId,
      })

      const durationMs = Date.now() - stepStartTime

      await traceWorkflowStep({
        workflowName: 'support-outbound-tracker',
        conversationId,
        appId,
        stepName: 'store-signal',
        durationMs,
        success: true,
        metadata: {
          category: signal.category,
          similarity: signal.similarity,
        },
      })

      return { stored: true }
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'outbound tracker workflow completed', {
      workflow: 'support-outbound-tracker',
      conversationId,
      messageId,
      appId,
      traceId,
      category: signal.category,
      similarity: signal.similarity,
      hasDraft: !!signal.draftText,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-outbound-tracker',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        category: signal.category,
        similarity: signal.similarity,
      },
    })

    return {
      conversationId,
      messageId,
      signal: {
        category: signal.category,
        similarity: signal.similarity,
        hasDraft: !!signal.draftText,
        actionId: signal.actionId,
      },
    }
  }
)
