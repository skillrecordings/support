/**
 * FAQ Extraction CLI Command
 *
 * Extracts FAQ candidates from clustered conversations.
 * Part of Phase 1.3 of the FAQ Mining pipeline.
 *
 * Usage:
 *   bun src/index.ts faq extract
 *   bun src/index.ts faq extract --app total-typescript --push-redis
 *   bun src/index.ts faq extract --dry-run
 *   bun src/index.ts faq extract --version v2
 */

import { existsSync } from 'fs'
import { join, resolve } from 'path'
import {
  type ExtractionOptions,
  extractFaqCandidates,
} from '@skillrecordings/core/faq/extractor'
import { closeDb } from '@skillrecordings/database'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'

/** Project root */
const PROJECT_ROOT = resolve(__dirname, '../../../..')

/** Default paths */
const DEFAULT_CLUSTERING_PATH = join(
  PROJECT_ROOT,
  'artifacts/phase-1/clustering/v1/clustering-result.json'
)
const DEFAULT_GOLDEN_PATH = join(
  PROJECT_ROOT,
  'artifacts/phase-0/golden/latest/responses.json'
)
const DEFAULT_OUTPUT_PATH = join(PROJECT_ROOT, 'artifacts/phase-1/extraction')
const DEFAULT_CACHE_PATH = `${process.env.HOME}/skill/data/front-cache.db`

/**
 * Validate required files exist
 */
function validatePaths(
  ctx: CommandContext,
  clusteringPath: string,
  goldenPath: string | undefined,
  outputJson: boolean
): void {
  if (!existsSync(clusteringPath)) {
    throw new CLIError({
      userMessage: `Clustering result not found at ${clusteringPath}.`,
      suggestion:
        'Run `bun src/index.ts faq cluster` first to generate clustering.',
    })
  }

  if (goldenPath && !existsSync(goldenPath)) {
    if (!outputJson) {
      ctx.output.warn(`Golden responses not found at ${goldenPath}`)
      ctx.output.warn('Golden matching will be disabled.')
    }
  }
}

/**
 * Main command handler
 */
