/**
 * FAQ Clustering CLI Command
 *
 * Generates production clustering from Phase 0 artifacts.
 *
 * Usage:
 *   bun src/index.ts faq cluster
 *   bun src/index.ts faq cluster --version v2
 *   bun src/index.ts faq cluster --dry-run
 */

import { existsSync } from 'fs'
import { join, resolve } from 'path'
import {
  displayClusteringSummary,
  generateProductionClustering,
  writeProductionArtifacts,
} from '@skillrecordings/core/faq/production-clusterer'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'

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
    throw new CLIError({
      userMessage: `Phase 0 assignments not found at ${assignmentsPath}.`,
      suggestion:
        'Run Phase 0 clustering first or specify the correct --phase0-path.',
    })
  }
  if (!existsSync(labelsPath)) {
    throw new CLIError({
      userMessage: `Phase 0 labels not found at ${labelsPath}.`,
      suggestion: 'Verify the --phase0-path points to valid artifacts.',
    })
  }
  if (!existsSync(metricsPath)) {
    throw new CLIError({
      userMessage: `Phase 0 metrics not found at ${metricsPath}.`,
      suggestion: 'Verify the --phase0-path points to valid artifacts.',
    })
  }
}

/**
 * Main command handler
 */
export async function faqCluster(
  ctx: CommandContext,
  options: {
    phase0Path?: string
    outputPath?: string
    version?: string
    dryRun?: boolean
    json?: boolean
  }
): Promise<void> {
  const phase0Path = options.phase0Path ?? DEFAULT_PHASE0_PATH
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH
  const version = options.version ?? 'v1'
  const outputJson = options.json === true || ctx.format === 'json'

  if (!outputJson) {
    ctx.output.data('🔬 Production Clustering Pipeline')
    ctx.output.data('='.repeat(60))
    ctx.output.data(`   Phase 0 artifacts: ${phase0Path}`)
    ctx.output.data(`   Output path:       ${outputPath}`)
    ctx.output.data(`   Version:           ${version}`)
    ctx.output.data(`   Dry run:           ${options.dryRun ?? false}`)
    ctx.output.data('')
  }

  try {
    // Validate Phase 0 artifacts exist
    validatePaths(phase0Path)
    if (!outputJson) ctx.output.data('✅ Phase 0 artifacts found')

    // Generate production clustering
    if (!outputJson) ctx.output.data('\n📊 Generating production clustering...')
    const result = await generateProductionClustering({
      phase0Path,
      outputPath,
      version,
    })

    // Display summary
    if (!outputJson) {
      displayClusteringSummary(result)
    }

    // Write artifacts (unless dry run)
    if (!options.dryRun) {
      if (!outputJson) ctx.output.data('\n📝 Writing artifacts...')
      writeProductionArtifacts(result, outputPath)
      if (!outputJson) {
        ctx.output.data('\n✅ Production clustering complete!')
        ctx.output.data(`   Artifacts written to: ${join(outputPath, version)}`)
      }
    } else {
      if (!outputJson) ctx.output.data('\n🧪 Dry run - no artifacts written')
    }

    // JSON output if requested
    if (outputJson) {
      ctx.output.data(result.stats)
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'FAQ clustering failed.',
            suggestion: 'Verify Phase 0 artifacts and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Register FAQ clustering commands with Commander
 */
export function registerFaqClusterCommands(program: Command): void {
  program
    .command('cluster')
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
    .action(async (options, command) => {
      const ctx = await createContext({
        format:
          options.json === true
            ? 'json'
            : typeof command.optsWithGlobals === 'function'
              ? command.optsWithGlobals().format
              : command.parent?.opts().format,
        verbose:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().verbose
            : command.parent?.opts().verbose,
        quiet:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().quiet
            : command.parent?.opts().quiet,
      })
      await faqCluster(ctx, options)
    })
}
