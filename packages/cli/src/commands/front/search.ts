/**
 * Front CLI search command
 *
 * Search conversations using Front's query syntax.
 * Supports text search, filters (inbox, tag, assignee, status, date), and pagination.
 *
 * @see https://dev.frontapp.com/docs/search-1
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Conversation } from '@skillrecordings/front-sdk'
import type { Command } from 'commander'
import {
  conversationListActions,
  conversationListLinks,
  hateoasWrap,
} from './hateoas'

function getFrontClient() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createInstrumentedFrontClient({ apiToken })
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 3) + '...'
}

/**
 * Build search query string from text + option filters.
 * Front search syntax: <text> <filter>:<value> ...
 */
function buildQuery(
  query: string,
  options: {
    inbox?: string
    tag?: string
    assignee?: string
    status?: string
    from?: string
    after?: string
    before?: string
  }
): string {
  const parts: string[] = [query]

  if (options.inbox) parts.push(`inbox:${options.inbox}`)
  if (options.tag) parts.push(`tag:${options.tag}`)
  if (options.assignee) parts.push(`assignee:${options.assignee}`)
  if (options.status) parts.push(`is:${options.status}`)
  if (options.from) parts.push(`from:${options.from}`)
  if (options.after) parts.push(`after:${options.after}`)
  if (options.before) parts.push(`before:${options.before}`)

  return parts.filter(Boolean).join(' ')
}

interface SearchOptions {
  json?: boolean
  inbox?: string
  tag?: string
  assignee?: string
  status?: string
  from?: string
  after?: string
  before?: string
  limit?: string
}

async function searchConversations(
  query: string,
  options: SearchOptions
): Promise<void> {
  try {
    const front = getFrontClient()
    const fullQuery = buildQuery(query, options)
    const limit = parseInt(String(options.limit ?? '25'), 10)
    const resolvedLimit =
      Number.isFinite(limit) && limit > 0 ? limit : undefined

    // Paginate through search results
    const conversations: Conversation[] = []
    let nextUrl: string | null =
      `/conversations/search/${encodeURIComponent(fullQuery)}`

    while (nextUrl) {
      const response: {
        _results: Conversation[]
        _pagination?: { next?: string }
        _total?: number
      } = await front.raw.get(nextUrl)

      conversations.push(...(response._results ?? []))

      if (!options.json) {
        process.stdout.write(`\r  Searching... ${conversations.length} results`)
      }

      nextUrl = response._pagination?.next || null

      if (resolvedLimit && conversations.length >= resolvedLimit) {
        conversations.splice(resolvedLimit)
        break
      }
    }

    if (!options.json) {
      console.log('')
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'search-results',
            command: `skill front search ${JSON.stringify(fullQuery)} --json`,
            data: {
              query: fullQuery,
              total: conversations.length,
              conversations,
            },
            links: conversationListLinks(
              conversations.map((c) => ({ id: c.id, subject: c.subject }))
            ),
            actions: options.inbox
              ? conversationListActions(options.inbox)
              : [],
          }),
          null,
          2
        )
      )
      return
    }

    console.log(`\n🔍 Search: ${fullQuery}`)
    console.log(`   ${conversations.length} results`)
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
      const assignee = conv.assignee ? conv.assignee.email : 'unassigned'
      const tags =
        conv.tags && conv.tags.length > 0
          ? conv.tags.map((t) => t.name).join(', ')
          : ''

      console.log(
        `\n[${statusIcon}] ${truncate(conv.subject || '(no subject)', 80)}`
      )
      console.log(`   ${conv.id}  ${assignee}  ${time}`)
      if (tags) {
        console.log(`   Tags: ${tags}`)
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

export function registerSearchCommand(frontCommand: Command): void {
  frontCommand
    .command('search')
    .description(
      'Search conversations (text, subject, filters). See https://dev.frontapp.com/docs/search-1'
    )
    .argument(
      '<query>',
      'Search query (text, "exact phrase", or filter syntax)'
    )
    .option('--inbox <id>', 'Filter by inbox ID (inb_xxx)')
    .option('--tag <id>', 'Filter by tag ID (tag_xxx)')
    .option('--assignee <id>', 'Filter by assignee (tea_xxx)')
    .option(
      '--status <status>',
      'Filter by status (open, archived, assigned, unassigned, unreplied, snoozed, resolved)'
    )
    .option('--from <email>', 'Filter by sender email')
    .option('--after <timestamp>', 'Filter after Unix timestamp')
    .option('--before <timestamp>', 'Filter before Unix timestamp')
    .option('--limit <n>', 'Max results (default 25)', '25')
    .option('--json', 'Output as JSON')
    .action(searchConversations)
}
