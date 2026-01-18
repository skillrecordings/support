import { access, readFile } from 'node:fs/promises'
import type {
  EvalDatapoint,
  EvalGates,
  EvalReport,
} from '@skillrecordings/core'

export interface EvalOptions {
  json?: boolean
  gates?: EvalGates
}

/**
 * Run evals against a dataset
 *
 * Usage: skill eval routing --dataset path/to/dataset.json [--gates strict|relaxed] [--json]
 *
 * @param evalType - Type of eval to run (currently only 'routing' supported)
 * @param datasetPath - Path to JSON dataset file
 * @param options - Command options
 */
export async function runEval(
  evalType: string,
  datasetPath: string | undefined,
  options: EvalOptions = {}
): Promise<void> {
  const { json = false, gates } = options

  // Validate inputs
  if (!datasetPath) {
    console.error(
      'Error: Dataset path is required. Usage: skill eval routing --dataset <path>'
    )
    process.exit(1)
  }

  // Check if file exists
  try {
    await access(datasetPath)
  } catch {
    console.error(`Error: Dataset file not found: ${datasetPath}`)
    process.exit(1)
  }

  // Read and parse dataset
  let dataset: EvalDatapoint[]
  try {
    const content = await readFile(datasetPath, 'utf-8')
    dataset = JSON.parse(content)
  } catch (error) {
    console.error(
      `Error: Invalid JSON in dataset file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    process.exit(1)
  }

  // Import evalRouting (only when needed to avoid circular deps)
  const { evalRouting } = await import('@skillrecordings/core')

  // Run eval with optional gates
  const report: EvalReport = await evalRouting(dataset, gates)

  // Output results
  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printPrettyResults(report)
  }

  // Exit with appropriate code
  process.exit(report.passed ? 0 : 1)
}

/**
 * Print pretty-formatted results table
 */
function printPrettyResults(report: EvalReport): void {
  console.log('\n📊 Evaluation Results\n')
  console.log('Overall Metrics:')
  console.log(`  Precision:           ${(report.precision * 100).toFixed(1)}%`)
  console.log(`  Recall:              ${(report.recall * 100).toFixed(1)}%`)
  console.log(`  False Positive Rate: ${(report.fpRate * 100).toFixed(1)}%`)
  console.log(`  False Negative Rate: ${(report.fnRate * 100).toFixed(1)}%`)

  console.log('\nPerformance:')
  console.log(`  Latency (p50):       ${report.latency.p50.toFixed(0)}ms`)
  console.log(`  Latency (p95):       ${report.latency.p95.toFixed(0)}ms`)
  console.log(`  Latency (p99):       ${report.latency.p99.toFixed(0)}ms`)
  console.log(`  Total Tokens:        ${report.cost.tokens.toLocaleString()}`)
  console.log(`  Estimated Cost:      $${report.cost.estimatedUsd.toFixed(4)}`)

  if (Object.keys(report.byCategory).length > 0) {
    console.log('\nCategory Breakdown:')
    for (const [category, metrics] of Object.entries(report.byCategory)) {
      console.log(`\n  ${category}:`)
      console.log(`    Precision: ${(metrics.precision * 100).toFixed(1)}%`)
      console.log(`    Recall:    ${(metrics.recall * 100).toFixed(1)}%`)
      console.log(`    F1:        ${(metrics.f1 * 100).toFixed(1)}%`)
      console.log(`    Count:     ${metrics.count}`)
    }
  }

  console.log(`\n${report.passed ? '✅ PASSED' : '❌ FAILED'}`)

  if (!report.passed) {
    console.log('\nOne or more metrics fell below threshold gates.')
  }
}
