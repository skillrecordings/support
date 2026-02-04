/**
 * Front inbox command for listing inboxes and conversations
 *
 * Usage:
 * - List all inboxes: skill front inbox
 * - List conversations in inbox: skill front inbox <inbox-name-or-id>
 * - Filter by status: skill front inbox <inbox> --status unassigned
 * - Filter by tag: skill front inbox <inbox> --tag "500 Error"
 * - Limit results: skill front inbox <inbox> --limit 50
 * - JSON output: skill front inbox <inbox> --json
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type {
  Conversation,
  ConversationList,
  Inbox,
  InboxList,
} from '@skillrecordings/front-sdk'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import {
  conversationListActions,
  conversationListLinks,
  hateoasWrap,
  inboxActions,
  inboxListLinks,
} from './hateoas'

/**
 * Get Front API client from environment (instrumented)
 */
function getFrontClient() {
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
 * Find inbox by ID or name
 */
async function findInbox(nameOrId: string): Promise<Inbox | null> {
  const front = getFrontClient()
  const normalizedId = normalizeId(nameOrId)

  // Try direct ID lookup first
  if (normalizedId.startsWith('inb_')) {
    try {
      const inbox = await front.inboxes.get(normalizedId)
      return inbox
    } catch {
      // Fall through to name search
    }
  }

  // Search by name
  const inboxList = (await front.inboxes.list()) as InboxList
  const inboxes = inboxList._results ?? []
  const found = inboxes.find(
    (inbox) =>
      inbox.name.toLowerCase() === nameOrId.toLowerCase() ||
      inbox.id === normalizedId
  )

  return found || null
}

/**
 * Command: skill front inbox
 * List all inboxes
 */
export async function listInboxes(
  ctx: CommandContext,
  options: { json?: boolean; idsOnly?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const idsOnly = options.idsOnly === true && !outputJson

  try {
    const front = getFrontClient()
    const inboxList = (await front.inboxes.list()) as InboxList
    const inboxes = inboxList._results ?? []

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'inbox-list',
          command: 'skill front inbox --json',
          data: inboxes,
          links: inboxListLinks(
            inboxes.map((i) => ({ id: i.id, name: i.name }))
          ),
        })
      )
      return
    }

    if (idsOnly) {
      for (const inbox of inboxes) {
        ctx.output.data(inbox.id)
      }
      return
    }

    ctx.output.data('\n📥 Inboxes:')
    ctx.output.data('-'.repeat(80))

    for (const inbox of inboxes) {
      const privacy = inbox.is_private ? '🔒 Private' : '🌐 Public'
      ctx.output.data(`\n   ${inbox.name}`)
      ctx.output.data(`      ID:      ${inbox.id}`)
      ctx.output.data(`      Privacy: ${privacy}`)
      if (inbox.address) {
        ctx.output.data(`      Address: ${inbox.address}`)
      }
    }

    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list Front inboxes.',
            suggestion: 'Verify FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill front inbox <inbox-name-or-id>
 * List conversations in an inbox with optional filtering
 */
