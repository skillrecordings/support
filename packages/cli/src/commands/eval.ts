import { access, readFile } from 'node:fs/promises'
import type {
  EvalDatapoint,
  EvalGates,
  EvalReport,
} from '@skillrecordings/core/evals/routing'
import { type CommandContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

export interface EvalOptions {
  json?: boolean
  gates?: EvalGates
}

/**
 * Run evals against a dataset
 *
 * Usage: skill eval routing --dataset path/to/dataset.json [--gates strict|relaxed] [--json]
 *
 * @param ctx - Command context
 * @param evalType - Type of eval to run (currently only 'routing' supported)
 * @param datasetPath - Path to JSON dataset file
 * @param options - Command options
 */
export async function runEval(
  ctx: CommandContext,
  evalType: string,
  datasetPath: string | undefined,
  options: EvalOptions = {}
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const { gates } = options

  try {
    if (evalType !== 'routing') {
      throw new CLIError({
        userMessage: `Unsupported eval type: ${evalType}.`,
        suggestion: 'Use "routing" for now.',
      })
    }

    // Validate inputs
    if (!datasetPath) {
      throw new CLIError({
        userMessage:
          'Dataset path is required. Usage: skill eval routing --dataset <path>.',
        suggestion: 'Provide the dataset file path.',
      })
    }

    // Check if file exists
    try {
      await access(datasetPath)
    } catch {
      throw new CLIError({
        userMessage: `Dataset file not found: ${datasetPath}.`,
        suggestion: 'Confirm the dataset path and try again.',
      })
    }

    // Read and parse dataset
    let dataset: EvalDatapoint[]
    try {
      const content = await readFile(datasetPath, 'utf-8')
      dataset = JSON.parse(content)
    } catch (error) {
      throw new CLIError({
        userMessage: 'Invalid JSON in dataset file. Verify the file contents.',
        suggestion: 'Ensure the dataset is valid JSON.',
        cause: error,
      })
    }

    // Import evalRouting (only when needed to avoid circular deps)
    const { evalRouting } = await import('@skillrecordings/core/evals/routing')

    // Run eval with optional gates
    const report: EvalReport = await evalRouting(dataset, gates)

    // Output results
    if (outputJson) {
      ctx.output.data(report)
    } else {
      printPrettyResults(ctx, report)
    }

    process.exitCode = report.passed ? 0 : 1
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Eval failed.',
            suggestion: 'Verify dataset and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Print pretty-formatted results table
 */
function printPrettyResults(ctx: CommandContext, report: EvalReport): void {
  ctx.output.data('\n📊 Evaluation Results\n')
  ctx.output.data('Overall Metrics:')
  ctx.output.data(
    `  Precision:           ${(report.precision * 100).toFixed(1)}%`
  )
  ctx.output.data(`  Recall:              ${(report.recall * 100).toFixed(1)}%`)
  ctx.output.data(`  False Positive Rate: ${(report.fpRate * 100).toFixed(1)}%`)
  ctx.output.data(`  False Negative Rate: ${(report.fnRate * 100).toFixed(1)}%`)

  ctx.output.data('\nPerformance:')
  ctx.output.data(`  Latency (p50):       ${report.latency.p50.toFixed(0)}ms`)
  ctx.output.data(`  Latency (p95):       ${report.latency.p95.toFixed(0)}ms`)
  ctx.output.data(`  Latency (p99):       ${report.latency.p99.toFixed(0)}ms`)
  ctx.output.data(
    `  Total Tokens:        ${report.cost.tokens.toLocaleString()}`
  )
  ctx.output.data(
    `  Estimated Cost:      $${report.cost.estimatedUsd.toFixed(4)}`
  )

  if (Object.keys(report.byCategory).length > 0) {
    ctx.output.data('\nCategory Breakdown:')
    for (const [category, metrics] of Object.entries(report.byCategory)) {
      ctx.output.data(`\n  ${category}:`)
      ctx.output.data(`    Precision: ${(metrics.precision * 100).toFixed(1)}%`)
      ctx.output.data(`    Recall:    ${(metrics.recall * 100).toFixed(1)}%`)
      ctx.output.data(`    F1:        ${(metrics.f1 * 100).toFixed(1)}%`)
      ctx.output.data(`    Count:     ${metrics.count}`)
    }
  }

  ctx.output.data(`\n${report.passed ? '✅ PASSED' : '❌ FAILED'}`)

  if (!report.passed) {
    ctx.output.data('\nOne or more metrics fell below threshold gates.')
  }
}
