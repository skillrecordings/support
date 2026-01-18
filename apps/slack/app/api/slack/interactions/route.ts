import { verifySlackSignature } from '../../../../lib/verify-signature'
import {
  inngest,
  SUPPORT_APPROVAL_DECIDED,
  SUPPORT_ACTION_APPROVED,
  SUPPORT_ACTION_REJECTED,
} from '@skillrecordings/core/inngest'

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
      }
    } catch (error) {
      // Log but don't fail - unknown actions are ignored
      console.error('Error processing interaction:', error)
    }
  }

  // 5. Return 200 OK (Slack requires quick response)
  return new Response('OK', { status: 200 })
}
