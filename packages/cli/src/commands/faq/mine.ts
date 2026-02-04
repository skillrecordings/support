/**
 * FAQ Mining CLI Command
 *
 * Mines resolved support conversations for FAQ candidates.
 * Uses semantic clustering to identify recurring questions.
 *
 * Usage:
 *   skill faq mine --app total-typescript --since 30d
 *   skill faq mine --app epic-react --since 7d --unchanged-only
 *   skill faq mine --app total-typescript --since 90d --json
 *   skill faq mine --app epic-web --since 30d --export faq-candidates.json
 */

import { writeFileSync } from 'fs'
import {
  type FaqCandidate,
  type MineResult,
  filterAutoSurfaceCandidates,
  mineConversations,
  mineFaqCandidates,
} from '@skillrecordings/core/faq'
import type { DataSource } from '@skillrecordings/core/faq/types'
import { closeDb } from '@skillrecordings/database'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'

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
function displayResults(ctx: CommandContext, result: MineResult): void {
  ctx.output.data(`\n${COLORS.bold}📚 FAQ Mining Results${COLORS.reset}`)
  ctx.output.data('='.repeat(60))

  // Stats
  ctx.output.data(`\n${COLORS.cyan}Statistics:${COLORS.reset}`)
  ctx.output.data(`  Total conversations:   ${result.stats.totalConversations}`)
  ctx.output.data(
    `  Clustered:             ${result.stats.clusteredConversations}`
  )
  ctx.output.data(`  Clusters formed:       ${result.stats.clusterCount}`)
  ctx.output.data(`  FAQ candidates:        ${result.stats.candidateCount}`)
  ctx.output.data(
    `  Avg cluster size:      ${result.stats.averageClusterSize.toFixed(1)}`
  )
  ctx.output.data(
    `  ${COLORS.green}Avg unchanged rate:  ${(result.stats.averageUnchangedRate * 100).toFixed(1)}%${COLORS.reset}`
  )

  // Clusters
  if (result.clusters.length > 0) {
    ctx.output.data(`\n${COLORS.bold}📊 Clusters:${COLORS.reset}`)
    ctx.output.data('-'.repeat(60))

    for (const cluster of result.clusters.slice(0, 10)) {
      const unchangedPct = (cluster.unchangedRate * 100).toFixed(0)
      ctx.output.data(
        `\n${COLORS.cyan}Cluster ${cluster.id.slice(0, 8)}${COLORS.reset} (${cluster.conversations.length} convos, ${unchangedPct}% unchanged)`
      )
      ctx.output.data(
        `  ${COLORS.dim}Centroid: ${truncate(cluster.centroid, 150)}${COLORS.reset}`
      )
      ctx.output.data(
        `  ${COLORS.dim}Period: ${formatDate(cluster.oldest)} - ${formatDate(cluster.mostRecent)}${COLORS.reset}`
      )
    }

    if (result.clusters.length > 10) {
      ctx.output.data(
        `\n  ${COLORS.dim}... and ${result.clusters.length - 10} more clusters${COLORS.reset}`
      )
    }
  }

  // Top candidates
  if (result.candidates.length > 0) {
    ctx.output.data(`\n${COLORS.bold}🏆 Top FAQ Candidates:${COLORS.reset}`)
    ctx.output.data('-'.repeat(60))

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

    ctx.output.data(`${COLORS.dim}${label}${COLORS.reset}\n`)

    for (const [i, candidate] of displayCandidates.entries()) {
      if (!candidate) continue

      const confPct = (candidate.confidence * 100).toFixed(0)
      const unchangedPct = (candidate.unchangedRate * 100).toFixed(0)

      ctx.output.data(
        `${COLORS.bold}#${i + 1}${COLORS.reset} ${COLORS.dim}Confidence: ${confPct}% | ${candidate.clusterSize} occurrences | ${unchangedPct}% unchanged${COLORS.reset}`
      )
      ctx.output.data(
        `  ${COLORS.bold}Q:${COLORS.reset} ${truncate(candidate.question, 200)}`
      )
      ctx.output.data(
        `  ${COLORS.green}A:${COLORS.reset} ${truncate(candidate.answer, 300)}`
      )
      if (candidate.suggestedCategory) {
        ctx.output.data(
          `  ${COLORS.cyan}Category: ${candidate.suggestedCategory}${COLORS.reset}`
        )
      }
      if (candidate.tags.length > 0) {
        ctx.output.data(
          `  ${COLORS.dim}Tags: ${candidate.tags.slice(0, 5).join(', ')}${COLORS.reset}`
        )
      }
      ctx.output.data('')
    }
  }

  ctx.output.data('')
}

