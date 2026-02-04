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
import { writeJsonOutput } from './json-output'

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
      writeJsonOutput(
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
          actions: options.inbox ? conversationListActions(options.inbox) : [],
        })
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
  const searchCmd = frontCommand
    .command('search')
    .description(
      'Search conversations (text, subject, filters). See https://dev.frontapp.com/docs/search-1'
    )
    .argument(
      '[query]',
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
    .addHelpText(
      'after',
      `
━━━ Front Search Query Syntax ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The <query> argument accepts free text and/or inline Front filters.
  CLI flags (--inbox, --status, etc.) are appended as filters automatically.
  You can mix both: skill front search "refund" --inbox inb_4bj7r --status open

TEXT SEARCH
  word1 word2             AND — both words must appear in subject or body
  "exact phrase"          Phrase match (quote the phrase)

FILTERS (use inline in query OR via CLI flags)
  Filter              CLI flag              What it matches
  ─────────────────── ───────────────────── ──────────────────────────────────
  inbox:inb_xxx       --inbox <id>          Conversations in inbox
  tag:tag_xxx         --tag <id>            Conversations with tag
  from:email          --from <email>        Sender address
  to:email            (inline only)         Recipient address
  cc:email            (inline only)         CC'd address
  bcc:email           (inline only)         BCC'd address
  recipient:email     (inline only)         Any role (from/to/cc/bcc)
  contact:crd_xxx     (inline only)         Contact ID in any role
  assignee:tea_xxx    --assignee <id>       Assigned teammate
  author:tea_xxx      (inline only)         Message author (teammate)
  participant:tea_xxx (inline only)         Any teammate involvement
  mention:tea_xxx     (inline only)         Mentioned teammate
  commenter:tea_xxx   (inline only)         Commenting teammate
  link:top_xxx        (inline only)         Linked topic
  is:<status>         --status <status>     Conversation status (see below)
  before:<unix_ts>    --before <timestamp>  Messages before timestamp
  after:<unix_ts>     --after <timestamp>   Messages after timestamp
  during:<unix_ts>    (inline only)         Messages on same day as timestamp
  custom_field:"K=V"  (inline only)         Custom field value

STATUS VALUES (is: filter / --status flag)
  open         In the Open tab (not archived, not trashed, not snoozed)
  archived     In the Archived tab
  assigned     Has an assignee (can combine: is:open is:assigned)
  unassigned   No assignee
  unreplied    Last message was inbound (no teammate reply yet)
  snoozed      Snoozed (will reopen later; API status shows "archived")
  trashed      In Trash
  waiting      Waiting for response

  Status combos:  is:open + is:unassigned = open & unassigned
                  is:archived + is:assigned = archived & assigned
  Conflicts:      open vs archived vs trashed vs snoozed are mutually exclusive
                  assigned vs unassigned are mutually exclusive

FILTER LOGIC
  All filters combine with AND (results must match every filter).
  Exception: multiple from/to/cc/bcc use OR within the same filter type.
    from:a@x.com from:b@x.com   →  from A OR from B
    from:a@x.com to:b@x.com     →  from A AND to B
  Max 15 filters per query.

EXAMPLES
  # Find unresolved payment issues in AI Hero inbox
  skill front search "payment failed" --inbox inb_4bj7r --status unassigned

  # Unreplied conversations from a specific sender
  skill front search "upgrade" --from user@example.com --status unreplied

  # Complex inline query (filters in the query string itself)
  skill front search "from:dale@a.com from:laura@a.com tag:tag_14nmdp before:1650364200"

  # All snoozed conversations assigned to a teammate
  skill front search "is:snoozed assignee:tea_2thf" --inbox inb_4bj7r

  # Search by custom field
  skill front search 'custom_field:"External ID=12345"'

  # Pipe JSON to jq for IDs only
  skill front search "is:unassigned" --inbox inb_4bj7r --json | jq '.data.conversations[].id'

  Full docs: https://dev.frontapp.com/docs/search-1
`
    )
    .action((query: string | undefined, options: SearchOptions) => {
      // Show help if no query and no filter flags provided
      const hasFilters =
        options.inbox ||
        options.tag ||
        options.assignee ||
        options.status ||
        options.from ||
        options.after ||
        options.before
      if (!query && !hasFilters) {
        searchCmd.help()
        return
      }
      return searchConversations(query || '', options)
    })
}
