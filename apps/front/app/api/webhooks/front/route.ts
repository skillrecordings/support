/**
 * Front webhook handler
 *
 * Receives webhook events from Front, verifies HMAC signature,
 * and dispatches to Inngest for async processing.
 *
 * Front webhook docs: https://dev.frontapp.com/docs/webhooks-1
 */

import {
  SUPPORT_INBOUND_RECEIVED,
  inngest,
} from '@skillrecordings/core/inngest'
import { getAppByInboxId } from '@skillrecordings/core/services/app-registry'
import { verifyFrontWebhook } from '@skillrecordings/core/webhooks'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Front webhook event structure (application webhooks)
 *
 * Application webhooks wrap the event in a payload envelope:
 * - type: Event type (inbound_received, outbound_sent, etc.)
 * - authorization: Company info
 * - payload: The actual event object (PREVIEW only - IDs and links, not full data)
 *
 * Event types from webhook config:
 * - inbound_received: Incoming message
 * - outbound_sent: Outbound message
 * - conversation_archived, conversation_reopened, etc.
 *
 * IMPORTANT: Webhooks send PREVIEWS, not full data.
 * Must fetch full message/conversation data via Front API.
 *
 * See: https://dev.frontapp.com/docs/application-webhooks
 * See: https://dev.frontapp.com/docs/events
 */
interface FrontWebhookEvent {
  /** Event type: inbound_received, outbound_sent, sync, etc. */
  type: string
  /** Company/workspace authorization */
  authorization?: {
    id: string
  }
  /** The event payload (preview - contains IDs and _links, not full data) */
  payload?: {
    /** Event ID */
    id?: string
    /** Event type from the Events API (inbound, outbound, assign, etc.) */
    type?: string
    /** Timestamp when event was emitted */
    emitted_at?: number
    /** Conversation preview */
    conversation?: {
      id: string
      subject?: string
      _links?: {
        self?: string
        related?: {
          messages?: string
        }
      }
    }
    /** Target preview (message for inbound/outbound events) */
    target?: {
      _meta?: {
        type: string // "message" for inbound
      }
      data?: {
        id: string
        _links?: {
          self?: string
        }
        // These may not be present in preview
        subject?: string
        body?: string
        author?: {
          email?: string
        }
      }
    }
    /** Source preview */
    source?: {
      _meta?: {
        type: string // "inboxes" for inbound
      }
      data?: {
        id: string
      }
    }
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text()

  // Get Front app signing key from env
  const secret = process.env.FRONT_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    )
  }

  // Build headers object for verification
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  // Verify HMAC signature (Front uses timestamp:body format, base64)
  const result = verifyFrontWebhook(payload, headers, { secret })

  if (!result.valid) {
    return NextResponse.json({ error: result.error }, { status: 401 })
  }

  // Handle challenge during webhook setup
  // Front sends x-front-challenge header and expects it echoed back
  if (result.challenge) {
    return NextResponse.json({ challenge: result.challenge })
  }

  // Parse event payload
  let event: FrontWebhookEvent
  try {
    event = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // Log event for debugging - include full source/target structure to understand shape
  console.log('[front-webhook] Event received:', {
    type: event.type,
    payloadType: event.payload?.type,
    conversationId: event.payload?.conversation?.id,
    // Log full source to see actual structure
    source: JSON.stringify(event.payload?.source),
    // Log full target to see actual structure
    target: JSON.stringify(event.payload?.target),
  })

  // Handle sync event (validation request)
  if (event.type === 'sync') {
    return NextResponse.json({ received: true })
  }

  // Extract conversation ID
  const conversationId = event.payload?.conversation?.id
  if (!conversationId) {
    console.log(
      '[front-webhook] No conversation ID in payload:',
      JSON.stringify(event).slice(0, 1000)
    )
    // Some events may not have a conversation - acknowledge anyway
    return NextResponse.json({ received: true })
  }

  // For inbound message events, dispatch to Inngest
  // Webhook sends PREVIEW only - Inngest workflow will fetch full data via Front API
  if (event.type === 'inbound_received') {
    const messageId = event.payload?.target?.data?.id
    if (!messageId) {
      console.log('[front-webhook] Missing message ID in inbound event')
      return NextResponse.json({ received: true }) // Ack anyway, don't fail
    }

    // Extract what we can from the preview
    // Full data (body, author email) must be fetched via Front API in the workflow
    const subject = event.payload?.conversation?.subject
    const inboxId = event.payload?.source?.data?.id

    // Map inbox ID to app slug via database lookup
    let appSlug = 'unknown'
    if (inboxId) {
      const app = await getAppByInboxId(inboxId)
      if (app) {
        appSlug = app.slug
      } else {
        console.warn(`[front-webhook] No app found for inbox ID: ${inboxId}`)
      }
    }

    await inngest.send({
      name: SUPPORT_INBOUND_RECEIVED,
      data: {
        conversationId,
        messageId,
        // Preview may not have these - workflow fetches full data
        subject: subject || '',
        body: '', // Must fetch via Front API
        senderEmail: '', // Must fetch via Front API
        appId: appSlug,
        // Include inbox ID for draft creation (required by Front API)
        inboxId: inboxId || '',
        // Include links for API fetching
        _links: {
          conversation: event.payload?.conversation?._links?.self,
          message: event.payload?.target?.data?._links?.self,
        },
      },
    })

    console.log('[front-webhook] Dispatched to Inngest:', {
      conversationId,
      messageId,
    })
  }

  // Acknowledge all events
  return NextResponse.json({ received: true })
}
