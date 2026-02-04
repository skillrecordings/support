/**
 * Bulk archive Front conversations matching criteria
 *
 * Usage:
 *   skill front bulk-archive --inbox <inbox-id> --sender "mailer-daemon"
 *   skill front bulk-archive --inbox <inbox-id> --subject "Daily Report"
 *   skill front bulk-archive --inbox <inbox-id> --status unassigned --older-than 30d
 *   skill front bulk-archive --inbox <inbox-id> --tag "spam"
 *   skill front bulk-archive ... --dry-run          # Preview without archiving
 *   skill front bulk-archive ... --json             # JSON output
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Command } from 'commander'
import { hateoasWrap } from './hateoas'

interface BulkArchiveOptions {
  inbox?: string
  sender?: string
  subject?: string
  status?: string
  tag?: string
  olderThan?: string
  dryRun?: boolean
  json?: boolean
}

interface FrontConversation {
  id: string
  subject: string
  status: string
  created_at: number
  last_message_at?: number
  tags: Array<{ id: string; name: string }>
  recipient?: { handle: string; name?: string }
  assignee?: { email: string }
}

interface FrontMessage {
  id: string
  type: string
  is_inbound: boolean
  created_at: number
  subject?: string
  body?: string
  text?: string
  author?: { email?: string; name?: string }
}

interface ArchiveResult {
  total: number
  archived: number
  failed: number
  matches: Array<{
    id: string
    subject: string
    reason: string
    status?: 'archived' | 'failed'
    error?: string
  }>
}

/**
 * Parse duration string (e.g., "30d", "7d", "24h") to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([dhm])$/)
  if (!match) {
    throw new Error(
      'Invalid duration format. Use: 30d (days), 24h (hours), 60m (minutes)'
    )
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  switch (unit) {
    case 'd':
      return value * 24 * 60 * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'm':
      return value * 60 * 1000
    default:
      throw new Error(`Unknown duration unit: ${unit}`)
  }
}

/**
 * Check if conversation matches filter criteria
 */
async function matchesFilters(
  front: ReturnType<typeof createInstrumentedFrontClient>,
  conv: FrontConversation,
  options: BulkArchiveOptions
): Promise<{ matches: boolean; reason: string }> {
  const reasons: string[] = []

  // Status filter
  if (options.status && conv.status !== options.status) {
    return { matches: false, reason: '' }
  }
  if (options.status) {
    reasons.push(`status:${options.status}`)
  }

  // Subject filter
  if (options.subject) {
    const subjectLower = (conv.subject || '').toLowerCase()
    const filterLower = options.subject.toLowerCase()
    if (!subjectLower.includes(filterLower)) {
      return { matches: false, reason: '' }
    }
    reasons.push(`subject contains "${options.subject}"`)
  }

  // Tag filter
  if (options.tag) {
    const hasTag = conv.tags.some((t) =>
      t.name.toLowerCase().includes(options.tag!.toLowerCase())
    )
    if (!hasTag) {
      return { matches: false, reason: '' }
    }
    reasons.push(`tag contains "${options.tag}"`)
  }

  // Sender filter (requires fetching messages)
  if (options.sender) {
    try {
      const messagesData = (await front.raw.get(
        `/conversations/${conv.id}/messages?limit=50`
      )) as { _results: FrontMessage[] }
      const messages = messagesData._results || []

      const hasSender = messages.some((m) => {
        const authorEmail = m.author?.email?.toLowerCase() || ''
        const filterLower = options.sender!.toLowerCase()
        return authorEmail.includes(filterLower)
      })

      if (!hasSender) {
        return { matches: false, reason: '' }
      }
      reasons.push(`sender contains "${options.sender}"`)
    } catch {
      // Skip if can't fetch messages
      return { matches: false, reason: '' }
    }
  }

  // Age filter
  if (options.olderThan) {
    const maxAge = parseDuration(options.olderThan)
    const age = Date.now() - conv.created_at * 1000
    if (age < maxAge) {
      return { matches: false, reason: '' }
    }
    const daysSince = Math.floor(age / (24 * 60 * 60 * 1000))
    reasons.push(`older than ${daysSince}d`)
  }

  return {
    matches: true,
    reason: reasons.length > 0 ? reasons.join(', ') : 'matches all criteria',
  }
}

