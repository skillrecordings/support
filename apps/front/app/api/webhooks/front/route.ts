/**
 * Front webhook handler
 *
 * Receives webhook events from Front, verifies HMAC signature,
 * and dispatches to Inngest for async processing.
 *
 * Front webhook docs: https://dev.frontapp.com/docs/webhooks-1
 */

import { randomUUID } from 'crypto'
import {
  SUPPORT_COMMENT_RECEIVED,
  SUPPORT_CONVERSATION_SNOOZED,
  SUPPORT_INBOUND_RECEIVED,
  SUPPORT_OUTBOUND_MESSAGE,
  SUPPORT_SNOOZE_EXPIRED,
  inngest,
} from '@skillrecordings/core/inngest'
import { getAppByInboxId } from '@skillrecordings/core/services/app-registry'
import { recordWebhookPayloadSnapshot } from '@skillrecordings/core/services/webhook-payloads'
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
    /** Target preview (message for inbound/outbound, comment for comment events) */
    target?: {
      _meta?: {
        type: string // "message" for inbound, "comment" for comments
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
          id?: string
          email?: string
          first_name?: string
          last_name?: string
        }
        /** Unix timestamp for comment posted_at */
        posted_at?: number
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
  const startTime = Date.now()
  const payload = await request.text()

  console.log('[front-webhook] ========== WEBHOOK RECEIVED ==========')
  console.log('[front-webhook] Timestamp:', new Date().toISOString())
  console.log('[front-webhook] Payload length:', payload.length)

  // Get Front app signing key from env
  const secret = process.env.FRONT_WEBHOOK_SECRET
  if (!secret) {
    console.error('[front-webhook] FATAL: FRONT_WEBHOOK_SECRET not configured')
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
  console.log('[front-webhook] Headers:', JSON.stringify(headers, null, 2))

  // Verify HMAC signature (Front uses timestamp:body format, base64)
  const result = verifyFrontWebhook(payload, headers, { secret })
  console.log(
    '[front-webhook] Signature verification:',
    result.valid ? 'VALID' : 'INVALID'
  )

  if (!result.valid) {
    console.error(
      '[front-webhook] Signature verification failed:',
      result.error
    )
    return NextResponse.json({ error: result.error }, { status: 401 })
  }

  // Handle challenge during webhook setup
  // Front sends x-front-challenge header and expects it echoed back
  if (result.challenge) {
    console.log('[front-webhook] Challenge received, echoing back')
    return NextResponse.json({ challenge: result.challenge })
  }

  // Parse event payload
  let event: FrontWebhookEvent
  try {
    event = JSON.parse(payload)
  } catch {
    console.error('[front-webhook] Failed to parse JSON payload')
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // Log FULL event for debugging
  console.log(
    '[front-webhook] FULL EVENT PAYLOAD:',
    JSON.stringify(event, null, 2)
  )

  // Handle sync event (validation request)
  if (event.type === 'sync') {
    return NextResponse.json({ received: true })
  }

  // Extract conversation ID
  const conversationId = event.payload?.conversation?.id

  const previewSubject =
    event.payload?.conversation?.subject ?? event.payload?.target?.data?.subject
  const previewBody = event.payload?.target?.data?.body
  const previewSenderEmail = event.payload?.target?.data?.author?.email
  const previewMessageId = event.payload?.target?.data?.id

  await recordWebhookPayloadSnapshot({
    source: 'webhook_preview',
    eventType: event.type,
    conversationId,
    messageId: previewMessageId,
    subject: previewSubject ?? null,
    body: previewBody ?? null,
    senderEmail: previewSenderEmail ?? null,
    payload: event as unknown as Record<string, unknown>,
    payloadRaw: payload,
  })

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

    // source.data is an ARRAY of inboxes - find one that matches a registered app
    const sourceData = event.payload?.source?.data
    const inboxes = Array.isArray(sourceData) ? sourceData : []

    console.log('[front-webhook] Extracted:', {
      subject,
      inboxCount: inboxes.length,
      inboxIds: inboxes.map((i: { id?: string }) => i?.id).filter(Boolean),
    })

    // Find the first inbox that matches a registered app
    let appSlug = 'unknown'
    let inboxId: string | undefined
    for (const inbox of inboxes) {
      if (inbox?.id) {
        const app = await getAppByInboxId(inbox.id)
        if (app) {
          appSlug = app.slug
          inboxId = inbox.id
          console.log(
            `[front-webhook] Matched inbox ${inbox.id} to app ${app.slug}`
          )
          break
        }
      }
    }

    // Bail if no registered app found - don't waste resources on unknown inboxes
    if (!inboxId || appSlug === 'unknown') {
      console.warn(
        `[front-webhook] No registered app for inboxes: ${inboxes.map((i: { id?: string }) => i?.id).join(', ')}`
      )
      return NextResponse.json({ received: true })
    }

    // Generate unique traceId for end-to-end pipeline correlation
    const traceId = randomUUID()

    const inngestPayload = {
      conversationId,
      messageId,
      // Preview may not have these - workflow fetches full data
      subject: subject || '',
      // Body and senderEmail are fetched by classify workflow via front.getMessage()
      // Webhook sends preview only - full data fetched in first workflow step
      body: '', // Populated by classify workflow from message.text
      senderEmail: '', // Populated by classify workflow from message.recipients[role=from]
      appId: appSlug,
      inboxId,
      // Include links for API fetching
      _links: {
        conversation: event.payload?.conversation?._links?.self,
        message: event.payload?.target?.data?._links?.self,
      },
      // Correlation ID for full pipeline tracing
      traceId,
    }

    console.log(
      '[front-webhook] Sending to Inngest:',
      JSON.stringify(inngestPayload, null, 2)
    )

    await inngest.send({
      name: SUPPORT_INBOUND_RECEIVED,
      data: inngestPayload,
    })

    const elapsed = Date.now() - startTime
    console.log(
      `[front-webhook] ========== DISPATCHED TO INNGEST (${elapsed}ms) ==========`
    )
  }

  // Handle comment events (internal notes/comments on conversations)
  if (event.type === 'new_comment_added') {
    const commentId = event.payload?.target?.data?.id
    if (!commentId) {
      console.log('[front-webhook] Missing comment ID in comment event')
      return NextResponse.json({ received: true }) // Ack anyway, don't fail
    }

    // Extract comment data from the payload
    const commentBody = event.payload?.target?.data?.body || ''
    const author = event.payload?.target?.data?.author
    const postedAt = event.payload?.target?.data?.posted_at

    // source.data can be an ARRAY of inboxes - find one that matches a registered app
    const sourceData = event.payload?.source?.data
    const inboxes = Array.isArray(sourceData) ? sourceData : []

    console.log('[front-webhook] Comment event extracted:', {
      commentId,
      hasBody: !!commentBody,
      authorId: author?.id,
      authorEmail: author?.email,
      inboxCount: inboxes.length,
      inboxIds: inboxes.map((i: { id?: string }) => i?.id).filter(Boolean),
    })

    // Find the first inbox that matches a registered app
    let appSlug = 'unknown'
    let inboxId: string | undefined
    for (const inbox of inboxes) {
      if (inbox?.id) {
        const app = await getAppByInboxId(inbox.id)
        if (app) {
          appSlug = app.slug
          inboxId = inbox.id
          console.log(
            `[front-webhook] Matched inbox ${inbox.id} to app ${app.slug}`
          )
          break
        }
      }
    }

    // Bail if no registered app found - don't waste resources on unknown inboxes
    if (!inboxId || appSlug === 'unknown') {
      console.warn(
        `[front-webhook] No registered app for comment inboxes: ${inboxes.map((i: { id?: string }) => i?.id).join(', ')}`
      )
      return NextResponse.json({ received: true })
    }

    // Generate unique traceId for end-to-end pipeline correlation
    const traceId = randomUUID()

    // Build author name from first + last name if available
    const authorName =
      [author?.first_name, author?.last_name].filter(Boolean).join(' ') ||
      undefined

    const inngestPayload = {
      conversationId,
      commentId,
      body: commentBody,
      author: {
        id: author?.id || 'unknown',
        email: author?.email,
        name: authorName,
      },
      appId: appSlug,
      inboxId,
      _links: {
        conversation: event.payload?.conversation?._links?.self,
        comment: event.payload?.target?.data?._links?.self,
      },
      traceId,
      postedAt,
    }

    console.log(
      '[front-webhook] Sending comment to Inngest:',
      JSON.stringify(inngestPayload, null, 2)
    )

    await inngest.send({
      name: SUPPORT_COMMENT_RECEIVED,
      data: inngestPayload,
    })

    const elapsed = Date.now() - startTime
    console.log(
      `[front-webhook] ========== COMMENT DISPATCHED TO INNGEST (${elapsed}ms) ==========`
    )
  }

  // Handle conversation_snoozed events (conversation put on hold by human)
  if (event.type === 'conversation_snoozed') {
    // source.data can be an ARRAY of inboxes - find one that matches a registered app
    const sourceData = event.payload?.source?.data
    const inboxes = Array.isArray(sourceData) ? sourceData : []

    console.log('[front-webhook] Snooze event extracted:', {
      conversationId,
      inboxCount: inboxes.length,
      inboxIds: inboxes.map((i: { id?: string }) => i?.id).filter(Boolean),
    })

    // Find the first inbox that matches a registered app
    let appSlug = 'unknown'
    let inboxId: string | undefined
    for (const inbox of inboxes) {
      if (inbox?.id) {
        const app = await getAppByInboxId(inbox.id)
        if (app) {
          appSlug = app.slug
          inboxId = inbox.id
          console.log(
            `[front-webhook] Matched inbox ${inbox.id} to app ${app.slug}`
          )
          break
        }
      }
    }

    // Bail if no registered app found - don't waste resources on unknown inboxes
    if (!inboxId || appSlug === 'unknown') {
      console.warn(
        `[front-webhook] No registered app for snooze inboxes: ${inboxes.map((i: { id?: string }) => i?.id).join(', ')}`
      )
      return NextResponse.json({ received: true })
    }

    // Generate unique traceId for end-to-end pipeline correlation
    const traceId = randomUUID()

    const inngestPayload = {
      conversationId,
      appId: appSlug,
      inboxId,
      snoozedAt: event.payload?.emitted_at ?? Math.floor(Date.now() / 1000),
      // Front may include snooze_until in the payload for scheduled snoozes
      snoozedUntil: (event.payload as { snooze_until?: number })?.snooze_until,
      traceId,
    }

    console.log(
      '[front-webhook] Sending snooze event to Inngest:',
      JSON.stringify(inngestPayload, null, 2)
    )

    await inngest.send({
      name: SUPPORT_CONVERSATION_SNOOZED,
      data: inngestPayload,
    })

    const elapsed = Date.now() - startTime
    console.log(
      `[front-webhook] ========== SNOOZE DISPATCHED TO INNGEST (${elapsed}ms) ==========`
    )
  }

  // Handle snooze_expired events (snooze period ended, needs attention)
  if (event.type === 'conversation_snooze_expired') {
    // source.data can be an ARRAY of inboxes - find one that matches a registered app
    const sourceData = event.payload?.source?.data
    const inboxes = Array.isArray(sourceData) ? sourceData : []

    console.log('[front-webhook] Snooze expired event extracted:', {
      conversationId,
      inboxCount: inboxes.length,
      inboxIds: inboxes.map((i: { id?: string }) => i?.id).filter(Boolean),
    })

    // Find the first inbox that matches a registered app
    let appSlug = 'unknown'
    let inboxId: string | undefined
    for (const inbox of inboxes) {
      if (inbox?.id) {
        const app = await getAppByInboxId(inbox.id)
        if (app) {
          appSlug = app.slug
          inboxId = inbox.id
          console.log(
            `[front-webhook] Matched inbox ${inbox.id} to app ${app.slug}`
          )
          break
        }
      }
    }

    // Bail if no registered app found - don't waste resources on unknown inboxes
    if (!inboxId || appSlug === 'unknown') {
      console.warn(
        `[front-webhook] No registered app for snooze expired inboxes: ${inboxes.map((i: { id?: string }) => i?.id).join(', ')}`
      )
      return NextResponse.json({ received: true })
    }

    // Generate unique traceId for end-to-end pipeline correlation
    const traceId = randomUUID()

    const inngestPayload = {
      conversationId,
      appId: appSlug,
      inboxId,
      expiredAt: event.payload?.emitted_at ?? Math.floor(Date.now() / 1000),
      traceId,
    }

    console.log(
      '[front-webhook] Sending snooze expired event to Inngest:',
      JSON.stringify(inngestPayload, null, 2)
    )

    await inngest.send({
      name: SUPPORT_SNOOZE_EXPIRED,
      data: inngestPayload,
    })

    const elapsed = Date.now() - startTime
    console.log(
      `[front-webhook] ========== SNOOZE EXPIRED DISPATCHED TO INNGEST (${elapsed}ms) ==========`
    )
  }

  // Handle outbound message events (message sent from Front)
  // This is THE core signal for the RL loop - comparing draft vs sent
  if (event.type === 'outbound' || event.type === 'outbound_sent') {
    const messageId = event.payload?.target?.data?.id
    if (!messageId) {
      console.log('[front-webhook] Missing message ID in outbound event')
      return NextResponse.json({ received: true }) // Ack anyway, don't fail
    }

    // Extract author info from the payload (teammate who sent)
    const author = event.payload?.target?.data?.author

    // source.data can be an ARRAY of inboxes - find one that matches a registered app
    const sourceData = event.payload?.source?.data
    const inboxes = Array.isArray(sourceData) ? sourceData : []

    console.log('[front-webhook] Outbound event extracted:', {
      conversationId,
      messageId,
      authorId: author?.id,
      authorEmail: author?.email,
      inboxCount: inboxes.length,
      inboxIds: inboxes.map((i: { id?: string }) => i?.id).filter(Boolean),
    })

    // Find the first inbox that matches a registered app
    let appSlug = 'unknown'
    let inboxId: string | undefined
    for (const inbox of inboxes) {
      if (inbox?.id) {
        const app = await getAppByInboxId(inbox.id)
        if (app) {
          appSlug = app.slug
          inboxId = inbox.id
          console.log(
            `[front-webhook] Matched inbox ${inbox.id} to app ${app.slug}`
          )
          break
        }
      }
    }

    // Bail if no registered app found - don't waste resources on unknown inboxes
    if (!inboxId || appSlug === 'unknown') {
      console.warn(
        `[front-webhook] No registered app for outbound inboxes: ${inboxes.map((i: { id?: string }) => i?.id).join(', ')}`
      )
      return NextResponse.json({ received: true })
    }

    // Generate unique traceId for end-to-end pipeline correlation
    const traceId = randomUUID()

    // Build author name from first + last name if available
    const authorName =
      [author?.first_name, author?.last_name].filter(Boolean).join(' ') ||
      undefined

    const inngestPayload = {
      conversationId,
      messageId,
      appId: appSlug,
      inboxId,
      author: author
        ? {
            id: author.id || 'unknown',
            email: author.email,
            name: authorName,
          }
        : undefined,
      // Body will be fetched via Front API in the workflow (webhook sends preview only)
      body: '',
      subject: event.payload?.conversation?.subject,
      sentAt: event.payload?.emitted_at ?? Math.floor(Date.now() / 1000),
      _links: {
        conversation: event.payload?.conversation?._links?.self,
        message: event.payload?.target?.data?._links?.self,
      },
      traceId,
    }

    console.log(
      '[front-webhook] Sending outbound message to Inngest:',
      JSON.stringify(inngestPayload, null, 2)
    )

    await inngest.send({
      name: SUPPORT_OUTBOUND_MESSAGE,
      data: inngestPayload,
    })

    const elapsed = Date.now() - startTime
    console.log(
      `[front-webhook] ========== OUTBOUND DISPATCHED TO INNGEST (${elapsed}ms) ==========`
    )
  }

  // Acknowledge all events
  const elapsed = Date.now() - startTime
  console.log(
    `[front-webhook] ========== WEBHOOK COMPLETE (${elapsed}ms) ==========`
  )
  return NextResponse.json({ received: true })
}
