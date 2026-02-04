/**
 * Front CLI commands for debugging and investigation
 *
 * Provides direct access to Front API for:
 * - Fetching messages (body, author, recipients)
 * - Fetching conversations with message history
 * - Listing and looking up teammates
 * - Comparing webhook data vs API data
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type {
  Message as FrontMessage,
  MessageList,
} from '@skillrecordings/front-sdk'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { registerArchiveCommand } from './archive'
import { registerAssignCommand } from './assign'
import { registerBulkArchiveCommand } from './bulk-archive'
import { registerBulkAssignCommand } from './bulk-assign'
import { registerConversationTagCommands } from './conversation-tags'
import {
  conversationActions,
  conversationLinks,
  hateoasWrap,
  messageLinks,
  teammateLinks,
  teammateListLinks,
} from './hateoas'
import { registerInboxCommand } from './inbox'
import { registerPullCommand } from './pull-conversations'
import { registerReplyCommand } from './reply'
import { registerReportCommand } from './report'
import { registerTagCommands } from './tags'
import { registerTriageCommand } from './triage'

type Message = FrontMessage

/**
 * Get Front API client from environment (instrumented)
 */
function getFrontClient() {
  return createInstrumentedFrontClient({ apiToken: requireFrontToken() })
}

/**
 * Get Front SDK client from environment (full typed client)
 */
function getFrontSdkClient() {
  return createInstrumentedFrontClient({ apiToken: requireFrontToken() })
}

function requireFrontToken(): string {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new CLIError({
      userMessage: 'FRONT_API_TOKEN environment variable is required.',
      suggestion: 'Set FRONT_API_TOKEN in your shell or .env.local.',
    })
  }
  return apiToken
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
 * Normalize Front resource ID or URL to ID
 */
function normalizeId(idOrUrl: string): string {
  return idOrUrl.startsWith('http') ? idOrUrl.split('/').pop()! : idOrUrl
}

/**
 * Command: skill front message <id>
 * Fetch full message details from Front API
 */
export async function getMessage(
  ctx: CommandContext,
  id: string,
  options: { json?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const front = getFrontClient()
    const message = await front.messages.get(normalizeId(id))

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'message',
          command: `skill front message ${normalizeId(id)} --json`,
          data: message,
          links: messageLinks(message.id),
        })
      )
      return
    }

    ctx.output.data('\n📧 Message Details:')
    ctx.output.data(`   ID:       ${message.id}`)
    ctx.output.data(`   Type:     ${message.type}`)
    ctx.output.data(`   Subject:  ${message.subject || '(none)'}`)
    ctx.output.data(`   Created:  ${formatTimestamp(message.created_at)}`)

    if (message.author) {
      ctx.output.data(
        `   Author:   ${message.author.email || message.author.id}`
      )
    }

    ctx.output.data('\n📬 Recipients:')
    for (const r of message.recipients) {
      ctx.output.data(`   ${r.role}: ${r.handle}`)
    }

    ctx.output.data('\n📝 Body:')
    // Strip HTML and show preview
    const textBody =
      message.text ||
      message.body
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    ctx.output.data(
      `   Length: ${message.body.length} chars (HTML), ${textBody.length} chars (text)`
    )
    ctx.output.data(`   Preview: ${truncate(textBody, 500)}`)

    if (message.attachments && message.attachments.length > 0) {
      ctx.output.data(`\n📎 Attachments: ${message.attachments.length}`)
      for (const a of message.attachments) {
        ctx.output.data(`   - ${a.filename} (${a.content_type})`)
      }
    }

    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to fetch Front message.',
            suggestion: 'Verify the message ID and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill front conversation <id>
 * Fetch conversation details and optionally messages
 */
