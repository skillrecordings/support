/**
 * Front webhook handler
 *
 * Receives webhook events from Front, verifies HMAC signature,
 * and dispatches to Inngest for async processing.
 *
 * Front webhook docs: https://dev.frontapp.com/docs/webhooks-1
 */

import { type NextRequest, NextResponse } from 'next/server'
import { verifyFrontWebhook } from '@skillrecordings/core/webhooks'
import { inngest, SUPPORT_INBOUND_RECEIVED } from '@skillrecordings/core/inngest'

/**
 * Front webhook event structure
 * See: https://dev.frontapp.com/docs/webhooks-1
 */
interface FrontWebhookEvent {
  type: string
  authorization?: {
    id: string
  }
  payload?: {
    conversation?: {
      id: string
    }
    target?: {
      data?: {
        id: string
        subject?: string
        body?: string
        author?: {
          email?: string
        }
      }
    }
  }
  conversation?: {
    id: string
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text()

  // Get Front app signing key from env
  const secret = process.env.FRONT_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 },
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

  // Log event type and structure for debugging
  console.log('[front-webhook] Event:', {
    type: event.type,
    hasPayload: !!event.payload,
    hasConversation: !!event.payload?.conversation || !!event.conversation,
  })

  // Handle sync event (validation request)
  if (event.type === 'sync') {
    return NextResponse.json({ received: true })
  }

  // Extract conversation ID for regular events
  const conversationId =
    event.payload?.conversation?.id || event.conversation?.id
  if (!conversationId) {
    console.log('[front-webhook] Missing conversation ID, payload:', JSON.stringify(event).slice(0, 500))
    return NextResponse.json(
      { error: 'Missing conversation ID' },
      { status: 400 },
    )
  }

  // For inbound message events, dispatch to Inngest
  if (event.type === 'inbound_received') {
    const messageData = event.payload?.target?.data
    if (!messageData) {
      console.log('[front-webhook] Missing message data, payload:', JSON.stringify(event.payload).slice(0, 500))
      return NextResponse.json(
        { error: 'Missing message data in inbound event' },
        { status: 400 },
      )
    }

    // Extract required fields for support/inbound.received event
    const senderEmail = messageData.author?.email
    if (!senderEmail) {
      console.log('[front-webhook] Missing sender email, messageData:', JSON.stringify(messageData).slice(0, 500))
      return NextResponse.json(
        { error: 'Missing sender email' },
        { status: 400 },
      )
    }

    // appId will be determined by Front conversation tag/inbox routing
    // For now, default to 'unknown' - this will be enhanced in Phase 2
    const appId = 'unknown'

    await inngest.send({
      name: SUPPORT_INBOUND_RECEIVED,
      data: {
        conversationId,
        appId,
        senderEmail,
        messageId: messageData.id,
        subject: messageData.subject,
        body: messageData.body || '',
      },
    })
  }

  // For other event types, just acknowledge (we may add handlers later)
  return NextResponse.json({ received: true })
}
