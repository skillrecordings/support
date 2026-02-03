import { NextRequest, NextResponse } from 'next/server'
import { handleAppMention } from '../../../../../../packages/slack/src/handlers/mention'

/**
 * Slack Events API endpoint
 * Handles URL verification challenge and event callbacks
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
      if (body.event?.type === 'app_mention') {
        await handleAppMention({
          event_id: body.event_id,
          event: body.event,
        })
      } else {
        console.log('Event received:', body.event)
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
