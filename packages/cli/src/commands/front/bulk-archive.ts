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
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
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
    throw new CLIError({
      userMessage: 'Invalid duration format.',
      suggestion: 'Use 30d (days), 24h (hours), or 60m (minutes).',
    })
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
      throw new CLIError({
        userMessage: `Unknown duration unit: ${unit}`,
        suggestion: 'Use d, h, or m (e.g., 30d, 24h, 60m).',
      })
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
  ctx: CommandContext,
  options: BulkArchiveOptions
): Promise<void> {
  const { inbox, dryRun = false } = options
  const outputJson = options.json === true || ctx.format === 'json'

  const frontToken = process.env.FRONT_API_TOKEN
  if (!frontToken) {
    throw new CLIError({
      userMessage: 'FRONT_API_TOKEN environment variable required.',
      suggestion: 'Set FRONT_API_TOKEN in your shell or .env.local.',
    })
  }

  const front = createInstrumentedFrontClient({ apiToken: frontToken })

  try {
    // If no inbox specified, list available inboxes
    if (!inbox) {
      ctx.output.data('Fetching available inboxes...\n')
      const inboxesData = (await front.raw.get('/inboxes')) as {
        _results: Array<{ id: string; name: string; address?: string }>
      }

      ctx.output.data('Available inboxes:')
      for (const ib of inboxesData._results || []) {
        ctx.output.data(
          `  ${ib.id}: ${ib.name} (${ib.address || 'no address'})`
        )
      }
      ctx.output.data(
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
      throw new CLIError({
        userMessage: 'At least one filter is required.',
        suggestion:
          'Use --sender, --subject, --status, --tag, or --older-than.',
      })
    }

    if (!outputJson) {
      ctx.output.data(`Fetching conversations from inbox ${inbox}...`)
      if (dryRun) {
        ctx.output.data('(DRY RUN - no changes will be made)\n')
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

      if (!outputJson) {
        ctx.output.progress(
          `Fetched ${allConversations.length} conversations from inbox`
        )
      }
    }

    if (!outputJson) {
      ctx.output.data(`\n  Total: ${allConversations.length} conversations`)
    }

    // Filter conversations
    if (!outputJson) {
      ctx.output.data('\nApplying filters...')
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
      if (!outputJson) {
        ctx.output.progress(
          `Checking ${processed}/${allConversations.length} conversations`
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

    if (!outputJson) {
      ctx.output.data(
        `\n\nFound ${result.matches.length} matching conversations`
      )
    }

    // If dry run, just show matches
    if (dryRun) {
      if (outputJson) {
        ctx.output.data(
          hateoasWrap({
            type: 'bulk-archive-result',
            command: `skill front bulk-archive --inbox ${inbox} --dry-run --json`,
            data: result,
          })
        )
      } else {
        ctx.output.data('\nMatching conversations:')
        ctx.output.data('-'.repeat(80))
        for (const match of result.matches) {
          ctx.output.data(`${match.id}: ${match.subject}`)
          ctx.output.data(`  Reason: ${match.reason}`)
        }
        ctx.output.data(
          `\nRun without --dry-run to archive ${result.matches.length} conversation(s)`
        )
      }
      return
    }

    // Archive each matching conversation
    if (result.matches.length === 0) {
      if (!outputJson) {
        ctx.output.data('\nNo conversations to archive.')
      } else {
        ctx.output.data(
          hateoasWrap({
            type: 'bulk-archive-result',
            command: `skill front bulk-archive --inbox ${inbox} --json`,
            data: result,
          })
        )
      }
      return
    }

    if (!outputJson) {
      ctx.output.data('\nArchiving conversations...')
    }

    let archiveCount = 0
    for (const match of result.matches) {
      archiveCount++
      if (!outputJson) {
        ctx.output.progress(
          `Archiving ${archiveCount}/${result.matches.length} conversations`
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
    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'bulk-archive-result',
          command: `skill front bulk-archive --inbox ${inbox} --json`,
          data: result,
        })
      )
    } else {
      ctx.output.data('\n\nBulk Archive Results:')
      ctx.output.data('-'.repeat(80))
      ctx.output.data(`Total conversations checked: ${result.total}`)
      ctx.output.data(`Matched: ${result.matches.length}`)
      ctx.output.data(`Archived: ${result.archived}`)
      ctx.output.data(`Failed: ${result.failed}`)

      if (result.failed > 0) {
        ctx.output.data('\nFailed conversations:')
        for (const match of result.matches.filter(
          (m) => m.status === 'failed'
        )) {
          ctx.output.data(`  ${match.id}: ${match.subject}`)
          ctx.output.data(`    Error: ${match.error}`)
        }
      }
      ctx.output.data('')
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to bulk archive Front conversations.',
            suggestion: 'Verify inbox ID, filters, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
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
    .action(async (options: BulkArchiveOptions, command: Command) => {
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
      await bulkArchiveConversations(ctx, options)
    })
}