/** Default DuckDB cache path */
const DEFAULT_CACHE_PATH = `${process.env.HOME}/skill/data/front-cache.db`

/**
 * Create data source based on --source flag.
 */
async function createSource(
  ctx: CommandContext,
  sourceType: 'cache' | 'front' | undefined,
  cachePath?: string,
  outputJson?: boolean
): Promise<DataSource | undefined> {
  if (sourceType === 'cache') {
    const dbPath = cachePath ?? DEFAULT_CACHE_PATH
    if (!outputJson) ctx.output.data(`📦 Using DuckDB cache: ${dbPath}`)
    const { createDuckDBSource } = await import(
      '@skillrecordings/core/faq/duckdb-source'
    )
    return createDuckDBSource({ dbPath })
  }

  // Default to Front API (undefined means use existing behavior)
  return undefined
}

/**
 * Main command handler
 */
async function faqMine(
  ctx: CommandContext,
  options: {
    app: string
    since: string
    limit?: number
    unchangedOnly?: boolean
    clusterThreshold?: number
    json?: boolean
    export?: string
    raw?: boolean
    source?: 'cache' | 'front'
    cachePath?: string
    dryRun?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  if (!options.app) {
    const cliError = new CLIError({
      userMessage: 'App slug is required.',
      suggestion: 'Provide --app <slug>.',
    })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
    return
  }

  if (!options.since) {
    const cliError = new CLIError({
      userMessage: 'Time window is required.',
      suggestion: 'Provide --since <duration> (e.g., 30d).',
    })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
    return
  }

  let source: DataSource | undefined

  try {
    // Create data source
    source = await createSource(
      ctx,
      options.source ?? 'cache',
      options.cachePath,
      outputJson
    )
    // Dry run mode: show stats and sample data
    if (options.dryRun) {
      if (!outputJson) {
        ctx.output.data(`\n🧪 DRY RUN MODE - ${options.app}`)
        ctx.output.data(`   Source: ${source?.name ?? 'front'}`)
        ctx.output.data(`   Since: ${options.since}`)
        ctx.output.data(`   Limit: ${options.limit ?? 500}`)
      }

      if (source?.getStats) {
        const stats = await source.getStats()
        if (!outputJson) {
          ctx.output.data(`\n📊 Cache Statistics:`)
          ctx.output.data(
            `   Total conversations: ${stats.totalConversations.toLocaleString()}`
          )
          ctx.output.data(
            `   Filtered (matching criteria): ${stats.filteredConversations.toLocaleString()}`
          )
          ctx.output.data(
            `   Total messages: ${stats.totalMessages.toLocaleString()}`
          )
          ctx.output.data(`   Inboxes: ${stats.inboxCount}`)
          if (stats.dateRange.oldest && stats.dateRange.newest) {
            ctx.output.data(
              `   Date range: ${stats.dateRange.oldest.toLocaleDateString()} - ${stats.dateRange.newest.toLocaleDateString()}`
            )
          }
        }
      }

      // Fetch a small sample
      if (!outputJson) {
        ctx.output.data(`\n📝 Sample conversations (limit 5):`)
      }
      const sample = await mineConversations({
        appId: options.app,
        since: options.since,
        limit: 5,
        unchangedOnly: options.unchangedOnly ?? false,
        source,
      })

      for (const conv of sample) {
        if (outputJson) {
          continue
        }
        ctx.output.data(`\n   [${conv.conversationId}]`)
        ctx.output.data(`   Q: ${truncate(conv.question, 100)}`)
        ctx.output.data(`   A: ${truncate(conv.answer, 100)}`)
        ctx.output.data(`   Tags: ${conv.tags.slice(0, 5).join(', ')}`)
      }

      if (outputJson) {
        ctx.output.data({
          dryRun: true,
          sample: sample.map((conv) => ({
            conversationId: conv.conversationId,
            question: truncate(conv.question, 100),
            answer: truncate(conv.answer, 100),
            tags: conv.tags.slice(0, 5),
          })),
        })
      } else {
        ctx.output.data(
          `\n✅ Dry run complete. ${sample.length} sample conversations loaded.`
        )
      }
      return
    }

    // Raw mode: just export Q&A pairs without clustering
    if (options.raw) {
      if (!outputJson) {
        ctx.output.data(`📚 Mining raw Q&A pairs for ${options.app}...`)
        ctx.output.data(`   Source: ${source?.name ?? 'front'}`)
        ctx.output.data(`   Since: ${options.since}`)
        ctx.output.data(`   Unchanged only: ${options.unchangedOnly ?? false}`)
      }

      const conversations = await mineConversations({
        appId: options.app,
        since: options.since,
        limit: options.limit ?? 500,
        unchangedOnly: options.unchangedOnly ?? false,
        source,
      })

      const rawData = {
        generatedAt: new Date().toISOString(),
        options: {
          appId: options.app,
          since: options.since,
          unchangedOnly: options.unchangedOnly ?? false,
        },
        stats: {
          total: conversations.length,
        },
        conversations: conversations.map((c) => ({
          conversationId: c.conversationId,
          question: c.question,
          answer: c.answer,
          subject: c.subject,
          tags: c.tags,
          wasUnchanged: c.wasUnchanged,
          resolvedAt: c.resolvedAt.toISOString(),
        })),
      }

      if (options.export) {
        writeFileSync(options.export, JSON.stringify(rawData, null, 2), 'utf-8')
        if (outputJson) {
          ctx.output.data({
            success: true,
            exportPath: options.export,
            count: conversations.length,
          })
        } else {
          ctx.output.data(
            `\n✅ Exported ${conversations.length} raw Q&A pairs to ${options.export}`
          )
        }
      } else {
        ctx.output.data(rawData)
      }

      return
    }

    const result = await mineFaqCandidates({
      appId: options.app,
      since: options.since,
      limit: options.limit ?? 500,
      unchangedOnly: options.unchangedOnly ?? false,
      clusterThreshold: options.clusterThreshold,
      source,
    })

    // JSON output
    if (outputJson) {
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
      ctx.output.data(jsonResult)
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
      ctx.output.data(
        `\n✅ Exported ${result.candidates.length} FAQ candidates to ${options.export}`
      )
      return
    }

    // Human-readable output
    displayResults(ctx, result)
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'FAQ mining failed.',
            suggestion: 'Verify inputs and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  } finally {
    // Close data source if needed
    if (source?.close) {
      await source.close()
    }
    await closeDb()
  }
}

/**
 * Register FAQ mining commands with Commander
 */
export function registerFaqMineCommands(program: Command): void {
  program
    .command('mine')
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
    .option('-r, --raw', 'Export raw Q&A pairs without clustering (faster)')
    .option(
      '--source <type>',
      'Data source: cache (DuckDB, default) or front (live API)',
      'cache'
    )
    .option('--cache-path <path>', 'Path to DuckDB cache file')
    .option('-d, --dry-run', 'Show stats and sample data without full mining')
    .action(async (options, command) => {
      const globalOpts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: globalOpts.format,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
      })
      await faqMine(ctx, options)
    })
}
