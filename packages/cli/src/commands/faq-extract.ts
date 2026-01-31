/**
 * FAQ Extraction CLI Command
 *
 * Extracts FAQ candidates from clustered conversations.
 * Part of Phase 1.3 of the FAQ Mining pipeline.
 *
 * Usage:
 *   bun src/index.ts faq-extract
 *   bun src/index.ts faq-extract --app total-typescript --push-redis
 *   bun src/index.ts faq-extract --dry-run
 *   bun src/index.ts faq-extract --version v2
 */

import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { createDuckDBSource } from '@skillrecordings/core/faq/duckdb-source'
import {
  type ExtractionOptions,
  extractFaqCandidates,
} from '@skillrecordings/core/faq/extractor'
import { closeDb } from '@skillrecordings/database'
import type { Command } from 'commander'

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
function validatePaths(clusteringPath: string, goldenPath?: string): void {
  if (!existsSync(clusteringPath)) {
    throw new Error(
      `Clustering result not found at ${clusteringPath}\n` +
        'Run `bun src/index.ts faq-cluster` first to generate clustering.'
    )
  }

  if (goldenPath && !existsSync(goldenPath)) {
    console.warn(`⚠️  Golden responses not found at ${goldenPath}`)
    console.warn('   Golden matching will be disabled.')
  }
}

/**
 * Main command handler
 */
async function faqExtract(options: {
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
}): Promise<void> {
  const clusteringPath = options.clusteringPath ?? DEFAULT_CLUSTERING_PATH
  const goldenPath = options.goldenPath ?? DEFAULT_GOLDEN_PATH
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH
  const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH
  const version = options.outputVersion ?? 'v1'

  const applyFilters = options.filters ?? true

  console.log('🔬 FAQ Extraction Pipeline')
  console.log('='.repeat(60))
  console.log(`   Clustering:    ${clusteringPath}`)
  console.log(`   Golden:        ${goldenPath}`)
  console.log(`   Output:        ${outputPath}`)
  console.log(`   DuckDB cache:  ${cachePath}`)
  console.log(`   Version:       ${version}`)
  console.log(`   Apply filters: ${applyFilters}`)
  console.log(`   Push to Redis: ${options.pushRedis ?? false}`)
  console.log(`   Dry run:       ${options.dryRun ?? false}`)
  console.log('')

  // Validate paths
  validatePaths(clusteringPath, goldenPath)

  // Check DuckDB cache
  if (!existsSync(cachePath)) {
    throw new Error(
      `DuckDB cache not found at ${cachePath}\n` +
        'Run `bun src/index.ts front-cache sync` first to populate cache.'
    )
  }

  let source

  try {
    // Create DuckDB source
    console.log('📦 Connecting to DuckDB cache...')
    source = await createDuckDBSource({ dbPath: cachePath })

    // Get source stats
    const stats = await source.getStats?.()
    if (stats) {
      console.log(
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
    if (options.json) {
      console.log('\n📋 JSON Output:')
      console.log(JSON.stringify(result.stats, null, 2))
    }

    // Check acceptance criteria
    console.log('\n✅ Acceptance Criteria Check:')
    const highConfidence = result.stats.highConfidenceCount
    const target = 50

    if (highConfidence >= target) {
      console.log(
        `   ✅ ${highConfidence} candidates with confidence ≥ 0.7 (target: ${target})`
      )
    } else {
      console.log(
        `   ⚠️  Only ${highConfidence} candidates with confidence ≥ 0.7 (target: ${target})`
      )
      console.log(
        '   Consider lowering --min-cluster-size or --dedup-threshold'
      )
    }

    console.log(
      `   ✅ Golden match rate: ${(result.stats.goldenMatchRate * 100).toFixed(1)}%`
    )
    console.log(
      `   ✅ Deduplication working: ${result.stats.deduplicatedCount} removed`
    )

    if (!options.dryRun) {
      console.log(`\n✅ Extraction complete!`)
      console.log(`   Artifacts written to: ${join(outputPath, version)}`)

      if (options.pushRedis && options.app) {
        console.log(
          `   Candidates pushed to Redis queue: faq:pending:${options.app}`
        )
      }
    }
  } catch (error) {
    console.error(
      '\n❌ Error:',
      error instanceof Error ? error.message : String(error)
    )
    process.exit(1)
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
    .command('faq-extract')
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
    .action(faqExtract)
}
