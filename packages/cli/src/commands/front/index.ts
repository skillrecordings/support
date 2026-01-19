/**
 * Front CLI commands for debugging and investigation
 *
 * Provides direct access to Front API for:
 * - Fetching messages (body, author, recipients)
 * - Fetching conversations with message history
 * - Comparing webhook data vs API data
 */

import {
  type FrontMessage,
  createFrontClient,
} from '@skillrecordings/core/front'
import type { Command } from 'commander'

type Message = FrontMessage

/**
 * Get Front API client from environment
 */
function getFrontClient() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createFrontClient(apiToken)
}

/**
 * Format timestamp to human-readable
 */
function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 3) + '...'
}

/**
 * Command: skill front message <id>
 * Fetch full message details from Front API
 */
async function getMessage(
  id: string,
  options: { json?: boolean }
): Promise<void> {
  try {
    const front = getFrontClient()
    const message = await front.getMessage(id)

    if (options.json) {
      console.log(JSON.stringify(message, null, 2))
      return
    }

    console.log('\n📧 Message Details:')
    console.log(`   ID:       ${message.id}`)
    console.log(`   Type:     ${message.type}`)
    console.log(`   Subject:  ${message.subject || '(none)'}`)
    console.log(`   Created:  ${formatTimestamp(message.created_at)}`)

    if (message.author) {
      console.log(`   Author:   ${message.author.email || message.author.id}`)
    }

    console.log('\n📬 Recipients:')
    for (const r of message.recipients) {
      console.log(`   ${r.role}: ${r.handle}`)
    }

    console.log('\n📝 Body:')
    // Strip HTML and show preview
    const textBody =
      message.text ||
      message.body
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    console.log(
      `   Length: ${message.body.length} chars (HTML), ${textBody.length} chars (text)`
    )
    console.log(`   Preview: ${truncate(textBody, 500)}`)

    if (message.attachments && message.attachments.length > 0) {
      console.log(`\n📎 Attachments: ${message.attachments.length}`)
      for (const a of message.attachments) {
        console.log(`   - ${a.filename} (${a.content_type})`)
      }
    }

    console.log('')
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Command: skill front conversation <id>
 * Fetch conversation details and optionally messages
 */
async function getConversation(
  id: string,
  options: { json?: boolean; messages?: boolean }
): Promise<void> {
  try {
    const front = getFrontClient()
    const conversation = await front.getConversation(id)

    // Fetch messages if requested
    let messages: Message[] | undefined
    if (options.messages) {
      messages = await front.getConversationMessages(id)
    }

    if (options.json) {
      console.log(JSON.stringify({ conversation, messages }, null, 2))
      return
    }

    console.log('\n💬 Conversation Details:')
    console.log(`   ID:       ${conversation.id}`)
    console.log(`   Subject:  ${conversation.subject || '(none)'}`)
    console.log(`   Status:   ${conversation.status}`)
    console.log(`   Created:  ${formatTimestamp(conversation.created_at)}`)

    if (conversation.recipient) {
      console.log(`   Recipient: ${conversation.recipient.handle}`)
    }

    if (conversation.assignee) {
      console.log(`   Assignee: ${conversation.assignee.email}`)
    }

    if (conversation.tags && conversation.tags.length > 0) {
      console.log(
        `   Tags:     ${conversation.tags.map((t: { name: string }) => t.name).join(', ')}`
      )
    }

    if (options.messages && messages) {
      console.log(`\n📨 Messages (${messages.length}):`)
      console.log('-'.repeat(80))

      for (const msg of messages) {
        const direction = msg.is_inbound ? '← IN' : '→ OUT'
        const author = msg.author?.email || 'unknown'
        const time = formatTimestamp(msg.created_at)
        const textBody =
          msg.text ||
          msg.body
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        console.log(`\n[${direction}] ${time} - ${author}`)
        console.log(`   ${truncate(textBody, 200)}`)
      }
    } else if (!options.messages) {
      console.log('\n   (use --messages to see message history)')
    }

    console.log('')
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Register Front commands with Commander
 */
export function registerFrontCommands(program: Command): void {
  const front = program
    .command('front')
    .description('Front API commands for debugging')

  front
    .command('message')
    .description('Get message details from Front API')
    .argument('<id>', 'Message ID (e.g., msg_xxx)')
    .option('--json', 'Output as JSON')
    .action(getMessage)

  front
    .command('conversation')
    .description('Get conversation details from Front API')
    .argument('<id>', 'Conversation ID (e.g., cnv_xxx)')
    .option('--json', 'Output as JSON')
    .option('-m, --messages', 'Include message history')
    .action(getConversation)
}
