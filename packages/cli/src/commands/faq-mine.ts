/**
 * FAQ Mining CLI Command
 *
 * Mines resolved support conversations for FAQ candidates.
 * Uses semantic clustering to identify recurring questions.
 *
 * Usage:
 *   skill faq-mine --app total-typescript --since 30d
 *   skill faq-mine --app epic-react --since 7d --unchanged-only
 *   skill faq-mine --app total-typescript --since 90d --json
 *   skill faq-mine --app epic-web --since 30d --export faq-candidates.json
 */

import { writeFileSync } from 'fs'
import {
  type FaqCandidate,
  type MineResult,
  filterAutoSurfaceCandidates,
  mineFaqCandidates,
} from '@skillrecordings/core/faq'
import { closeDb } from '@skillrecordings/database'
import type { Command } from 'commander'

/**
 * Format timestamp for display
 */
function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
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
  if (!str) return ''
  if (str.length <= len) return str
  return str.slice(0, len - 3) + '...'
}

/**
 * Color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
} as const

/**
 * Display human-readable mining results
 */
function displayResults(result: MineResult): void {
  console.log(`\n${COLORS.bold}📚 FAQ Mining Results${COLORS.reset}`)
  console.log('='.repeat(60))

  // Stats
  console.log(`\n${COLORS.cyan}Statistics:${COLORS.reset}`)
  console.log(`  Total conversations:   ${result.stats.totalConversations}`)
  console.log(`  Clustered:             ${result.stats.clusteredConversations}`)
  console.log(`  Clusters formed:       ${result.stats.clusterCount}`)
  console.log(`  FAQ candidates:        ${result.stats.candidateCount}`)
  console.log(
    `  Avg cluster size:      ${result.stats.averageClusterSize.toFixed(1)}`
  )
  console.log(
    `  ${COLORS.green}Avg unchanged rate:  ${(result.stats.averageUnchangedRate * 100).toFixed(1)}%${COLORS.reset}`
  )

  // Clusters
  if (result.clusters.length > 0) {
    console.log(`\n${COLORS.bold}📊 Clusters:${COLORS.reset}`)
    console.log('-'.repeat(60))

    for (const cluster of result.clusters.slice(0, 10)) {
      const unchangedPct = (cluster.unchangedRate * 100).toFixed(0)
      console.log(
        `\n${COLORS.cyan}Cluster ${cluster.id.slice(0, 8)}${COLORS.reset} (${cluster.conversations.length} convos, ${unchangedPct}% unchanged)`
      )
      console.log(
        `  ${COLORS.dim}Centroid: ${truncate(cluster.centroid, 150)}${COLORS.reset}`
      )
      console.log(
        `  ${COLORS.dim}Period: ${formatDate(cluster.oldest)} - ${formatDate(cluster.mostRecent)}${COLORS.reset}`
      )
    }

    if (result.clusters.length > 10) {
      console.log(
        `\n  ${COLORS.dim}... and ${result.clusters.length - 10} more clusters${COLORS.reset}`
      )
    }
  }

  // Top candidates
  if (result.candidates.length > 0) {
    console.log(`\n${COLORS.bold}🏆 Top FAQ Candidates:${COLORS.reset}`)
    console.log('-'.repeat(60))

    // Filter to auto-surface candidates
    const autoSurface = filterAutoSurfaceCandidates(result.candidates)

    const displayCandidates =
      autoSurface.length > 0
        ? autoSurface.slice(0, 10)
        : result.candidates.slice(0, 10)

    const label =
      autoSurface.length > 0
        ? `(${autoSurface.length} auto-surface ready)`
        : '(no auto-surface candidates)'

    console.log(`${COLORS.dim}${label}${COLORS.reset}\n`)

    for (const [i, candidate] of displayCandidates.entries()) {
      if (!candidate) continue

      const confPct = (candidate.confidence * 100).toFixed(0)
      const unchangedPct = (candidate.unchangedRate * 100).toFixed(0)

      console.log(
        `${COLORS.bold}#${i + 1}${COLORS.reset} ${COLORS.dim}Confidence: ${confPct}% | ${candidate.clusterSize} occurrences | ${unchangedPct}% unchanged${COLORS.reset}`
      )
      console.log(
        `  ${COLORS.bold}Q:${COLORS.reset} ${truncate(candidate.question, 200)}`
      )
      console.log(
        `  ${COLORS.green}A:${COLORS.reset} ${truncate(candidate.answer, 300)}`
      )
      if (candidate.suggestedCategory) {
        console.log(
          `  ${COLORS.cyan}Category: ${candidate.suggestedCategory}${COLORS.reset}`
        )
      }
      if (candidate.tags.length > 0) {
        console.log(
          `  ${COLORS.dim}Tags: ${candidate.tags.slice(0, 5).join(', ')}${COLORS.reset}`
        )
      }
      console.log('')
    }
  }

  console.log('')
}

