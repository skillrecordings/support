/**
 * FAQ Clustering CLI Command
 *
 * Generates production clustering from Phase 0 artifacts.
 *
 * Usage:
 *   bun src/index.ts faq-cluster
 *   bun src/index.ts faq-cluster --version v2
 *   bun src/index.ts faq-cluster --dry-run
 */

import { existsSync } from 'fs'
import { join, resolve } from 'path'
import {
  displayClusteringSummary,
  generateProductionClustering,
  writeProductionArtifacts,
} from '@skillrecordings/core/faq/production-clusterer'
import type { Command } from 'commander'

/** Default paths relative to project root */
const PROJECT_ROOT = resolve(__dirname, '../../../..')
const DEFAULT_PHASE0_PATH = join(PROJECT_ROOT, 'artifacts/phase-0')
const DEFAULT_OUTPUT_PATH = join(PROJECT_ROOT, 'artifacts/phase-1/clustering')

/**
 * Validate paths exist
 */
function validatePaths(phase0Path: string): void {
  const assignmentsPath = join(phase0Path, 'clusters/v1/assignments.json')
  const labelsPath = join(phase0Path, 'clusters/v1/labels.json')
  const metricsPath = join(phase0Path, 'clusters/v1/metrics.json')

  if (!existsSync(assignmentsPath)) {
    throw new Error(
      `Phase 0 assignments not found at ${assignmentsPath}\n` +
        'Run Phase 0 clustering first or specify correct --phase0-path'
    )
  }
  if (!existsSync(labelsPath)) {
    throw new Error(`Phase 0 labels not found at ${labelsPath}`)
  }
  if (!existsSync(metricsPath)) {
    throw new Error(`Phase 0 metrics not found at ${metricsPath}`)
  }
}

/**
 * Main command handler
 */
async function faqCluster(options: {
  phase0Path?: string
  outputPath?: string
  version?: string
  dryRun?: boolean
  json?: boolean
}): Promise<void> {
  const phase0Path = options.phase0Path ?? DEFAULT_PHASE0_PATH
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH
  const version = options.version ?? 'v1'

  console.log('🔬 Production Clustering Pipeline')
  console.log('='.repeat(60))
  console.log(`   Phase 0 artifacts: ${phase0Path}`)
  console.log(`   Output path:       ${outputPath}`)
  console.log(`   Version:           ${version}`)
  console.log(`   Dry run:           ${options.dryRun ?? false}`)
  console.log('')

  try {
    // Validate Phase 0 artifacts exist
    validatePaths(phase0Path)
    console.log('✅ Phase 0 artifacts found')

    // Generate production clustering
    console.log('\n📊 Generating production clustering...')
    const result = await generateProductionClustering({
      phase0Path,
      outputPath,
      version,
    })

    // Display summary
    displayClusteringSummary(result)

    // Write artifacts (unless dry run)
    if (!options.dryRun) {
      console.log('\n📝 Writing artifacts...')
      writeProductionArtifacts(result, outputPath)
      console.log('\n✅ Production clustering complete!')
      console.log(`   Artifacts written to: ${join(outputPath, version)}`)
    } else {
      console.log('\n🧪 Dry run - no artifacts written')
    }

    // JSON output if requested
    if (options.json) {
      console.log('\n📋 JSON Output:')
      console.log(JSON.stringify(result.stats, null, 2))
    }
  } catch (error) {
    console.error(
      '\n❌ Error:',
      error instanceof Error ? error.message : String(error)
    )
    process.exit(1)
  }
}

/**
 * Register FAQ clustering commands with Commander
 */
export function registerFaqClusterCommands(program: Command): void {
  program
    .command('faq-cluster')
    .description('Generate production clustering from Phase 0 artifacts')
    .option(
      '--phase0-path <path>',
      'Path to Phase 0 artifacts',
      DEFAULT_PHASE0_PATH
    )
    .option(
      '--output-path <path>',
      'Path to write production artifacts',
      DEFAULT_OUTPUT_PATH
    )
    .option(
      '--version <version>',
      'Version tag for output (e.g., v1, v2)',
      'v1'
    )
    .option('-d, --dry-run', 'Show summary without writing artifacts')
    .option('--json', 'Output stats as JSON')
    .action(faqCluster)
}
