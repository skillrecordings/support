import { randomUUID } from 'node:crypto'
import { initializeAxiom, log } from '../../../core/src/observability/axiom'
import { getSlackClient } from '../../../core/src/slack/client'
import {
  type DraftRefinementDeps,
  type DraftStore,
  type RefinementIntent,
  applyRefinement,
  formatRevisionMessage,
  getDraftStore,
  markDraftStatus,
  parseRefinementIntent,
} from '../intents/draft'

export interface ThreadReplyEvent {
  type: 'message'
  user: string
  channel: string
  text: string
  ts: string
  thread_ts?: string
}

export interface ThreadReplyPayload {
  event: ThreadReplyEvent
  event_id?: string
}

export interface ThreadReplyDeps extends DraftRefinementDeps {
  slackClient?: ReturnType<typeof getSlackClient>
  draftStore?: DraftStore
}

export interface ThreadReplyResult {
  handled: boolean
  reason?: string
  responseText?: string
  threadTs?: string
  intent?: RefinementIntent
}

export async function handleThreadReply(
  payload: ThreadReplyPayload,
  deps?: ThreadReplyDeps
): Promise<ThreadReplyResult> {
  const event = payload.event
  if (event.type !== 'message') {
    return { handled: false, reason: 'unsupported_event' }
  }

  const threadTs = event.thread_ts
  if (!threadTs || threadTs === event.ts) {
    return { handled: false, reason: 'not_thread_reply' }
  }

  const intent = parseRefinementIntent(event.text)
  if (!intent) {
    return { handled: false, reason: 'no_intent' }
  }

  const store = getDraftStore(deps)
  const state = store.get(threadTs)
  if (!state) {
    return { handled: false, reason: 'missing_draft', intent }
  }

  const slackClient = deps?.slackClient ?? getSlackClient()
  const logger = deps?.logger ?? log
  const initialize = deps?.initializeAxiom ?? initializeAxiom
  const traceId = payload.event_id ?? randomUUID()

  if (intent.type === 'approve') {
    const updated = markDraftStatus(state, 'approved', deps)
    store.set(threadTs, updated)
    const responseText =
      'Approved — I will send this once it clears the approval flow.'

    await slackClient.chat.postMessage({
      channel: event.channel,
      text: responseText,
      thread_ts: threadTs,
    })

    initialize()
    await logger('info', 'slack.draft_approved', {
      traceId,
      threadTs,
      userId: event.user,
      channel: event.channel,
      version: updated.versions[updated.versions.length - 1]?.id,
      learningCaptureReady: true,
    })

    return { handled: true, responseText, threadTs, intent }
  }

  if (intent.type === 'reject') {
    const updated = markDraftStatus(state, 'rejected', deps)
    store.set(threadTs, updated)
    const responseText = intent.reason
      ? `Understood — I won't send this. Reason noted: ${intent.reason}`
      : "Understood — I won't send this."

    await slackClient.chat.postMessage({
      channel: event.channel,
      text: responseText,
      thread_ts: threadTs,
    })

    initialize()
    await logger('info', 'slack.draft_rejected', {
      traceId,
      threadTs,
      userId: event.user,
      channel: event.channel,
      reason: intent.reason,
    })

    return { handled: true, responseText, threadTs, intent }
  }

  const {
    state: updated,
    revision,
    indicator,
  } = await applyRefinement(state, intent, deps, {
    threadTs,
    userId: event.user,
    channel: event.channel,
    traceId,
  })

  store.set(threadTs, updated)
  const responseText = formatRevisionMessage(revision, indicator)

  await slackClient.chat.postMessage({
    channel: event.channel,
    text: responseText,
    thread_ts: threadTs,
  })

  return { handled: true, responseText, threadTs, intent }
}
