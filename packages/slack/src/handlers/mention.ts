import { randomUUID } from 'node:crypto'
import { initializeAxiom, log } from '../../../core/src/observability/axiom'
import { getSlackClient } from '../../../core/src/slack/client'
import { routeIntent } from '../intents/router'
import type { ParsedIntent } from '../intents/types'

export interface AppMentionEvent {
  type: 'app_mention'
  user: string
  channel: string
  text: string
  ts: string
  thread_ts?: string
}

export interface AppMentionPayload {
  event: AppMentionEvent
  event_id?: string
}

function stripLeadingMention(text: string): string {
  return text.replace(/^<@[^>]+>\s*/, '').trim()
}

export async function handleAppMention(payload: AppMentionPayload): Promise<{
  intent: ParsedIntent
  responseText: string
  threadTs: string
  channel: string
}> {
  initializeAxiom()

  const rawText = stripLeadingMention(payload.event.text)
  const { intent, response } = routeIntent(rawText)
  const threadTs = payload.event.thread_ts ?? payload.event.ts

  const slackClient = getSlackClient()
  await slackClient.chat.postMessage({
    channel: payload.event.channel,
    text: response,
    thread_ts: threadTs,
  })

  await log('info', 'slack.intent_detected', {
    traceId: payload.event_id ?? randomUUID(),
    slackThreadTs: threadTs,
    userId: payload.event.user,
    rawText: intent.rawText,
    detectedIntent: intent.category,
    confidence: intent.confidence,
  })

  return {
    intent,
    responseText: response,
    threadTs,
    channel: payload.event.channel,
  }
}
