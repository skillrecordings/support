import { randomUUID } from 'node:crypto'
import { initializeAxiom, log } from '../../../core/src/observability/axiom'
import { getSlackClient } from '../../../core/src/slack/client'
import {
  getActionConfirmationStore,
  resolveActionConfirmation,
} from '../confirmations/action'
import { type QuickActionDeps, handleQuickAction } from '../intents/action'
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
import { executeIntent } from '../intents/executor'
import { routeIntent } from '../intents/router'

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

export interface ThreadReplyDeps extends DraftRefinementDeps, QuickActionDeps {
  slackClient?: ReturnType<typeof getSlackClient>
  draftStore?: DraftStore
  confirmationStore?: ReturnType<typeof getActionConfirmationStore>
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

  const confirmationStore = getActionConfirmationStore({
    confirmationStore: deps?.confirmationStore,
  })
  const confirmation = resolveActionConfirmation(
    confirmationStore,
    threadTs,
    event.text
  )
  if (confirmation.status !== 'ignore') {
    const slackClient = deps?.slackClient ?? getSlackClient()

    if (confirmation.status === 'cancel') {
      const responseText = 'Canceled — no changes were made.'
      await slackClient.chat.postMessage({
        channel: event.channel,
        text: responseText,
        thread_ts: threadTs,
      })
      return { handled: true, responseText, threadTs }
    }

    const result = await handleQuickAction(
      confirmation.action,
      confirmation.context,
      deps
    )
    await slackClient.chat.postMessage({
      channel: event.channel,
      text: result.message,
      thread_ts: threadTs,
    })
    return { handled: true, responseText: result.message, threadTs }
  }

  const intent = parseRefinementIntent(event.text)
  const store = getDraftStore(deps)
  const state = store.get(threadTs)

  // If no draft context, fall back to general intent routing
  if (!intent || !state) {
    const slackClient = deps?.slackClient ?? getSlackClient()
    const { intent: routedIntent, response } = routeIntent(event.text)

    // Execute the intent
    const executionResult = await executeIntent(routedIntent, {
      channel: event.channel,
      threadTs,
      userId: event.user,
    })

    // If execution failed or unknown intent, post the response
    if (!executionResult.success || routedIntent.category === 'unknown') {
      await slackClient.chat.postMessage({
        channel: event.channel,
        text: executionResult.success
          ? response
          : `⚠️ ${executionResult.message}`,
        thread_ts: threadTs,
      })
    }

    return {
      handled: true,
      responseText: executionResult.message || response,
      threadTs,
    }
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
      slackThreadTs: threadTs,
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
      slackThreadTs: threadTs,
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
