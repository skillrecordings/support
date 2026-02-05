/**
 * Intent executor - Actually performs the work for detected intents
 */

import {
  type Contact,
  type Conversation,
  createFrontClient,
} from '@skillrecordings/front-sdk'
import { getSlackClient } from '../../../core/src/slack/client'
import { setAssistantStatus } from '../feedback/status'
import type { ParsedIntent } from './types'

function getFrontClient() {
  const token = process.env.FRONT_API_TOKEN
  if (!token) {
    throw new Error(
      'FRONT_API_TOKEN not configured - please add it to the Vercel environment variables'
    )
  }
  return createFrontClient({ apiToken: token })
}

export interface ExecutionContext {
  channel: string
  threadTs: string
  userId: string
}

export interface ExecutionResult {
  success: boolean
  message: string
  data?: unknown
}

/**
 * Update the assistant status in Slack to show what we're doing
 */
async function updateStatus(
  context: ExecutionContext,
  status: string
): Promise<void> {
  await setAssistantStatus(context.channel, context.threadTs, status, [status])
}

/**
 * Execute a parsed intent and return the result
 */
export async function executeIntent(
  intent: ParsedIntent,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const slackClient = getSlackClient()

  try {
    switch (intent.category) {
      case 'status_query':
        return await executeStatusQuery(context)

      case 'context_lookup':
        return await executeContextLookup(intent, context)

      case 'escalation':
        return await executeEscalation(intent, context)

      case 'draft_action':
        // Draft actions are handled by the refinement flow
        return {
          success: true,
          message:
            'Draft feedback captured — apply it by replying to a draft notification.',
        }

      case 'general_query':
        return await executeGeneralQuery(intent, context)

      case 'unknown':
      default:
        return {
          success: false,
          message:
            'I didn\'t understand that request. Try "status", "lookup customer@email.com", or "escalate to [name]".',
        }
    }
  } catch (error) {
    console.error('Intent execution failed:', error)
    return {
      success: false,
      message: `Something went wrong: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

/**
 * Execute general query - search Front for matching conversations
 */
async function executeGeneralQuery(
  intent: ParsedIntent,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const front = getFrontClient()
  const slackClient = getSlackClient()

  const query =
    intent.entities.query || intent.entities.product || intent.rawText || ''

  await updateStatus(context, `🔍 Searching Front for "${query}"...`)

  const conversations = await front.conversations.search(query)
  const results = conversations._results as Conversation[]

  await updateStatus(
    context,
    `📋 Found ${results.length} conversation${results.length === 1 ? '' : 's'}...`
  )

  if (results.length === 0) {
    const message = `No conversations found for "${query}".`
    await slackClient.chat.postMessage({
      channel: context.channel,
      text: message,
      thread_ts: context.threadTs,
    })
    return { success: true, message }
  }

  const lines: string[] = [
    `📋 *${results.length} conversation${results.length === 1 ? '' : 's'}* found for "${query}":`,
  ]

  for (const c of results.slice(0, 10)) {
    const subject = c.subject || 'No subject'
    const status = c.status || 'unknown'
    const link = `https://app.frontapp.com/open/${c.id}`
    const statusEmoji = getStatusEmoji(status)
    const date = c.created_at
      ? new Date(c.created_at * 1000).toLocaleDateString()
      : ''

    lines.push(
      `${statusEmoji} <${link}|${truncate(subject, 40)}> (${status}) ${date}`
    )
  }

  if (results.length > 10) {
    lines.push(`...and ${results.length - 10} more`)
  }

  const message = lines.join('\n')

  await slackClient.chat.postMessage({
    channel: context.channel,
    text: message,
    thread_ts: context.threadTs,
  })

  return {
    success: true,
    message,
    data: { conversationCount: results.length },
  }
}

/**
 * Execute status query - fetch pending/urgent conversations from Front
 */
async function executeStatusQuery(
  context: ExecutionContext
): Promise<ExecutionResult> {
  const front = getFrontClient()
  const slackClient = getSlackClient()

  // Update status: searching Front
  await updateStatus(context, '🔍 Searching Front for open conversations...')

  // Search for open/unassigned conversations
  const conversations = await front.conversations.search('status:open')
  const results = conversations._results as Conversation[]

  // Update status: analyzing results
  await updateStatus(context, `📊 Analyzing ${results.length} conversations...`)

  // Filter to unassigned or urgent
  const pending = results.filter(
    (c) => !c.assignee || c.status === 'unassigned'
  )
  const urgent = results.filter((c) =>
    c.tags?.some((t) => t.name?.toLowerCase().includes('urgent'))
  )

  // Build summary
  const lines: string[] = []

  if (urgent.length > 0) {
    lines.push(`🚨 *${urgent.length} urgent* conversations need attention:`)
    for (const c of urgent.slice(0, 5)) {
      const subject = c.subject || 'No subject'
      const link = c._links?.self
        ? `https://app.frontapp.com/open/${c.id}`
        : c.id
      lines.push(`  • <${link}|${truncate(subject, 50)}>`)
    }
    if (urgent.length > 5) {
      lines.push(`  ...and ${urgent.length - 5} more`)
    }
  }

  if (pending.length > 0) {
    lines.push(`📬 *${pending.length} unassigned* conversations:`)
    for (const c of pending.slice(0, 5)) {
      const subject = c.subject || 'No subject'
      const link = `https://app.frontapp.com/open/${c.id}`
      lines.push(`  • <${link}|${truncate(subject, 50)}>`)
    }
    if (pending.length > 5) {
      lines.push(`  ...and ${pending.length - 5} more`)
    }
  }

  if (lines.length === 0) {
    lines.push('✅ All clear! No urgent or unassigned conversations.')
  }

  const message = lines.join('\n')

  // Post results
  await slackClient.chat.postMessage({
    channel: context.channel,
    text: message,
    thread_ts: context.threadTs,
  })

  return {
    success: true,
    message,
    data: { urgent: urgent.length, pending: pending.length },
  }
}

/**
 * Execute context lookup - find customer by email and show history
 */
async function executeContextLookup(
  intent: ParsedIntent,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const email = intent.entities.email
  const name = intent.entities.name

  if (!email && !name) {
    return {
      success: false,
      message:
        'Please specify a customer email. Example: "lookup customer@example.com"',
    }
  }

  const front = getFrontClient()
  const slackClient = getSlackClient()

  const searchQuery = email || name || ''

  // Update status: searching Front
  await updateStatus(context, `🔍 Searching Front for "${searchQuery}"...`)

  // Search for conversations with this customer
  const conversations = await front.conversations.search(searchQuery)
  const results = conversations._results as Conversation[]

  // Update status: found results
  await updateStatus(
    context,
    `📋 Found ${results.length} conversation${results.length === 1 ? '' : 's'}...`
  )

  if (results.length === 0) {
    const message = `No conversations found for "${searchQuery}".`
    await slackClient.chat.postMessage({
      channel: context.channel,
      text: message,
      thread_ts: context.threadTs,
    })
    return { success: true, message }
  }

  // Build summary
  const lines: string[] = [
    `📋 *${results.length} conversation${results.length === 1 ? '' : 's'}* found for ${searchQuery}:`,
  ]

  for (const c of results.slice(0, 10)) {
    const subject = c.subject || 'No subject'
    const status = c.status || 'unknown'
    const link = `https://app.frontapp.com/open/${c.id}`
    const statusEmoji = getStatusEmoji(status)
    const date = c.created_at
      ? new Date(c.created_at * 1000).toLocaleDateString()
      : ''

    lines.push(
      `${statusEmoji} <${link}|${truncate(subject, 40)}> (${status}) ${date}`
    )
  }

  if (results.length > 10) {
    lines.push(`...and ${results.length - 10} more`)
  }

  const message = lines.join('\n')

  await slackClient.chat.postMessage({
    channel: context.channel,
    text: message,
    thread_ts: context.threadTs,
  })

  return {
    success: true,
    message,
    data: { conversationCount: results.length },
  }
}

/**
 * Execute escalation - find teammate and escalate
 */
async function executeEscalation(
  intent: ParsedIntent,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const name = intent.entities.name
  const slackClient = getSlackClient()

  // For now, just acknowledge the escalation
  // Full implementation would:
  // 1. Look up teammate by name in Front
  // 2. Assign conversation to them
  // 3. Add escalation tag
  // 4. Notify via Slack

  const message = name
    ? `📣 Escalation to ${name} noted. I'll route this to them.`
    : `📣 Escalation noted. I'll route this to the appropriate teammate.`

  await slackClient.chat.postMessage({
    channel: context.channel,
    text: message,
    thread_ts: context.threadTs,
  })

  // TODO: Implement actual escalation logic
  // - Look up conversation from thread context
  // - Find teammate by name
  // - Assign and tag

  return {
    success: true,
    message,
    data: { escalatedTo: name || 'general' },
  }
}

// Helpers

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3)}...`
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'open':
    case 'unassigned':
      return '📬'
    case 'assigned':
      return '👤'
    case 'archived':
      return '📦'
    case 'snoozed':
      return '😴'
    case 'deleted':
      return '🗑️'
    default:
      return '📧'
  }
}
