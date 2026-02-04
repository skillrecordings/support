import { randomUUID } from 'node:crypto'
import { initializeAxiom, log } from '../../../core/src/observability/axiom'
import { getSlackClient } from '../../../core/src/slack/client'
import {
  getActionConfirmationStore,
  requestActionConfirmation,
  requiresActionConfirmation,
} from '../confirmations/action'
import {
  type QuickActionContext,
  type QuickActionDeps,
  handleQuickAction,
  parseQuickAction,
} from '../intents/action'
import { getDraftStore } from '../intents/draft'
import { executeIntent } from '../intents/executor'
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

export interface AppMentionDeps extends QuickActionDeps {
  slackClient?: ReturnType<typeof getSlackClient>
  draftStore?: ReturnType<typeof getDraftStore>
  confirmationStore?: ReturnType<typeof getActionConfirmationStore>
  resolveActionContext?: (
    payload: AppMentionPayload,
    threadTs: string
  ) => Promise<QuickActionContext> | QuickActionContext
}

function stripLeadingMention(text: string): string {
  return text.replace(/^<@[^>]+>\s*/, '').trim()
}

export async function handleAppMention(
  payload: AppMentionPayload,
  deps?: AppMentionDeps
): Promise<{
  intent: ParsedIntent
  responseText: string
  threadTs: string
  channel: string
}> {
  initializeAxiom()

  const rawText = stripLeadingMention(payload.event.text)
  const threadTs = payload.event.thread_ts ?? payload.event.ts
  const quickAction = parseQuickAction(rawText)
  const slackClient = deps?.slackClient ?? getSlackClient()

  if (quickAction) {
    const draftStore = getDraftStore({ draftStore: deps?.draftStore })
    const draftState = draftStore.get(threadTs)
    const latestDraft = draftState?.versions.at(-1)
    const context: QuickActionContext = deps?.resolveActionContext
      ? await deps.resolveActionContext(payload, threadTs)
      : {
          conversationId: draftState?.conversationId ?? '',
          draftText: latestDraft?.text,
          recipientEmail: draftState?.recipientEmail,
          threadTs,
          channel: payload.event.channel,
          requestedBy: payload.event.user,
        }

    if (requiresActionConfirmation(quickAction)) {
      const confirmationStore = getActionConfirmationStore({
        confirmationStore: deps?.confirmationStore,
      })
      const { message } = requestActionConfirmation({
        store: confirmationStore,
        threadTs,
        action: quickAction,
        context,
      })

      await slackClient.chat.postMessage({
        channel: payload.event.channel,
        text: message,
        thread_ts: threadTs,
      })

      await log('info', 'slack.quick_action_confirmation', {
        traceId: payload.event_id ?? randomUUID(),
        slackThreadTs: threadTs,
        userId: payload.event.user,
        actionType: quickAction.type,
      })

      return {
        intent: {
          category: 'quick_action',
          confidence: 0.9,
          entities: {},
          rawText,
        },
        responseText: message,
        threadTs,
        channel: payload.event.channel,
      }
    }

    const result = await handleQuickAction(quickAction, context, deps)

    await slackClient.chat.postMessage({
      channel: payload.event.channel,
      text: result.message,
      thread_ts: threadTs,
    })

    return {
      intent: {
        category: 'quick_action',
        confidence: 0.9,
        entities: {},
        rawText,
      },
      responseText: result.message,
      threadTs,
      channel: payload.event.channel,
    }
  }

  const { intent, response } = await routeIntent(rawText)

  // Only post the placeholder response for unknown intents
  // For known intents, the executor will handle messaging
  if (intent.category === 'unknown') {
    await slackClient.chat.postMessage({
      channel: payload.event.channel,
      text: response,
      thread_ts: threadTs,
    })
  } else {
    // Execute the intent (this will post results to the thread)
    const executionResult = await executeIntent(intent, {
      channel: payload.event.channel,
      threadTs,
      userId: payload.event.user,
    })

    // If execution failed, post the error message
    if (!executionResult.success) {
      await slackClient.chat.postMessage({
        channel: payload.event.channel,
        text: `⚠️ ${executionResult.message}`,
        thread_ts: threadTs,
      })
    }

    await log('info', 'slack.intent_executed', {
      traceId: payload.event_id ?? randomUUID(),
      slackThreadTs: threadTs,
      userId: payload.event.user,
      detectedIntent: intent.category,
      executionSuccess: executionResult.success,
    })
  }

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
