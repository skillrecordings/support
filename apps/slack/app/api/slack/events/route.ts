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
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Handle Slack URL verification challenge
    if (body.type === 'url_verification') {
      return NextResponse.json({ challenge: body.challenge })
    }

    // Handle event callbacks
    if (body.type === 'event_callback') {
      const event = body.event

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