export async function listConversations(
  ctx: CommandContext,
  inboxNameOrId: string,
  options: {
    json?: boolean
    idsOnly?: boolean
    status?: 'unassigned' | 'assigned' | 'archived'
    tag?: string
    limit?: string
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const idsOnly = options.idsOnly === true && !outputJson

  try {
    const front = getFrontClient()

    // Find inbox
    const inbox = await findInbox(inboxNameOrId)
    if (!inbox) {
      throw new CLIError({
        userMessage: `Inbox not found: ${inboxNameOrId}`,
        suggestion: 'Run `skill front inbox` to list available inboxes.',
      })
    }

    // Build query filters
    const filters: string[] = []
    if (options.status) {
      filters.push(`status:${options.status}`)
    }
    if (options.tag) {
      filters.push(`tag:"${options.tag}"`)
    }

    const parsedLimit = options.limit ? Number.parseInt(options.limit, 10) : 50
    const requestedLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50
    const pageSize = 50

    // Build query URL
    const queryParts: string[] = [`limit=${pageSize}`]
    if (options.status) {
      queryParts.push(`q[statuses][]=${encodeURIComponent(options.status)}`)
    }
    if (options.tag) {
      queryParts.push(`q=${encodeURIComponent(`tag:"${options.tag}"`)}`)
    }
    const queryString = `?${queryParts.join('&')}`

    // Fetch conversations with pagination
    const conversations: Conversation[] = []
    let nextUrl: string | null =
      `/inboxes/${inbox.id}/conversations${queryString}`
    let hasMore = false

    while (nextUrl) {
      const response = (await front.raw.get(nextUrl)) as ConversationList
      conversations.push(...(response._results ?? []))

      if (conversations.length >= requestedLimit) {
        conversations.length = requestedLimit
        hasMore = Boolean(response._pagination?.next)
        nextUrl = null
        break
      }

      if (response._pagination?.next) {
        hasMore = true
      }
      nextUrl = response._pagination?.next || null
    }

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'conversation-list',
          command: `skill front inbox ${inbox.id} --json`,
          data: conversations,
          links: conversationListLinks(
            conversations.map((c) => ({ id: c.id, subject: c.subject })),
            inbox.id
          ),
          actions: conversationListActions(inbox.id),
        })
      )
      return
    }

    if (idsOnly) {
      for (const conv of conversations) {
        ctx.output.data(conv.id)
      }
      return
    }

    ctx.output.data(`\n📬 Conversations in "${inbox.name}":`)
    if (filters.length > 0) {
      ctx.output.data(`   Filters: ${filters.join(', ')}`)
    }
    ctx.output.data('-'.repeat(80))

    if (conversations.length === 0) {
      ctx.output.data('   (no conversations found)')
      ctx.output.data('')
      return
    }

    for (const conv of conversations) {
      const statusIcon =
        conv.status === 'archived'
          ? '📦'
          : conv.status === 'assigned'
            ? '👤'
            : '❓'
      const time = formatTimestamp(conv.created_at)
      const recipient = conv.recipient?.handle || '(no recipient)'
      const assignee = conv.assignee
        ? `Assigned to: ${conv.assignee.email}`
        : 'Unassigned'
      const tags =
        conv.tags && conv.tags.length > 0
          ? conv.tags.map((t) => t.name).join(', ')
          : '(no tags)'

      ctx.output.data(`\n[${statusIcon}] ${conv.subject || '(no subject)'}`)
      ctx.output.data(`   ID:        ${conv.id}`)
      ctx.output.data(`   Status:    ${conv.status}`)
      ctx.output.data(`   Recipient: ${recipient}`)
      ctx.output.data(`   ${assignee}`)
      ctx.output.data(`   Tags:      ${tags}`)
      ctx.output.data(`   Created:   ${time}`)
    }

    ctx.output.data('')

    // Show pagination hint
    if (hasMore) {
      ctx.output.data(
        `   💡 More conversations available. Use --limit to adjust results.`
      )
      ctx.output.data('')
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list Front inbox conversations.',
            suggestion: 'Verify inbox ID, filters, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Register inbox command with Commander
 */
export function registerInboxCommand(front: Command): void {
  const inbox = front
    .command('inbox')
    .description('List inboxes, or list conversations in an inbox')

  inbox
    .argument(
      '[inbox-name-or-id]',
      'Inbox name or ID (omit to list all inboxes)'
    )
    .option('--json', 'Output as JSON')
    .option('--ids-only', 'Output only IDs (one per line)')
    .option(
      '--status <status>',
      'Filter by status (unassigned, assigned, archived)'
    )
    .option('--tag <tag>', 'Filter by tag name')
    .option('--limit <n>', 'Limit number of results', '50')
    .action(
      async (inboxNameOrId?: string, options?: any, command?: Command) => {
        const opts =
          command && typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals()
            : {
                ...command?.parent?.opts(),
                ...command?.opts(),
              }
        const ctx = await createContext({
          format: options?.json ? 'json' : opts?.format,
          verbose: opts?.verbose,
          quiet: opts?.quiet,
        })
        if (!inboxNameOrId) {
          await listInboxes(ctx, options || {})
        } else {
          await listConversations(ctx, inboxNameOrId, options || {})
        }
      }
    )
}