export async function bulkArchiveConversations(
  options: BulkArchiveOptions
): Promise<void> {
  const { inbox, dryRun = false, json = false } = options

  const frontToken = process.env.FRONT_API_TOKEN
  if (!frontToken) {
    console.error('Error: FRONT_API_TOKEN environment variable required')
    process.exit(1)
  }

  const front = createInstrumentedFrontClient({ apiToken: frontToken })

  try {
    // If no inbox specified, list available inboxes
    if (!inbox) {
      console.log('Fetching available inboxes...\n')
      const inboxesData = (await front.raw.get('/inboxes')) as {
        _results: Array<{ id: string; name: string; address?: string }>
      }

      console.log('Available inboxes:')
      for (const ib of inboxesData._results || []) {
        console.log(`  ${ib.id}: ${ib.name} (${ib.address || 'no address'})`)
      }
      console.log(
        '\nUse --inbox <id> to bulk archive conversations from a specific inbox'
      )
      return
    }

    // Validate at least one filter is provided
    if (
      !options.sender &&
      !options.subject &&
      !options.status &&
      !options.tag &&
      !options.olderThan
    ) {
      console.error(
        'Error: At least one filter required (--sender, --subject, --status, --tag, --older-than)'
      )
      process.exit(1)
    }

    if (!json) {
      console.log(`Fetching conversations from inbox ${inbox}...`)
      if (dryRun) {
        console.log('(DRY RUN - no changes will be made)\n')
      }
    }

    // Fetch conversations from inbox (paginate)
    let allConversations: FrontConversation[] = []
    let nextUrl: string | null = `/inboxes/${inbox}/conversations?limit=50`

    while (nextUrl) {
      const data = (await front.raw.get(nextUrl)) as {
        _results: FrontConversation[]
        _pagination?: { next?: string }
      }

      allConversations = allConversations.concat(data._results || [])
      nextUrl = data._pagination?.next || null

      if (!json) {
        process.stdout.write(
          `\r  Fetched ${allConversations.length} conversations...`
        )
      }
    }

    if (!json) {
      console.log(`\n  Total: ${allConversations.length} conversations`)
    }

    // Filter conversations
    if (!json) {
      console.log('\nApplying filters...')
    }

    const result: ArchiveResult = {
      total: allConversations.length,
      archived: 0,
      failed: 0,
      matches: [],
    }

    let processed = 0
    for (const conv of allConversations) {
      processed++
      if (!json) {
        process.stdout.write(
          `\r  Checking ${processed}/${allConversations.length}...`
        )
      }

      const { matches, reason } = await matchesFilters(front, conv, options)
      if (!matches) continue

      result.matches.push({
        id: conv.id,
        subject: conv.subject || '(no subject)',
        reason,
      })

      // Rate limit
      await new Promise((r) => setTimeout(r, 100))
    }

    if (!json) {
      console.log(`\n\nFound ${result.matches.length} matching conversations`)
    }

    // If dry run, just show matches
    if (dryRun) {
      if (json) {
        console.log(
          JSON.stringify(
            hateoasWrap({
              type: 'bulk-archive-result',
              command: `skill front bulk-archive --inbox ${inbox} --dry-run --json`,
              data: result,
            }),
            null,
            2
          )
        )
      } else {
        console.log('\nMatching conversations:')
        console.log('-'.repeat(80))
        for (const match of result.matches) {
          console.log(`${match.id}: ${match.subject}`)
          console.log(`  Reason: ${match.reason}`)
        }
        console.log(
          `\nRun without --dry-run to archive ${result.matches.length} conversation(s)`
        )
      }
      return
    }

    // Archive each matching conversation
    if (result.matches.length === 0) {
      if (!json) {
        console.log('\nNo conversations to archive.')
      } else {
        console.log(
          JSON.stringify(
            hateoasWrap({
              type: 'bulk-archive-result',
              command: `skill front bulk-archive --inbox ${inbox} --json`,
              data: result,
            }),
            null,
            2
          )
        )
      }
      return
    }

    if (!json) {
      console.log('\nArchiving conversations...')
    }

    let archiveCount = 0
    for (const match of result.matches) {
      archiveCount++
      if (!json) {
        process.stdout.write(
          `\r  Archiving ${archiveCount}/${result.matches.length}...`
        )
      }

      try {
        await front.raw.patch(`/conversations/${match.id}`, {
          status: 'archived',
        })
        match.status = 'archived'
        result.archived++
      } catch (error) {
        match.status = 'failed'
        match.error = error instanceof Error ? error.message : 'Unknown error'
        result.failed++
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 150))
    }

    // Output results
    if (json) {
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'bulk-archive-result',
            command: `skill front bulk-archive --inbox ${inbox} --json`,
            data: result,
          }),
          null,
          2
        )
      )
    } else {
      console.log('\n\nBulk Archive Results:')
      console.log('-'.repeat(80))
      console.log(`Total conversations checked: ${result.total}`)
      console.log(`Matched: ${result.matches.length}`)
      console.log(`Archived: ${result.archived}`)
      console.log(`Failed: ${result.failed}`)

      if (result.failed > 0) {
        console.log('\nFailed conversations:')
        for (const match of result.matches.filter(
          (m) => m.status === 'failed'
        )) {
          console.log(`  ${match.id}: ${match.subject}`)
          console.log(`    Error: ${match.error}`)
        }
      }
      console.log('')
    }
  } catch (error) {
    if (json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        '\nError:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

export function registerBulkArchiveCommand(parent: Command): void {
  parent
    .command('bulk-archive')
    .description(
      'Bulk archive conversations matching filters (sender, tag, age)'
    )
    .option('-i, --inbox <id>', 'Inbox ID')
    .option('--sender <email>', 'Filter by sender email (contains)')
    .option('--subject <text>', 'Filter by subject (contains)')
    .option(
      '--status <status>',
      'Filter by status (e.g., unassigned, assigned, archived)'
    )
    .option('--tag <name>', 'Filter by tag name (contains)')
    .option(
      '--older-than <duration>',
      'Filter by age (e.g., 30d, 7d, 24h, 60m)'
    )
    .option('--dry-run', 'Preview without archiving')
    .option('--json', 'JSON output')
    .addHelpText(
      'after',
      `
━━━ Bulk Archive Conversations ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Archive conversations matching filter criteria from a specific inbox.
  Requires --inbox and at least one filter. Filters are AND-combined.
  Rate limiting is built in (100-150ms between API calls).

  ⚠️  ALWAYS use --dry-run first to preview what would be archived.

FILTER OPTIONS
  --sender <email>        Sender email (substring match, case-insensitive)
  --subject <text>        Subject line (substring match, case-insensitive)
  --status <status>       Conversation status (unassigned, assigned, archived)
  --tag <name>            Tag name (substring match, case-insensitive)
  --older-than <duration> Age filter — duration format: 30d, 7d, 24h, 60m

  Filters combine with AND: --status unassigned --older-than 30d means
  conversations that are BOTH unassigned AND older than 30 days.

DRY RUN (preview first!)
  skill front bulk-archive --inbox inb_4bj7r --sender "mailer-daemon" --dry-run

  Shows matching count + each conversation ID/subject/reason. No changes made.

EXECUTE (after verifying dry run)
  skill front bulk-archive --inbox inb_4bj7r --sender "mailer-daemon"

PRACTICAL EXAMPLES
  # Archive all noise from mailer-daemon
  skill front bulk-archive --inbox inb_4bj7r --sender "mailer-daemon" --dry-run
  skill front bulk-archive --inbox inb_4bj7r --sender "mailer-daemon"

  # Archive unassigned conversations older than 30 days
  skill front bulk-archive --inbox inb_4bj7r --status unassigned --older-than 30d --dry-run

  # Archive everything tagged "spam"
  skill front bulk-archive --inbox inb_4bj7r --tag "spam" --dry-run

  # Archive old daily report emails
  skill front bulk-archive --inbox inb_4bj7r --subject "Daily Report" --older-than 7d --dry-run

  # List available inboxes (omit --inbox)
  skill front bulk-archive

JSON OUTPUT (for scripting)
  skill front bulk-archive --inbox inb_4bj7r --status unassigned --dry-run --json

  # Count matches
  skill front bulk-archive ... --dry-run --json | jq '.data.matches | length'

  # Extract matched IDs
  skill front bulk-archive ... --dry-run --json | jq -r '.data.matches[].id'

RELATED COMMANDS
  skill front triage          Categorize conversations before archiving
  skill front archive         Archive specific conversations by ID
  skill front search          Find conversations by query / filters
`
    )
    .action(bulkArchiveConversations)
}
