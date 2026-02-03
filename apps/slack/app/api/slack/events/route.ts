import { NextRequest, NextResponse } from 'next/server'
import {
  addReaction,
  clearAssistantStatus,
  removeReaction,
  setAssistantStatus,
} from '../../../../../../packages/slack/src/feedback/status'
import { handleAppMention } from '../../../../../../packages/slack/src/handlers/mention'
import { handleThreadReply } from '../../../../../../packages/slack/src/handlers/thread-reply'

/**
 * Slack Events API endpoint
 * Handles URL verification challenge and event callbacks
 *
 * Subscribed events:
 * - app_mention: @mentions of the bot
 * - message.channels: Messages in public channels
 * - message.groups: Messages in private channels
 * - message.im: Direct messages
 */
// Simple in-memory deduplication (events processed in last 60s)
const processedEvents = new Map<string, number>()
const DEDUP_TTL_MS = 60_000

function isDuplicate(eventId: string): boolean {
  const now = Date.now()
  // Clean old entries
  for (const [id, ts] of processedEvents) {
    if (now - ts > DEDUP_TTL_MS) processedEvents.delete(id)
  }
  if (processedEvents.has(eventId)) return true
  processedEvents.set(eventId, now)
  return false
}

export async function POST(request: NextRequest) {
  try {
    // Slack retries if we don't respond in 3s - acknowledge retries immediately
    const retryNum = request.headers.get('X-Slack-Retry-Num')
    if (retryNum) {
      console.log(`Slack retry #${retryNum} - acknowledging immediately`)
      return NextResponse.json({ ok: true })
    }

    const body = await request.json()

    // Handle Slack URL verification challenge
    if (body.type === 'url_verification') {
      return NextResponse.json({ challenge: body.challenge })
    }

    // Handle event callbacks
    if (body.type === 'event_callback') {
      const event = body.event

      // Deduplicate by event_id
      if (body.event_id && isDuplicate(body.event_id)) {
        console.log(`Duplicate event ${body.event_id} - skipping`)
        return NextResponse.json({ ok: true })
      }

      // Skip bot messages to prevent loops
      if (event?.bot_id || event?.subtype === 'bot_message') {
        return NextResponse.json({ ok: true })
      }

      const channel = event?.channel
      const messageTs = event?.ts
      const threadTs = event?.thread_ts ?? event?.ts

      if (event?.type === 'app_mention') {
        // Show thinking feedback
        await Promise.all([
          addReaction(channel, messageTs, 'eyes'),
          setAssistantStatus(channel, threadTs, 'is thinking...', [
            'is thinking...',
          ]),
        ])

        try {
          // Handle @mentions
          await handleAppMention({
            event_id: body.event_id,
            event: event,
          })
        } catch (handlerError) {
          // Post error message to thread
          console.error('App mention handler error:', handlerError)
          const { getSlackClient } = await import(
            '../../../../../../packages/core/src/slack/client'
          )
          const slackClient = getSlackClient()
          await slackClient.chat.postMessage({
            channel,
            text: `⚠️ Something went wrong: ${handlerError instanceof Error ? handlerError.message : 'Unknown error'}`,
            thread_ts: threadTs,
          })
        } finally {
          // Clear feedback
          await Promise.all([
            removeReaction(channel, messageTs, 'eyes'),
            clearAssistantStatus(channel, threadTs),
          ])
        }
      } else if (event?.type === 'message' && event?.thread_ts) {
        // Handle thread replies (messages with thread_ts that aren't the parent)
        if (event.thread_ts !== event.ts) {
          // Show thinking feedback
          await addReaction(channel, messageTs, 'eyes')

          try {
            const result = await handleThreadReply({
              event_id: body.event_id,
              event: event,
            })
            if (!result.handled) {
              console.log('Thread reply not handled:', result.reason)
            }
          } finally {
            // Clear feedback
            await removeReaction(channel, messageTs, 'eyes')
          }
        }
      } else if (event?.type === 'message') {
        // Log other message events for debugging
        console.log('Message event received (not a thread reply):', {
          channel: event.channel,
          user: event.user,
          hasThreadTs: !!event.thread_ts,
        })
      }

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error handling Slack event:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Force deploy Tue Feb  3 11:36:24 PST 2026

// Progressive status Tue Feb  3 11:56:16 PST 2026

// Error msg fix Tue Feb  3 12:11:23 PST 2026
