/**
 * Comment Correction Workflow
 *
 * Main orchestrator triggered by SUPPORT_COMMENT_RECEIVED.
 * Parses teammate comments to determine intent and routes to appropriate handler:
 * - approve → trigger send draft via SUPPORT_ACTION_APPROVED
 * - hold → set conversation snooze state
 * - edit → trigger draft regeneration (placeholder)
 * - unknown → log and skip
 */

import { randomUUID } from 'crypto'
import { ActionsTable, getDb } from '@skillrecordings/database'
import {
  type CommentThread,
  createCommentContextService,
} from '../../conversation/comment-context'
import { type HoldInfo, setHold } from '../../conversation/hold-state'
import {
  type HoldParams,
  type IntentResult,
  describeIntent,
  isConfident,
  parseIntent,
} from '../../conversation/intent-parser'
import { initializeAxiom, log } from '../../observability/axiom'
import { inngest } from '../client'
import { SUPPORT_ACTION_APPROVED, SUPPORT_COMMENT_RECEIVED } from '../events'

/**
 * Parse duration string to Date
 * Handles formats like "2h", "1d", "30m"
 */
function parseDurationToDate(duration: string): Date {
  const now = new Date()
  const match = duration.match(/^(\d+)([hmd])$/i)
  if (!match) {
    // Default to 1 hour if parsing fails
    return new Date(now.getTime() + 60 * 60 * 1000)
  }

  const [, numStr, unit] = match
  const num = parseInt(numStr ?? '1', 10)

  switch (unit?.toLowerCase()) {
    case 'h':
      return new Date(now.getTime() + num * 60 * 60 * 1000)
    case 'd':
      return new Date(now.getTime() + num * 24 * 60 * 60 * 1000)
    case 'm':
      return new Date(now.getTime() + num * 60 * 1000)
    default:
      return new Date(now.getTime() + 60 * 60 * 1000)
  }
}

/**
 * Parse "until" string to Date
 * Handles natural language like "tomorrow", "Monday", etc.
 * Falls back to duration parsing if not recognized.
 */
function parseUntilToDate(until: string): Date {
  const now = new Date()
  const lower = until.toLowerCase().trim()

  // Handle common natural language
  if (lower === 'tomorrow') {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0) // 9 AM
    return tomorrow
  }

  // Handle day names
  const days = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]
  const dayIndex = days.indexOf(lower)
  if (dayIndex !== -1) {
    const target = new Date(now)
    const currentDay = target.getDay()
    let daysToAdd = dayIndex - currentDay
    if (daysToAdd <= 0) daysToAdd += 7 // Next week
    target.setDate(target.getDate() + daysToAdd)
    target.setHours(9, 0, 0, 0) // 9 AM
    return target
  }

  // Try parsing as duration
  return parseDurationToDate(until)
}

