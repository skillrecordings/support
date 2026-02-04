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
import type { Conversation, Inbox, InboxList } from '@skillrecordings/front-sdk'
import type { Command } from 'commander'
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
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createInstrumentedFrontClient({ apiToken })
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
async function listInboxes(options: { json?: boolean }): Promise<void> {
  try {
    const front = getFrontClient()
    const inboxList = (await front.inboxes.list()) as InboxList
    const inboxes = inboxList._results ?? []

    if (options.json) {
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'inbox-list',
            command: 'skill front inbox --json',
            data: inboxes,
            links: inboxListLinks(
              inboxes.map((i) => ({ id: i.id, name: i.name }))
            ),
          }),
          null,
          2
        )
      )
      return
    }

    console.log('\n📥 Inboxes:')
    console.log('-'.repeat(80))

    for (const inbox of inboxes) {
      const privacy = inbox.is_private ? '🔒 Private' : '🌐 Public'
      console.log(`\n   ${inbox.name}`)
      console.log(`      ID:      ${inbox.id}`)
      console.log(`      Privacy: ${privacy}`)
      if (inbox.address) {
        console.log(`      Address: ${inbox.address}`)
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
 * Command: skill front inbox <inbox-name-or-id>
 * List conversations in an inbox with optional filtering
 */
async function listConversations(
  inboxNameOrId: string,
  options: {
    json?: boolean
    status?: 'unassigned' | 'assigned' | 'archived'
    tag?: string
    limit?: string
  }
): Promise<void> {
  try {
    const front = getFrontClient()

    // Find inbox
    const inbox = await findInbox(inboxNameOrId)
    if (!inbox) {
      throw new Error(`Inbox not found: ${inboxNameOrId}`)
    }

    const totalLimit = parseInt(String(options.limit ?? '50'), 10)
    const resolvedLimit =
      Number.isFinite(totalLimit) && totalLimit > 0 ? totalLimit : undefined

    // Build display filters (for human output)
    const filters: string[] = []
    if (options.status) {
      filters.push(`status: ${options.status}`)
    }
    if (options.tag) {
      filters.push(`tag: "${options.tag}"`)
    }

    // Build query string — use q[statuses][] for status (Front API format)
    // and q= for free-text/tag filters. Page size is always 50.
    const queryParts: string[] = ['limit=50']
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

    while (nextUrl) {
      const response: {
        _results: Conversation[]
        _pagination?: { next?: string }
      } = await front.raw.get(nextUrl)

      conversations.push(...(response._results ?? []))

      if (!options.json) {
        process.stdout.write(
          `\r  Fetched ${conversations.length} conversations...`
        )
      }

      nextUrl = response._pagination?.next || null

      if (resolvedLimit && conversations.length >= resolvedLimit) {
        conversations.splice(resolvedLimit)
        break
      }
    }

    if (!options.json) {
      console.log(`\n  Total: ${conversations.length} conversations\n`)
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'conversation-list',
            command: `skill front inbox ${inbox.id} --json`,
            data: {
              total: conversations.length,
              conversations,
            },
            links: conversationListLinks(
              conversations.map((c) => ({ id: c.id, subject: c.subject })),
              inbox.id
            ),
            actions: conversationListActions(inbox.id),
          }),
          null,
          2
        )
      )
      return
    }

    console.log(`\n📬 Conversations in "${inbox.name}":`)
    if (filters.length > 0) {
      console.log(`   Filters: ${filters.join(', ')}`)
    }
    console.log('-'.repeat(80))

    if (conversations.length === 0) {
      console.log('   (no conversations found)')
      console.log('')
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

      console.log(`\n[${statusIcon}] ${conv.subject || '(no subject)'}`)
      console.log(`   ID:        ${conv.id}`)
      console.log(`   Status:    ${conv.status}`)
      console.log(`   Recipient: ${recipient}`)
      console.log(`   ${assignee}`)
      console.log(`   Tags:      ${tags}`)
      console.log(`   Created:   ${time}`)
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
    .option(
      '--status <status>',
      'Filter by status (unassigned, assigned, archived)'
    )
    .option('--tag <tag>', 'Filter by tag name')
    .option('--limit <n>', 'Limit number of results', '50')
    .action(async (inboxNameOrId?: string, options?: any) => {
      if (!inboxNameOrId) {
        await listInboxes(options || {})
      } else {
        await listConversations(inboxNameOrId, options || {})
      }
    })
}
