/**
 * Generate forensics report for a Front inbox
 *
 * Usage:
 *   skill front report --inbox <inbox-id>
 *   skill front report --inbox <inbox-id> --days 60
 *   skill front report --inbox <inbox-id> --json
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Command } from 'commander'
import { hateoasWrap, reportActions, reportLinks } from './hateoas'
import { writeJsonOutput } from './json-output'

interface ReportOptions {
  inbox: string
  days?: number
  json?: boolean
}

interface FrontConversation {
  id: string
  subject: string
  status: 'archived' | 'unassigned' | 'assigned' | 'deleted' | 'snoozed'
  created_at: number
  assignee?: { email: string } | null
  tags: Array<{ id: string; name: string }>
  recipient?: { handle: string; name?: string } | null
}

interface Report {
  overview: {
    totalConversations: number
    byStatus: Record<string, number>
    dateRange: { from: string; to: string }
  }
  volumeByWeek: Array<{ week: string; count: number }>
  tagBreakdown: Record<string, number>
  unresolvedIssues: Array<{
    id: string
    subject: string
    customerEmail: string
    createdAt: string
    tags: string[]
  }>
  topSenders: Array<{ email: string; count: number }>
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().split('T')[0] ?? ''
}

function getWeekKey(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const startOfYear = new Date(date.getFullYear(), 0, 1)
  const days = Math.floor(
    (date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000)
  )
  const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7)
  return `${date.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`
}

export async function generateReport(options: ReportOptions): Promise<void> {
  const { inbox, days = 30, json = false } = options

  const frontToken = process.env.FRONT_API_TOKEN
  if (!frontToken) {
    console.error('Error: FRONT_API_TOKEN environment variable required')
    process.exit(1)
  }

  const front = createInstrumentedFrontClient({ apiToken: frontToken })

  try {
    if (!json) {
      console.log(`Generating report for inbox ${inbox}...`)
      console.log(`Date range: last ${days} days\n`)
    }

    // Calculate cutoff timestamp
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)
    const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000)

    // Fetch all conversations from inbox (paginated)
    let allConversations: FrontConversation[] = []
    let nextUrl: string | null = `/inboxes/${inbox}/conversations?limit=100`

    while (nextUrl) {
      const data = (await front.raw.get(nextUrl)) as {
        _results: FrontConversation[]
        _pagination?: { next?: string }
      }

      const results = data._results || []
      allConversations = allConversations.concat(results)

      // Break if we've gone past the cutoff date
      const oldestInBatch = Math.min(...results.map((c) => c.created_at))
      if (oldestInBatch < cutoffTimestamp) {
        break
      }

      nextUrl = data._pagination?.next || null

      if (!json) {
        process.stdout.write(
          `\r  Fetched ${allConversations.length} conversations...`
        )
      }
    }

    if (!json) {
      console.log(`\n  Total fetched: ${allConversations.length}`)
    }

    // Filter by date range
    const conversationsInRange = allConversations.filter(
      (c) => c.created_at >= cutoffTimestamp
    )

    if (!json) {
      console.log(`  In date range: ${conversationsInRange.length}`)
    }

    // Build report
    const report: Report = {
      overview: {
        totalConversations: conversationsInRange.length,
        byStatus: {},
        dateRange: {
          from: formatDate(cutoffTimestamp),
          to: formatDate(Math.floor(Date.now() / 1000)),
        },
      },
      volumeByWeek: [],
      tagBreakdown: {},
      unresolvedIssues: [],
      topSenders: [],
    }

    // Track data for aggregation
    const weekCounts: Record<string, number> = {}
    const senderCounts: Record<string, number> = {}

    // Process conversations
    for (const conv of conversationsInRange) {
      // Count by status
      report.overview.byStatus[conv.status] =
        (report.overview.byStatus[conv.status] || 0) + 1

      // Count by week
      const week = getWeekKey(conv.created_at)
      weekCounts[week] = (weekCounts[week] || 0) + 1

      // Count tags
      for (const tag of conv.tags) {
        report.tagBreakdown[tag.name] = (report.tagBreakdown[tag.name] || 0) + 1
      }

      // Track unassigned conversations
      if (conv.status === 'unassigned') {
        report.unresolvedIssues.push({
          id: conv.id,
          subject: conv.subject || '(no subject)',
          customerEmail: conv.recipient?.handle || 'unknown',
          createdAt: formatDate(conv.created_at),
          tags: conv.tags.map((t) => t.name),
        })
      }

      // Count senders
      const senderEmail = conv.recipient?.handle || 'unknown'
      senderCounts[senderEmail] = (senderCounts[senderEmail] || 0) + 1
    }

    // Sort and format volume by week
    report.volumeByWeek = Object.entries(weekCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, count]) => ({ week, count }))

    // Sort and format top senders
    report.topSenders = Object.entries(senderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([email, count]) => ({ email, count }))

    // Sort unresolved issues by created_at (newest first)
    report.unresolvedIssues.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    )

    // Output
    if (json) {
      const unresolvedIds = report.unresolvedIssues.map((i) => i.id)
      writeJsonOutput(
        hateoasWrap({
          type: 'report',
          command: `skill front report --inbox ${inbox} --json`,
          data: report,
          links: reportLinks(inbox, unresolvedIds),
          actions: reportActions(inbox),
        })
      )
    } else {
      printReport(report)
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

function printReport(report: Report): void {
  console.log('\n' + '='.repeat(80))
  console.log('INBOX FORENSICS REPORT')
  console.log('='.repeat(80))

  // Overview
  console.log('\n📊 OVERVIEW')
  console.log('-'.repeat(80))
  console.log(`  Total Conversations: ${report.overview.totalConversations}`)
  console.log(
    `  Date Range: ${report.overview.dateRange.from} to ${report.overview.dateRange.to}`
  )
  console.log('\n  By Status:')
  for (const [status, count] of Object.entries(report.overview.byStatus).sort(
    (a, b) => b[1] - a[1]
  )) {
    const pct = ((count / report.overview.totalConversations) * 100).toFixed(1)
    console.log(
      `    ${status.padEnd(12)}: ${count.toString().padStart(4)} (${pct}%)`
    )
  }

  // Volume by week
  console.log('\n📈 VOLUME BY WEEK')
  console.log('-'.repeat(80))
  for (const { week, count } of report.volumeByWeek) {
    const bar = '█'.repeat(Math.min(count, 50))
    console.log(`  ${week}: ${bar} ${count}`)
  }

  // Tag breakdown
  if (Object.keys(report.tagBreakdown).length > 0) {
    console.log('\n🏷️  TAG BREAKDOWN')
    console.log('-'.repeat(80))
    const sortedTags = Object.entries(report.tagBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
    for (const [tag, count] of sortedTags) {
      console.log(`  ${tag.padEnd(30)}: ${count}`)
    }
  }

  // Top senders
  if (report.topSenders.length > 0) {
    console.log('\n👥 TOP SENDERS')
    console.log('-'.repeat(80))
    for (const { email, count } of report.topSenders) {
      console.log(`  ${email.padEnd(40)}: ${count} conversations`)
    }
  }

  // Unresolved issues
  if (report.unresolvedIssues.length > 0) {
    console.log('\n⚠️  UNRESOLVED ISSUES (unassigned)')
    console.log('-'.repeat(80))
    console.log(`  Total: ${report.unresolvedIssues.length}`)
    console.log('\n  Most Recent:')
    for (const issue of report.unresolvedIssues.slice(0, 10)) {
      console.log(`    [${issue.createdAt}] ${issue.id}`)
      console.log(`      Subject: ${issue.subject}`)
      console.log(`      Customer: ${issue.customerEmail}`)
      if (issue.tags.length > 0) {
        console.log(`      Tags: ${issue.tags.join(', ')}`)
      }
      console.log('')
    }
    if (report.unresolvedIssues.length > 10) {
      console.log(
        `    ... and ${report.unresolvedIssues.length - 10} more unassigned`
      )
    }
  }

  console.log('\n' + '='.repeat(80))
}

export function registerReportCommand(front: Command): void {
  front
    .command('report')
    .description(
      'Generate a forensics report for an inbox (volume, tags, senders)'
    )
    .requiredOption('-i, --inbox <id>', 'Inbox ID to report on')
    .option(
      '-d, --days <n>',
      'Number of days to include in report',
      parseInt,
      30
    )
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
━━━ Inbox Forensics Report ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Generates a comprehensive report for a Front inbox covering the last N days.
  --inbox is required. --days defaults to 30.

WHAT THE REPORT INCLUDES
  - Overview: total conversations, status breakdown with percentages
  - Volume by week: bar chart of conversation volume per ISO week
  - Tag breakdown: top 15 tags by frequency
  - Top senders: top 10 sender email addresses
  - Unresolved issues: unassigned conversations (newest first, up to 10 shown)

BASIC USAGE
  skill front report --inbox inb_4bj7r
  skill front report --inbox inb_4bj7r --days 60
  skill front report --inbox inb_4bj7r --days 7

JSON OUTPUT (for scripting)
  skill front report --inbox inb_4bj7r --json

  # Extract unresolved issues
  skill front report --inbox inb_4bj7r --json | jq '.data.unresolvedIssues'

  # Top senders
  skill front report --inbox inb_4bj7r --json | jq '.data.topSenders'

  # Volume by week
  skill front report --inbox inb_4bj7r --json | jq '.data.volumeByWeek'

  # Status breakdown
  skill front report --inbox inb_4bj7r --json | jq '.data.overview.byStatus'

  # Count of unassigned conversations
  skill front report --inbox inb_4bj7r --json | jq '.data.unresolvedIssues | length'

  # Senders with more than 5 conversations
  skill front report --inbox inb_4bj7r --json \\
    | jq '[.data.topSenders[] | select(.count > 5)]'

WORKFLOW: REPORT → TRIAGE → ARCHIVE
  # 1. Run report to understand inbox state
  skill front report --inbox inb_4bj7r

  # 2. Triage to categorize conversations
  skill front triage --inbox inb_4bj7r

  # 3. Bulk archive the noise
  skill front bulk-archive --inbox inb_4bj7r --sender "noreply@" --dry-run

RELATED COMMANDS
  skill front triage          Categorize conversations by intent
  skill front inbox           List and inspect inboxes
  skill front bulk-archive    Archive conversations matching filters
`
    )
    .action(generateReport)
}