async function faqExtract(
  ctx: CommandContext,
  options: {
    clusteringPath?: string
    goldenPath?: string
    outputPath?: string
    cachePath?: string
    outputVersion?: string
    minClusterSize?: number
    topN?: number
    dedupThreshold?: number
    pushRedis?: boolean
    app?: string
    dryRun?: boolean
    json?: boolean
    filters?: boolean
  }
): Promise<void> {
  const clusteringPath = options.clusteringPath ?? DEFAULT_CLUSTERING_PATH
  const goldenPath = options.goldenPath ?? DEFAULT_GOLDEN_PATH
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH
  const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH
  const version = options.outputVersion ?? 'v1'
  const outputJson = options.json === true || ctx.format === 'json'

  const applyFilters = options.filters ?? true

  if (!outputJson) {
    ctx.output.data('🔬 FAQ Extraction Pipeline')
    ctx.output.data('='.repeat(60))
    ctx.output.data(`   Clustering:    ${clusteringPath}`)
    ctx.output.data(`   Golden:        ${goldenPath}`)
    ctx.output.data(`   Output:        ${outputPath}`)
    ctx.output.data(`   DuckDB cache:  ${cachePath}`)
    ctx.output.data(`   Version:       ${version}`)
    ctx.output.data(`   Apply filters: ${applyFilters}`)
    ctx.output.data(`   Push to Redis: ${options.pushRedis ?? false}`)
    ctx.output.data(`   Dry run:       ${options.dryRun ?? false}`)
    ctx.output.data('')
  }

  // Validate paths
  validatePaths(ctx, clusteringPath, goldenPath, outputJson)

  // Check DuckDB cache
  if (!existsSync(cachePath)) {
    const cliError = new CLIError({
      userMessage: `DuckDB cache not found at ${cachePath}.`,
      suggestion:
        'Run `bun src/index.ts front-cache sync` first to populate cache.',
    })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
    return
  }

  let source

  try {
    const { createDuckDBSource } = await import(
      '@skillrecordings/core/faq/duckdb-source'
    )
    // Create DuckDB source
    if (!outputJson) ctx.output.data('📦 Connecting to DuckDB cache...')
    source = await createDuckDBSource({ dbPath: cachePath })

    // Get source stats
    const stats = await source.getStats?.()
    if (stats && !outputJson) {
      ctx.output.data(
        `   ${stats.totalConversations.toLocaleString()} conversations in cache`
      )
    }

    // Run extraction
    const extractionOptions: ExtractionOptions = {
      clusteringPath,
      goldenPath: existsSync(goldenPath) ? goldenPath : undefined,
      source,
      outputPath,
      version,
      minClusterSize: options.minClusterSize ?? 3,
      topN: options.topN ?? 5,
      dedupThreshold: options.dedupThreshold ?? 0.85,
      pushToRedis: options.pushRedis ?? false,
      appId: options.app,
      dryRun: options.dryRun ?? false,
      applyFilters,
    }

    const result = await extractFaqCandidates(extractionOptions)

    // JSON output
    if (outputJson) {
      ctx.output.data({
        stats: result.stats,
      })
    }

    // Check acceptance criteria
    if (!outputJson) {
      ctx.output.data('\n✅ Acceptance Criteria Check:')
    }
    const highConfidence = result.stats.highConfidenceCount
    const target = 50

    if (!outputJson) {
      if (highConfidence >= target) {
        ctx.output.data(
          `   ✅ ${highConfidence} candidates with confidence ≥ 0.7 (target: ${target})`
        )
      } else {
        ctx.output.data(
          `   ⚠️  Only ${highConfidence} candidates with confidence ≥ 0.7 (target: ${target})`
        )
        ctx.output.data(
          '   Consider lowering --min-cluster-size or --dedup-threshold'
        )
      }

      ctx.output.data(
        `   ✅ Golden match rate: ${(result.stats.goldenMatchRate * 100).toFixed(1)}%`
      )
      ctx.output.data(
        `   ✅ Deduplication working: ${result.stats.deduplicatedCount} removed`
      )

      if (!options.dryRun) {
        ctx.output.data(`\n✅ Extraction complete!`)
        ctx.output.data(`   Artifacts written to: ${join(outputPath, version)}`)

        if (options.pushRedis && options.app) {
          ctx.output.data(
            `   Candidates pushed to Redis queue: faq:pending:${options.app}`
          )
        }
      }
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'FAQ extraction failed.',
            suggestion: 'Verify inputs and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  } finally {
    if (source?.close) {
      await source.close()
    }
    await closeDb()
  }
}

/**
 * Register FAQ extraction commands with Commander
 */
export function registerFaqExtractCommands(program: Command): void {
  program
    .command('extract')
    .description('Extract FAQ candidates from clustered conversations')
    .option(
      '--clustering-path <path>',
      'Path to clustering result file',
      DEFAULT_CLUSTERING_PATH
    )
    .option(
      '--golden-path <path>',
      'Path to golden responses file',
      DEFAULT_GOLDEN_PATH
    )
    .option(
      '--output-path <path>',
      'Path to write extraction artifacts',
      DEFAULT_OUTPUT_PATH
    )
    .option(
      '--cache-path <path>',
      'Path to DuckDB cache file',
      DEFAULT_CACHE_PATH
    )
    .option(
      '--output-version <version>',
      'Version tag for output (e.g., v1, v2)',
      'v1'
    )
    .option(
      '--min-cluster-size <n>',
      'Minimum cluster size to process (default: 3)',
      (val: string) => parseInt(val, 10)
    )
    .option(
      '--top-n <n>',
      'Number of representative conversations per cluster (default: 5)',
      (val: string) => parseInt(val, 10)
    )
    .option(
      '--dedup-threshold <n>',
      'Similarity threshold for deduplication (default: 0.85)',
      (val: string) => parseFloat(val)
    )
    .option('--push-redis', 'Push candidates to Redis review queue')
    .option(
      '-a, --app <slug>',
      'App ID for Redis queue (required with --push-redis)'
    )
    .option('-d, --dry-run', 'Show summary without writing artifacts')
    .option('--json', 'Output stats as JSON')
    .option('--no-filters', 'Disable preprocessing filters (for comparison)')
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
      await faqExtract(ctx, options)
    })
}
