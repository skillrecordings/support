/**
 * Triage command - categorize conversations as actionable vs noise
 *
 * Usage:
 *   skill front triage --inbox <inbox-id>
 *   skill front triage --inbox <inbox-id> --status unassigned
 *   skill front triage --inbox <inbox-id> --auto-archive
 *   skill front triage --inbox <inbox-id> --json
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Conversation, ConversationList } from '@skillrecordings/front-sdk'
import type { Command } from 'commander'
import { hateoasWrap, triageActions } from './hateoas'

interface TriageOptions {
  inbox: string
  status?: 'unassigned' | 'assigned' | 'archived'
  autoArchive?: boolean
  json?: boolean
}

type Category = 'actionable' | 'noise' | 'spam'

interface TriageResult {
  id: string
  subject: string
  senderEmail: string
  senderName?: string
  category: Category
  reason: string
  created_at: number
}

interface CategoryStats {
  actionable: number
  noise: number
  spam: number
}

/**
 * Get Front API client
 */
function getFrontClient() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createInstrumentedFrontClient({ apiToken })
}

/**
 * Categorize a conversation using heuristics
 */
function categorizeConversation(conversation: Conversation): {
  category: Category
  reason: string
} {
  const subject = (conversation.subject || '').toLowerCase()
  const senderEmail = conversation.recipient?.handle?.toLowerCase() || 'unknown'

  // Noise patterns (auto-generated emails)
  if (
    senderEmail.includes('mailer-daemon') ||
    senderEmail.includes('postmaster') ||
    senderEmail.includes('noreply') ||
    senderEmail.includes('no-reply')
  ) {
    return { category: 'noise', reason: 'System email address' }
  }

  if (senderEmail.includes('newsletter')) {
    return { category: 'noise', reason: 'Newsletter sender' }
  }

  if (
    subject.includes('delivery status') ||
    subject.includes('mail delivery failed') ||
    subject.includes('undelivered mail') ||
    subject.includes('returned mail')
  ) {
    return { category: 'noise', reason: 'Delivery failure notification' }
  }

  if (
    subject.includes('daily report') ||
    subject.includes('weekly report') ||
    subject.includes('monthly report')
  ) {
    return { category: 'noise', reason: 'Automated report' }
  }

  if (
    subject.includes('saml certificate') ||
    subject.includes('certificate expiring')
  ) {
    return { category: 'noise', reason: 'Certificate notification' }
  }

  if (
    subject.includes('automatic reply') ||
    subject.includes('out of office')
  ) {
    return { category: 'noise', reason: 'Auto-reply' }
  }

  // Spam patterns
  if (
    subject.includes('partnership') ||
    subject.includes('sponsorship') ||
    subject.includes('collaborate') ||
    subject.includes('collaboration opportunity')
  ) {
    return { category: 'spam', reason: 'Partnership pitch' }
  }

  if (
    subject.includes('guest post') ||
    subject.includes('link exchange') ||
    subject.includes('backlink')
  ) {
    return { category: 'spam', reason: 'SEO spam' }
  }

  if (
    subject.includes('promote your') ||
    subject.includes('marketing opportunity')
  ) {
    return { category: 'spam', reason: 'Marketing pitch' }
  }

  // Default: actionable
  return { category: 'actionable', reason: 'Real support issue' }
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
 * Main triage function
 */
export async function triageConversations(
  options: TriageOptions
): Promise<void> {
  const {
    inbox,
    status = 'unassigned',
    autoArchive = false,
    json = false,
  } = options

  try {
    const front = getFrontClient()

    if (!json) {
      console.log(`\nFetching ${status} conversations from inbox ${inbox}...`)
    }

    // Build query URL
    let queryUrl = `/inboxes/${inbox}/conversations?limit=50&q[statuses][]=${status}`

    // Fetch conversations
    const allConversations: Conversation[] = []
    let nextUrl: string | null = queryUrl

    while (nextUrl) {
      const data = (await front.raw.get(nextUrl)) as ConversationList
      allConversations.push(...(data._results || []))

      if (!json) {
        process.stdout.write(
          `\r  Fetched ${allConversations.length} conversations...`
        )
      }

      nextUrl = data._pagination?.next || null
    }

    if (!json) {
      console.log(`\n  Total: ${allConversations.length} conversations\n`)
    }

    // Categorize each conversation
    const results: TriageResult[] = []
    const stats: CategoryStats = { actionable: 0, noise: 0, spam: 0 }

    for (const conv of allConversations) {
      const { category, reason } = categorizeConversation(conv)
      stats[category]++

      results.push({
        id: conv.id,
        subject: conv.subject || '(no subject)',
        senderEmail: conv.recipient?.handle || 'unknown',
        senderName: conv.recipient?.name || undefined,
        category,
        reason,
        created_at: conv.created_at,
      })
    }

    // Output results
    if (json) {
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'triage-result',
            command: `skill front triage --inbox ${inbox} --json`,
            data: {
              total: allConversations.length,
              stats,
              results,
            },
            actions: triageActions(inbox),
          }),
          null,
          2
        )
      )
      return
    }

    // Human-readable output
    console.log('📊 Triage Results:')
    console.log('-'.repeat(80))
    console.log(
      `   Actionable: ${stats.actionable} (${Math.round((stats.actionable / allConversations.length) * 100)}%)`
    )
    console.log(
      `   Noise:      ${stats.noise} (${Math.round((stats.noise / allConversations.length) * 100)}%)`
    )
    console.log(
      `   Spam:       ${stats.spam} (${Math.round((stats.spam / allConversations.length) * 100)}%)`
    )
    console.log('-'.repeat(80))
    console.log('')

    // Show by category
    const byCategory: Record<Category, TriageResult[]> = {
      actionable: [],
      noise: [],
      spam: [],
    }

    for (const result of results) {
      byCategory[result.category].push(result)
    }

    // Show actionable first
    if (byCategory.actionable.length > 0) {
      console.log(`✅ ACTIONABLE (${byCategory.actionable.length}):`)
      for (const r of byCategory.actionable
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 10)) {
        console.log(`   ${r.id} - ${formatTimestamp(r.created_at)}`)
        console.log(`      From: ${r.senderEmail}`)
        console.log(`      Subject: ${r.subject}`)
        console.log(`      → ${r.reason}`)
        console.log('')
      }
      if (byCategory.actionable.length > 10) {
        console.log(`   ... and ${byCategory.actionable.length - 10} more\n`)
      }
    }

    // Show noise
    if (byCategory.noise.length > 0) {
      console.log(`🔇 NOISE (${byCategory.noise.length}):`)
      for (const r of byCategory.noise
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 5)) {
        console.log(`   ${r.id} - ${r.senderEmail} - ${r.subject.slice(0, 60)}`)
        console.log(`      → ${r.reason}`)
      }
      if (byCategory.noise.length > 5) {
        console.log(`   ... and ${byCategory.noise.length - 5} more\n`)
      }
    }

    // Show spam
    if (byCategory.spam.length > 0) {
      console.log(`🗑️  SPAM (${byCategory.spam.length}):`)
      for (const r of byCategory.spam
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 5)) {
        console.log(`   ${r.id} - ${r.senderEmail} - ${r.subject.slice(0, 60)}`)
        console.log(`      → ${r.reason}`)
      }
      if (byCategory.spam.length > 5) {
        console.log(`   ... and ${byCategory.spam.length - 5} more\n`)
      }
    }

    // Auto-archive if requested
    if (autoArchive) {
      const toArchive = [...byCategory.noise, ...byCategory.spam]
      if (toArchive.length === 0) {
        console.log('No noise or spam to archive.\n')
        return
      }

      console.log(`\n📦 Archiving ${toArchive.length} conversations...`)

      let archived = 0
      for (const r of toArchive) {
        try {
          await front.conversations.update(r.id, { status: 'archived' })
          archived++
          process.stdout.write(`\r  Archived ${archived}/${toArchive.length}`)
        } catch (err) {
          // Skip failures
          continue
        }
      }

      console.log(`\n✅ Archived ${archived} conversations\n`)
    } else if (byCategory.noise.length > 0 || byCategory.spam.length > 0) {
      console.log(
        `\n💡 Tip: Use --auto-archive to automatically archive noise/spam\n`
      )
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
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Register triage command
 */
export function registerTriageCommand(front: Command): void {
  front
    .command('triage')
    .description('Categorize inbox conversations as actionable, noise, or spam')
    .requiredOption('-i, --inbox <id>', 'Inbox ID to triage')
    .option(
      '-s, --status <status>',
      'Conversation status filter (unassigned, assigned, archived)',
      'unassigned'
    )
    .option('--auto-archive', 'Automatically archive noise and spam')
    .option('--json', 'JSON output')
    .addHelpText(
      'after',
      `
━━━ AI-Powered Triage ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Categorize inbox conversations into actionable, noise, or spam using
  heuristic rules. Optionally auto-archive the junk.

OPTIONS
  -i, --inbox <id>       (required) Inbox ID to triage (inb_xxx)
  -s, --status <status>  Conversation status to filter (default: unassigned)
                         Values: unassigned, assigned, archived
  --auto-archive         Archive all noise + spam conversations automatically
  --json                 Output as JSON (HATEOAS-wrapped)

CATEGORIZATION RULES
  Category      Signals
  ───────────── ──────────────────────────────────────────────────────────
  Noise         mailer-daemon, noreply, no-reply, postmaster, newsletter
                delivery failures, auto-replies, out-of-office,
                automated reports (daily/weekly/monthly), cert notifications
  Spam          partnership/sponsorship pitches, guest post / link exchange,
                backlink requests, marketing opportunities
  Actionable    Everything else (real support issues)

WORKFLOW
  1. Triage to see the breakdown:
     skill front triage --inbox inb_4bj7r

  2. Review categories in the output (actionable / noise / spam)

  3. If satisfied, auto-archive the junk:
     skill front triage --inbox inb_4bj7r --auto-archive

JSON + jq PATTERNS
  # Just the stats
  skill front triage --inbox inb_4bj7r --json | jq '.data.stats'

  # All noise conversation IDs
  skill front triage --inbox inb_4bj7r --json | jq '[.data.results[] | select(.category == "noise") | .id]'

  # Spam sender emails
  skill front triage --inbox inb_4bj7r --json | jq '[.data.results[] | select(.category == "spam") | .senderEmail]'

  # Actionable count
  skill front triage --inbox inb_4bj7r --json | jq '.data.stats.actionable'

EXAMPLES
  # Triage unassigned conversations (default)
  skill front triage --inbox inb_4bj7r

  # Triage assigned conversations
  skill front triage --inbox inb_4bj7r --status assigned

  # Triage and auto-archive noise + spam
  skill front triage --inbox inb_4bj7r --auto-archive

  # Pipe JSON for downstream processing
  skill front triage --inbox inb_4bj7r --json | jq '.data.results[] | select(.category == "actionable")'

RELATED COMMANDS
  skill front bulk-archive    Bulk-archive conversations by query
  skill front report          Inbox activity report
  skill front search          Search conversations with filters
`
    )
    .action(triageConversations)
}