/**
 * Main command handler
 */
async function faqMine(options: {
  app: string
  since: string
  limit?: number
  unchangedOnly?: boolean
  clusterThreshold?: number
  json?: boolean
  export?: string
}): Promise<void> {
  if (!options.app) {
    console.error('Error: --app is required')
    process.exit(1)
  }

  if (!options.since) {
    console.error('Error: --since is required (e.g., 30d, 7d, 90d)')
    process.exit(1)
  }

  try {
    const result = await mineFaqCandidates({
      appId: options.app,
      since: options.since,
      limit: options.limit ?? 500,
      unchangedOnly: options.unchangedOnly ?? false,
      clusterThreshold: options.clusterThreshold,
    })

    // JSON output
    if (options.json) {
      // Convert dates to ISO strings for JSON
      const jsonResult = {
        ...result,
        conversations: result.conversations.map((c) => ({
          ...c,
          resolvedAt: c.resolvedAt.toISOString(),
          _raw: undefined, // Don't include raw data in JSON
        })),
        clusters: result.clusters.map((c) => ({
          ...c,
          mostRecent: c.mostRecent.toISOString(),
          oldest: c.oldest.toISOString(),
          conversations: c.conversations.map((conv) => ({
            conversationId: conv.conversationId,
            question: conv.question.slice(0, 200),
            wasUnchanged: conv.wasUnchanged,
          })),
        })),
        candidates: result.candidates.map((c) => ({
          ...c,
          generatedAt: c.generatedAt.toISOString(),
        })),
      }
      console.log(JSON.stringify(jsonResult, null, 2))
      return
    }

    // Export to file
    if (options.export) {
      const exportData = {
        generatedAt: new Date().toISOString(),
        options: {
          appId: options.app,
          since: options.since,
          unchangedOnly: options.unchangedOnly,
        },
        stats: result.stats,
        candidates: result.candidates.map((c) => ({
          id: c.id,
          question: c.question,
          answer: c.answer,
          clusterSize: c.clusterSize,
          unchangedRate: c.unchangedRate,
          confidence: c.confidence,
          suggestedCategory: c.suggestedCategory,
          tags: c.tags,
          generatedAt: c.generatedAt.toISOString(),
        })),
      }
      writeFileSync(
        options.export,
        JSON.stringify(exportData, null, 2),
        'utf-8'
      )
      console.log(
        `\n✅ Exported ${result.candidates.length} FAQ candidates to ${options.export}`
      )
      return
    }

    // Human-readable output
    displayResults(result)
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : String(error)
    )
    process.exit(1)
  } finally {
    await closeDb()
  }
}

/**
 * Register FAQ mining commands with Commander
 */
export function registerFaqMineCommands(program: Command): void {
  program
    .command('faq-mine')
    .description('Mine FAQ candidates from resolved support conversations')
    .requiredOption('-a, --app <slug>', 'App slug to mine from (required)')
    .requiredOption(
      '-s, --since <duration>',
      'Time window to mine (e.g., 30d, 7d, 90d)'
    )
    .option(
      '-l, --limit <n>',
      'Maximum conversations to process (default: 500)',
      parseInt
    )
    .option(
      '-u, --unchanged-only',
      'Only include conversations where draft was sent unchanged'
    )
    .option(
      '--cluster-threshold <n>',
      'Similarity threshold for clustering (default: 0.75)',
      parseFloat
    )
    .option('--json', 'Output as JSON')
    .option('-e, --export <file>', 'Export candidates to file')
    .action(faqMine)
}
