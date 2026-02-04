/**
 * Generate forensics report for a Front inbox
 *
 * Usage:
 *   skill front report --inbox <inbox-id>
 *   skill front report --inbox <inbox-id> --days 60
 *   skill front report --inbox <inbox-id> --json
 */

import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getFrontClient } from './client'
import { hateoasWrap, reportActions, reportLinks } from './hateoas'

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
  unresolved_ids: string[]
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

export async function generateReport(
  ctx: CommandContext,
  options: ReportOptions
): Promise<void> {
  const { inbox, days = 30 } = options
  const outputJson = options.json === true || ctx.format === 'json'

  const front = getFrontClient()

  try {
    if (!outputJson) {
      ctx.output.data(`Generating report for inbox ${inbox}...`)
      ctx.output.data(`Date range: last ${days} days\n`)
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

      if (!outputJson) {
        ctx.output.progress(
          `Fetched ${allConversations.length} conversations for report`
        )
      }
    }

    if (!outputJson) {
      ctx.output.data(`\n  Total fetched: ${allConversations.length}`)
    }

    // Filter by date range
    const conversationsInRange = allConversations.filter(
      (c) => c.created_at >= cutoffTimestamp
    )

    if (!outputJson) {
      ctx.output.data(`  In date range: ${conversationsInRange.length}`)
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
      unresolved_ids: [],
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
    report.unresolved_ids = report.unresolvedIssues.map((issue) => issue.id)

    // Output
    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'report',
          command: `skill front report --inbox ${inbox} --json`,
          data: report,
          links: reportLinks(inbox, report.unresolved_ids),
          actions: reportActions(inbox),
        })
      )
    } else {
      printReport(ctx, report)
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to generate Front inbox report.',
            suggestion: 'Verify inbox ID and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

function printReport(ctx: CommandContext, report: Report): void {
  ctx.output.data('\n' + '='.repeat(80))
  ctx.output.data('INBOX FORENSICS REPORT')
  ctx.output.data('='.repeat(80))

  // Overview
  ctx.output.data('\n📊 OVERVIEW')
  ctx.output.data('-'.repeat(80))
  ctx.output.data(
    `  Total Conversations: ${report.overview.totalConversations}`
  )
  ctx.output.data(
    `  Date Range: ${report.overview.dateRange.from} to ${report.overview.dateRange.to}`
  )
  ctx.output.data('\n  By Status:')
  for (const [status, count] of Object.entries(report.overview.byStatus).sort(
    (a, b) => b[1] - a[1]
  )) {
    const pct = ((count / report.overview.totalConversations) * 100).toFixed(1)
    ctx.output.data(
      `    ${status.padEnd(12)}: ${count.toString().padStart(4)} (${pct}%)`
    )
  }

  // Volume by week
  ctx.output.data('\n📈 VOLUME BY WEEK')
  ctx.output.data('-'.repeat(80))
  for (const { week, count } of report.volumeByWeek) {
    const bar = '█'.repeat(Math.min(count, 50))
    ctx.output.data(`  ${week}: ${bar} ${count}`)
  }

  // Tag breakdown
  if (Object.keys(report.tagBreakdown).length > 0) {
    ctx.output.data('\n🏷️  TAG BREAKDOWN')
    ctx.output.data('-'.repeat(80))
    const sortedTags = Object.entries(report.tagBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
    for (const [tag, count] of sortedTags) {
      ctx.output.data(`  ${tag.padEnd(30)}: ${count}`)
    }
  }

  // Top senders
  if (report.topSenders.length > 0) {
    ctx.output.data('\n👥 TOP SENDERS')
    ctx.output.data('-'.repeat(80))
    for (const { email, count } of report.topSenders) {
      ctx.output.data(`  ${email.padEnd(40)}: ${count} conversations`)
    }
  }

  // Unresolved issues
  if (report.unresolvedIssues.length > 0) {
    ctx.output.data('\n⚠️  UNRESOLVED ISSUES (unassigned)')
    ctx.output.data('-'.repeat(80))
    ctx.output.data(`  Total: ${report.unresolvedIssues.length}`)
    ctx.output.data('\n  Most Recent:')
    for (const issue of report.unresolvedIssues.slice(0, 10)) {
      ctx.output.data(`    [${issue.createdAt}] ${issue.id}`)
      ctx.output.data(`      Subject: ${issue.subject}`)
      ctx.output.data(`      Customer: ${issue.customerEmail}`)
      if (issue.tags.length > 0) {
        ctx.output.data(`      Tags: ${issue.tags.join(', ')}`)
      }
      ctx.output.data('')
    }
    if (report.unresolvedIssues.length > 10) {
      ctx.output.data(
        `    ... and ${report.unresolvedIssues.length - 10} more unassigned`
      )
    }
  }

  ctx.output.data('\n' + '='.repeat(80))
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
    .action(async (options: ReportOptions, command: Command) => {
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
      await generateReport(ctx, options)
    })
}
