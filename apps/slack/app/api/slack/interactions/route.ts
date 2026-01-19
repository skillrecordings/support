import {
  SUPPORT_ACTION_APPROVED,
  SUPPORT_ACTION_REJECTED,
  SUPPORT_APPROVAL_DECIDED,
  inngest,
} from '@skillrecordings/core/inngest'
import { updateApprovalMessage } from '@skillrecordings/core/slack/client'
import { recordOutcome } from '@skillrecordings/core/trust/feedback'
import { ActionsTable, eq, getDb } from '@skillrecordings/database'
import { VotingService } from '@skillrecordings/memory/voting'
import type { SectionBlock } from '@slack/types'
import { verifySlackSignature } from '../../../../lib/verify-signature'

/**
 * Slack Interactions API endpoint
 * Handles interactive components (buttons, select menus, modals, etc.)
 *
 * Specifically handles approve/reject button clicks from HITL approval messages.
 * Emits Inngest events for approval decisions.
 */
export async function POST(request: Request) {
  // 1. Get raw body and headers for signature verification
  const body = await request.text()
  const signature = request.headers.get('x-slack-signature') ?? ''
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? ''

  // 2. Verify Slack signature
  const isValid = verifySlackSignature({ signature, timestamp, body })
  if (!isValid) {
    return new Response('Invalid signature', { status: 401 })
  }

  // 3. Parse URL-encoded payload
  let payload: any
  try {
    const params = new URLSearchParams(body)
    const payloadStr = params.get('payload')
    if (!payloadStr) {
      return new Response('OK', { status: 200 })
    }
    payload = JSON.parse(payloadStr)
  } catch (error) {
    // Return 200 to prevent Slack retries on malformed payloads
    return new Response('OK', { status: 200 })
  }

  // 4. Handle block_actions interactions
  if (payload.type === 'block_actions' && payload.actions?.[0]) {
    const action = payload.actions[0]
    const actionId = action.action_id
    const username = payload.user?.username ?? payload.user?.id ?? 'unknown'

    try {
      const metadata = JSON.parse(action.value)
      const decidedAt = new Date().toISOString()

      if (actionId === 'approve_action') {
        // Emit approval events
        await inngest.send([
          {
            name: SUPPORT_APPROVAL_DECIDED,
            data: {
              actionId: metadata.actionId,
              decision: 'approved',
              decidedBy: username,
              decidedAt,
            },
          },
          {
            name: SUPPORT_ACTION_APPROVED,
            data: {
              actionId: metadata.actionId,
              approvedBy: username,
              approvedAt: decidedAt,
            },
          },
        ])
      } else if (actionId === 'reject_action') {
        // Emit rejection events
        await inngest.send([
          {
            name: SUPPORT_APPROVAL_DECIDED,
            data: {
              actionId: metadata.actionId,
              decision: 'rejected',
              decidedBy: username,
              decidedAt,
            },
          },
          {
            name: SUPPORT_ACTION_REJECTED,
            data: {
              actionId: metadata.actionId,
              rejectedBy: username,
              rejectedAt: decidedAt,
            },
          },
        ])
      } else if (
        actionId.startsWith('rate_good_') ||
        actionId.startsWith('rate_bad_')
      ) {
        // Handle draft rating buttons
        const isGood = actionId.startsWith('rate_good_')
        const { actionId: recordId, appId } = metadata

        // Get the action record to find the category
        const db = getDb()
        const [actionRecord] = await db
          .select()
          .from(ActionsTable)
          .where(eq(ActionsTable.id, recordId))

        const params = actionRecord?.parameters as { category?: string } | null
        const category = params?.category ?? 'unknown'

        // Record the outcome for trust scoring
        await recordOutcome(db, appId, category, isGood)

        // Update the Slack message to show the rating was recorded
        const channel = payload.channel?.id
        const ts = payload.message?.ts
        if (channel && ts) {
          const ratingEmoji = isGood ? '👍' : '👎'
          const blocks: SectionBlock[] = [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Draft Response Created*\n\nApp: *${appId}*\n\n_Rated ${ratingEmoji} by @${username}_`,
              },
            },
          ]
          await updateApprovalMessage(
            channel,
            ts,
            blocks,
            `Draft rated ${ratingEmoji} by ${username}`
          )
        }

        console.log(
          `[slack] Recorded ${isGood ? 'good' : 'bad'} rating for action ${recordId} (${appId}/${category})`
        )
      } else if (actionId === 'memory_store') {
        // Handle memory store action (acknowledge only for now)
        const { actionId: recordId, conversationId, appId } = metadata

        // Update the Slack message to confirm
        const channel = payload.channel?.id
        const ts = payload.message?.ts
        if (channel && ts) {
          const blocks: SectionBlock[] = [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Memory Store Request*\n\nConversation: *${conversationId}*\nApp: *${appId}*\n\n_Acknowledged by @${username}_`,
              },
            },
          ]
          await updateApprovalMessage(
            channel,
            ts,
            blocks,
            `Memory store acknowledged by ${username}`
          )
        }

        console.log(
          `[slack] Memory store acknowledged for conversation ${conversationId} by ${username}`
        )
      } else if (
        actionId === 'memory_upvote' ||
        actionId === 'memory_downvote'
      ) {
        // Handle memory voting
        const voteType = actionId === 'memory_upvote' ? 'upvote' : 'downvote'
        const { memory_id, collection } = metadata

        // Record the vote
        await VotingService.vote(memory_id, collection, voteType)

        // Update the Slack message to show the vote was recorded
        const channel = payload.channel?.id
        const ts = payload.message?.ts
        if (channel && ts) {
          const voteEmoji = voteType === 'upvote' ? '👍' : '👎'
          const blocks: SectionBlock[] = [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Memory Vote*\n\nMemory: \`${memory_id}\`\nCollection: *${collection}*\n\n_Voted ${voteEmoji} by @${username}_`,
              },
            },
          ]
          await updateApprovalMessage(
            channel,
            ts,
            blocks,
            `Memory voted ${voteEmoji} by ${username}`
          )
        }

        console.log(
          `[slack] Recorded ${voteType} for memory ${memory_id} (${collection}) by ${username}`
        )
      }
    } catch (error) {
      // Log but don't fail - unknown actions are ignored
      console.error('Error processing interaction:', error)
    }
  }

  // 5. Return 200 OK (Slack requires quick response)
  return new Response('OK', { status: 200 })
}
