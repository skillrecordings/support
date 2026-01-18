/**
 * Front webhook handler
 *
 * Receives webhook events from Front, verifies HMAC signature,
 * and dispatches to Inngest for async processing.
 *
 * Front webhook docs: https://dev.frontapp.com/docs/webhooks-1
 */

import { type NextRequest, NextResponse } from 'next/server'
import { verifyFrontWebhook, computeFrontSignature } from '@skillrecordings/core/webhooks'
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
    console.error('[front-webhook] FRONT_WEBHOOK_SECRET not configured')
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 },
    )
  }

  // Debug: log secret prefix and length to verify env var
  console.log('[front-webhook] Secret check:', {
    prefix: secret.slice(0, 8),
    length: secret.length,
    expectedPrefix: '3d63bcc2',
    expectedLength: 32,
  })

  // Build headers object for verification
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  console.log('[front-webhook] Headers:', {
    signature: headers['x-front-signature']?.slice(0, 20) + '...',
    timestamp: headers['x-front-request-timestamp'],
    challenge: headers['x-front-challenge'] ? 'present' : 'absent',
  })
  console.log('[front-webhook] Payload preview:', payload.slice(0, 200))

  // Debug: compute and compare signatures
  const timestamp = headers['x-front-request-timestamp']
  if (timestamp) {
    const computed = computeFrontSignature(timestamp, payload, secret)
    const received = headers['x-front-signature']
    console.log('[front-webhook] Signature comparison:', {
      computed: computed.slice(0, 20) + '...',
      received: received?.slice(0, 20) + '...',
      match: computed === received,
    })
  }

  // Verify HMAC signature (Front uses timestamp:body format, base64)
  const result = verifyFrontWebhook(payload, headers, { secret })

  if (!result.valid) {
    console.error('[front-webhook] Verification failed:', result.error)
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

  // Handle sync event (validation request)
  if (event.type === 'sync') {
    return NextResponse.json({ received: true })
  }

  // Extract conversation ID for regular events
  const conversationId =
    event.payload?.conversation?.id || event.conversation?.id
  if (!conversationId) {
    return NextResponse.json(
      { error: 'Missing conversation ID' },
      { status: 400 },
    )
  }

  // For inbound message events, dispatch to Inngest
  if (event.type === 'inbound_received') {
    const messageData = event.payload?.target?.data
    if (!messageData) {
      return NextResponse.json(
        { error: 'Missing message data in inbound event' },
        { status: 400 },
      )
    }

    // Extract required fields for support/inbound.received event
    const senderEmail = messageData.author?.email
    if (!senderEmail) {
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