export const commentCorrectionWorkflow = inngest.createFunction(
  {
    id: 'support-comment-correction',
    name: 'Comment Correction Workflow',
    retries: 2,
  },
  { event: SUPPORT_COMMENT_RECEIVED },
  async ({ event, step }) => {
    const { conversationId, appId, commentId, body, author, traceId } =
      event.data
    const authorEmail = author?.email ?? 'unknown'

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'comment correction workflow started', {
      workflow: 'support-comment-correction',
      conversationId,
      commentId,
      appId,
      authorEmail,
      traceId,
      bodyPreview: body.slice(0, 100),
    })

    // Step 1: Fetch comment context (thread history)
    const thread = await step.run('fetch-context', async () => {
      await log('debug', 'fetching comment context', {
        workflow: 'support-comment-correction',
        step: 'fetch-context',
        conversationId,
      })

      const frontApiToken = process.env.FRONT_API_KEY
      if (!frontApiToken) {
        throw new Error('FRONT_API_KEY environment variable required')
      }

      const contextService = createCommentContextService({
        apiToken: frontApiToken,
      })
      const commentThread =
        await contextService.getCommentThread(conversationId)

      await log('info', 'comment context fetched', {
        workflow: 'support-comment-correction',
        step: 'fetch-context',
        conversationId,
        messageCount: commentThread.messageCount,
        authorCount: commentThread.authors.size,
      })

      // Convert Map to object for serialization
      return {
        messages: commentThread.messages,
        authors: Object.fromEntries(commentThread.authors),
        latestTimestamp: commentThread.latestTimestamp,
        messageCount: commentThread.messageCount,
      }
    })

    // Step 2: Parse intent from comment body
    const intent = await step.run('parse-intent', async () => {
      await log('debug', 'parsing intent', {
        workflow: 'support-comment-correction',
        step: 'parse-intent',
        conversationId,
        body,
      })

      const result = await parseIntent(body)

      await log('info', 'intent parsed', {
        workflow: 'support-comment-correction',
        step: 'parse-intent',
        conversationId,
        intentType: result.type,
        confidence: result.confidence,
        description: describeIntent(result),
      })

      return result
    })

    // Step 3: Route to appropriate handler based on intent
    const result = await step.run('route-intent', async () => {
      await log('debug', 'routing intent', {
        workflow: 'support-comment-correction',
        step: 'route-intent',
        conversationId,
        intentType: intent.type,
        confidence: intent.confidence,
      })

      // Check confidence threshold
      if (!isConfident(intent)) {
        await log('info', 'intent not confident enough, skipping', {
          workflow: 'support-comment-correction',
          step: 'route-intent',
          conversationId,
          intentType: intent.type,
          confidence: intent.confidence,
        })

        return {
          action: 'skipped' as const,
          reason: 'Low confidence intent',
          intentType: intent.type,
          confidence: intent.confidence,
        }
      }

      switch (intent.type) {
        case 'approve': {
          // Create action record and emit approval event
          // Note: The actual draft to send should be looked up from pending actions
          // For now, we create a marker action that execute-approved-action will handle
          const db = getDb()
          const actionId = randomUUID()

          await db.insert(ActionsTable).values({
            id: actionId,
            conversation_id: conversationId,
            app_id: appId,
            type: 'send-draft',
            parameters: {
              approvedViaComment: true,
              commentId,
              authorEmail,
            },
            requires_approval: false,
            created_at: new Date(),
          })

          await log('info', 'approve intent - action created', {
            workflow: 'support-comment-correction',
            step: 'route-intent',
            conversationId,
            actionId,
            action: 'approve',
          })

          return {
            action: 'approve' as const,
            actionId,
            intentType: intent.type,
            confidence: intent.confidence,
          }
        }

        case 'hold': {
          const holdParams = intent.parameters as HoldParams
          let holdUntil: Date

          if (holdParams.duration) {
            holdUntil = parseDurationToDate(holdParams.duration)
          } else if (holdParams.until) {
            holdUntil = parseUntilToDate(holdParams.until)
          } else {
            // Default: 24 hours
            holdUntil = new Date(Date.now() + 24 * 60 * 60 * 1000)
          }

          await setHold(
            conversationId,
            holdUntil,
            `Hold requested via comment by ${authorEmail}`
          )

          await log('info', 'hold intent - snooze set', {
            workflow: 'support-comment-correction',
            step: 'route-intent',
            conversationId,
            action: 'hold',
            holdUntil: holdUntil.toISOString(),
            duration: holdParams.duration,
            until: holdParams.until,
          })

          return {
            action: 'hold' as const,
            holdUntil: holdUntil.toISOString(),
            intentType: intent.type,
            confidence: intent.confidence,
          }
        }

        case 'edit': {
          // TODO: Implement draft regeneration workflow
          // For now, log and mark as placeholder
          await log('info', 'edit intent - placeholder (not implemented)', {
            workflow: 'support-comment-correction',
            step: 'route-intent',
            conversationId,
            action: 'edit',
            parameters: intent.parameters,
          })

          return {
            action: 'edit' as const,
            status: 'not_implemented',
            intentType: intent.type,
            confidence: intent.confidence,
            instruction:
              'instruction' in intent.parameters
                ? intent.parameters.instruction
                : undefined,
          }
        }

        case 'unknown':
        default: {
          await log('info', 'unknown intent - skipping', {
            workflow: 'support-comment-correction',
            step: 'route-intent',
            conversationId,
            action: 'unknown',
            raw: 'raw' in intent.parameters ? intent.parameters.raw : undefined,
          })

          return {
            action: 'skipped' as const,
            reason: 'Unknown intent',
            intentType: intent.type,
            confidence: intent.confidence,
          }
        }
      }
    })

    // Step 4: If approve, emit the action approved event
    if (result.action === 'approve' && 'actionId' in result) {
      await step.sendEvent('emit-action-approved', {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId: result.actionId,
          approvedBy: authorEmail,
          approvedAt: new Date().toISOString(),
          traceId,
        },
      })

      await log('info', 'action approved event emitted', {
        workflow: 'support-comment-correction',
        conversationId,
        actionId: result.actionId,
      })
    }

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'comment correction workflow completed', {
      workflow: 'support-comment-correction',
      conversationId,
      commentId,
      appId,
      traceId,
      result,
      totalDurationMs,
    })

    return {
      conversationId,
      commentId,
      ...result,
      thread: {
        messageCount: thread.messageCount,
        latestTimestamp: thread.latestTimestamp,
      },
    }
  }
)
