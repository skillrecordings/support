/**
 * Slack status feedback utilities
 * Provides visual feedback to users while the bot is processing
 */

import { getSlackClient } from '../../../core/src/slack/client'

type SlackClient = ReturnType<typeof getSlackClient>

export interface StatusFeedbackDeps {
  slackClient?: SlackClient
}

/**
 * Add a reaction to a message (e.g., 👀 to show we're looking at it)
 */
export async function addReaction(
  channel: string,
  timestamp: string,
  emoji: string = 'eyes',
  deps?: StatusFeedbackDeps
): Promise<void> {
  const client = deps?.slackClient ?? getSlackClient()
  try {
    await client.reactions.add({
      channel,
      timestamp,
      name: emoji,
    })
  } catch (error) {
    // Ignore errors (e.g., already reacted)
    console.warn(`Failed to add reaction ${emoji}:`, error)
  }
}

/**
 * Remove a reaction from a message
 */
export async function removeReaction(
  channel: string,
  timestamp: string,
  emoji: string = 'eyes',
  deps?: StatusFeedbackDeps
): Promise<void> {
  const client = deps?.slackClient ?? getSlackClient()
  try {
    await client.reactions.remove({
      channel,
      timestamp,
      name: emoji,
    })
  } catch (error) {
    // Ignore errors (e.g., reaction doesn't exist)
    console.warn(`Failed to remove reaction ${emoji}:`, error)
  }
}

/**
 * Set assistant thread status (for Slack AI Assistant panel)
 * Requires assistant:write scope and assistant_thread_* events
 */
export async function setAssistantStatus(
  channelId: string,
  threadTs: string,
  status: string,
  loadingMessages: string[] = [],
  deps?: StatusFeedbackDeps
): Promise<void> {
  const client = deps?.slackClient ?? getSlackClient()
  try {
    await client.assistant?.threads?.setStatus({
      channel_id: channelId,
      thread_ts: threadTs,
      status,
      loading_messages: loadingMessages.slice(0, 10), // Slack allows max 10
    })
  } catch (error) {
    // Assistant API may not be available - that's okay
    console.warn('Failed to set assistant status:', error)
  }
}

/**
 * Clear assistant thread status
 */
export async function clearAssistantStatus(
  channelId: string,
  threadTs: string,
  deps?: StatusFeedbackDeps
): Promise<void> {
  await setAssistantStatus(channelId, threadTs, '', [], deps)
}

/**
 * Wrapper that adds a reaction on start and removes it when done
 * Usage: await withThinkingReaction(channel, ts, async () => { ... })
 */
export async function withThinkingReaction<T>(
  channel: string,
  timestamp: string,
  fn: () => Promise<T>,
  emoji: string = 'eyes',
  deps?: StatusFeedbackDeps
): Promise<T> {
  await addReaction(channel, timestamp, emoji, deps)
  try {
    return await fn()
  } finally {
    await removeReaction(channel, timestamp, emoji, deps)
  }
}