export async function getConversation(
  ctx: CommandContext,
  id: string,
  options: { json?: boolean; messages?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const front = getFrontClient()
    const conversation = await front.conversations.get(normalizeId(id))

    // Fetch messages if requested
    let messages: Message[] | undefined
    if (options.messages) {
      const messageList = (await front.conversations.listMessages(
        normalizeId(id)
      )) as MessageList
      messages = messageList._results ?? []
    }

    if (outputJson) {
      const convId = normalizeId(id)
      ctx.output.data(
        hateoasWrap({
          type: 'conversation',
          command: `skill front conversation ${convId} --json`,
          data: { conversation, messages },
          links: conversationLinks(conversation.id),
          actions: conversationActions(conversation.id),
        })
      )
      return
    }

    ctx.output.data('\n💬 Conversation Details:')
    ctx.output.data(`   ID:       ${conversation.id}`)
    ctx.output.data(`   Subject:  ${conversation.subject || '(none)'}`)
    ctx.output.data(`   Status:   ${conversation.status}`)
    ctx.output.data(`   Created:  ${formatTimestamp(conversation.created_at)}`)

    if (conversation.recipient) {
      ctx.output.data(`   Recipient: ${conversation.recipient.handle}`)
    }

    if (conversation.assignee) {
      ctx.output.data(`   Assignee: ${conversation.assignee.email}`)
    }

    if (conversation.tags && conversation.tags.length > 0) {
      ctx.output.data(
        `   Tags:     ${conversation.tags.map((t: { name: string }) => t.name).join(', ')}`
      )
    }

    if (options.messages && messages) {
      ctx.output.data(`\n📨 Messages (${messages.length}):`)
      ctx.output.data('-'.repeat(80))

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

        ctx.output.data(`\n[${direction}] ${time} - ${author}`)
        ctx.output.data(`   ${truncate(textBody, 200)}`)
      }
    } else if (!options.messages) {
      ctx.output.data('\n   (use --messages to see message history)')
    }

    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to fetch Front conversation.',
            suggestion: 'Verify the conversation ID and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill front teammates
 * List all teammates in the workspace
 */
async function listTeammates(
  ctx: CommandContext,
  options: { json?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const front = getFrontSdkClient()
    const result = await front.teammates.list()

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'teammate-list',
          command: 'skill front teammates --json',
          data: result._results,
          links: teammateListLinks(
            result._results.map((t) => ({ id: t.id, email: t.email }))
          ),
        })
      )
      return
    }

    ctx.output.data('\n👥 Teammates:')
    ctx.output.data('-'.repeat(60))

    for (const teammate of result._results) {
      const available = teammate.is_available ? '✓' : '✗'
      ctx.output.data(`   ${available} ${teammate.id}`)
      ctx.output.data(`      Email: ${teammate.email}`)
      if (teammate.first_name || teammate.last_name) {
        ctx.output.data(
          `      Name:  ${teammate.first_name || ''} ${teammate.last_name || ''}`.trim()
        )
      }
      if (teammate.username) {
        ctx.output.data(`      Username: ${teammate.username}`)
      }
      ctx.output.data('')
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list Front teammates.',
            suggestion: 'Verify FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill front teammate <id>
 * Get a specific teammate by ID
 */
async function getTeammate(
  ctx: CommandContext,
  id: string,
  options: { json?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const front = getFrontSdkClient()
    const teammate = await front.teammates.get(id)

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'teammate',
          command: `skill front teammate ${id} --json`,
          data: teammate,
          links: teammateLinks(teammate.id),
        })
      )
      return
    }

    ctx.output.data('\n👤 Teammate Details:')
    ctx.output.data(`   ID:        ${teammate.id}`)
    ctx.output.data(`   Email:     ${teammate.email}`)
    if (teammate.first_name || teammate.last_name) {
      ctx.output.data(
        `   Name:      ${teammate.first_name || ''} ${teammate.last_name || ''}`.trim()
      )
    }
    if (teammate.username) {
      ctx.output.data(`   Username:  ${teammate.username}`)
    }
    ctx.output.data(`   Available: ${teammate.is_available ? 'Yes' : 'No'}`)
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to fetch Front teammate.',
            suggestion: 'Verify the teammate ID and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Register Front commands with Commander
 */
export function registerFrontCommands(program: Command): void {
  const front = program
    .command('front')
    .description('Front conversations, inboxes, tags, archival, and reporting')

  front
    .command('message')
    .description('Get a message by ID (body, author, recipients, attachments)')
    .argument('<id>', 'Message ID (e.g., msg_xxx)')
    .option('--json', 'Output as JSON')
    .action(
      async (id: string, options: { json?: boolean }, command: Command) => {
        const opts =
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals()
            : {
                ...command.parent?.opts(),
                ...command.opts(),
              }
        const ctx = await createContext({
          format: options.json ? 'json' : opts.format,
          verbose: opts.verbose,
          quiet: opts.quiet,
        })
        await getMessage(ctx, id, options)
      }
    )

  front
    .command('conversation')
    .description('Get a conversation by ID (status, tags, assignee, messages)')
    .argument('<id>', 'Conversation ID (e.g., cnv_xxx)')
    .option('--json', 'Output as JSON')
    .option('-m, --messages', 'Include message history')
    .action(
      async (
        id: string,
        options: { json?: boolean; messages?: boolean },
        command: Command
      ) => {
        const opts =
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals()
            : {
                ...command.parent?.opts(),
                ...command.opts(),
              }
        const ctx = await createContext({
          format: options.json ? 'json' : opts.format,
          verbose: opts.verbose,
          quiet: opts.quiet,
        })
        await getConversation(ctx, id, options)
      }
    )

  front
    .command('teammates')
    .description('List all teammates in the workspace')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }, command: Command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await listTeammates(ctx, options)
    })

  front
    .command('teammate')
    .description('Get teammate details by ID')
    .argument('<id>', 'Teammate ID (e.g., tea_xxx or username)')
    .option('--json', 'Output as JSON')
    .action(
      async (id: string, options: { json?: boolean }, command: Command) => {
        const opts =
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals()
            : {
                ...command.parent?.opts(),
                ...command.opts(),
              }
        const ctx = await createContext({
          format: options.json ? 'json' : opts.format,
          verbose: opts.verbose,
          quiet: opts.quiet,
        })
        await getTeammate(ctx, id, options)
      }
    )

  // Register inbox, archive, report, triage commands
  registerInboxCommand(front)
  registerAssignCommand(front)
  registerBulkAssignCommand(front)
  registerArchiveCommand(front)
  registerBulkArchiveCommand(front)
  registerReportCommand(front)
  registerTriageCommand(front)
  registerConversationTagCommands(front)
  registerReplyCommand(front)

  // Register pull command for building eval datasets
  registerPullCommand(front)

  // Register tag management commands
  registerTagCommands(front)

  // Register cache command for DuckDB sync
}
