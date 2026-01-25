/**
 * Pipeline CLI commands
 * 
 * Commands for running and evaluating the pipeline steps.
 */

import type { Command } from 'commander'
import { runClassifyEval, buildClassifyDataset } from '@skillrecordings/core/pipeline/evals/classify.eval'
import { runValidateEval, buildValidateDatasetFromProduction } from '@skillrecordings/core/pipeline/evals/validate.eval'
import { runE2EEval } from '@skillrecordings/core/pipeline/evals/e2e.eval'

export function registerPipelineCommands(program: Command): void {
  const pipeline = program
    .command('pipeline')
    .description('Pipeline step commands and evals')

  // -------------------------------------------------------------------------
  // Classify eval
  // -------------------------------------------------------------------------
  pipeline
    .command('eval-classify')
    .description('Run classifier evaluation')
    .requiredOption('--dataset <file>', 'Path to labeled scenarios JSON')
    .option('--output <file>', 'Save results to JSON')
    .option('--verbose', 'Show individual failures')
    .option('--json', 'JSON output')
    .option('--force-llm', 'Skip fast path, always use LLM')
    .option('--model <model>', 'Model for LLM classification', 'anthropic/claude-haiku-4-5')
    .action(async (opts) => {
      await runClassifyEval(opts)
    })

  pipeline
    .command('build-classify-dataset')
    .description('Build classify eval dataset from production data')
    .requiredOption('--production <file>', 'Production dataset JSON')
    .requiredOption('--output <file>', 'Output scenarios JSON')
    .action(async (opts) => {
      await buildClassifyDataset(opts.production, opts.output)
    })

  // -------------------------------------------------------------------------
  // Validate eval
  // -------------------------------------------------------------------------
  pipeline
    .command('eval-validate')
    .description('Run validator evaluation')
    .option('--dataset <file>', 'Path to scenarios JSON (uses built-in if not provided)')
    .option('--output <file>', 'Save results to JSON')
    .option('--verbose', 'Show individual failures')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      await runValidateEval(opts)
    })

  pipeline
    .command('build-validate-dataset')
    .description('Build validate eval dataset from production failures')
    .requiredOption('--production <file>', 'Production baseline results JSON')
    .requiredOption('--output <file>', 'Output scenarios JSON')
    .action(async (opts) => {
      await buildValidateDatasetFromProduction(opts.production, opts.output)
    })

  // -------------------------------------------------------------------------
  // E2E eval
  // -------------------------------------------------------------------------
  pipeline
    .command('eval-e2e')
    .description('Run end-to-end pipeline evaluation')
    .requiredOption('--dataset <file>', 'Production dataset JSON')
    .option('--output <file>', 'Save results to JSON')
    .option('--verbose', 'Show individual failures')
    .option('--json', 'JSON output')
    .option('--limit <number>', 'Max scenarios to run', parseInt)
    .option('--model <model>', 'Model for LLM steps', 'anthropic/claude-haiku-4-5')
    .action(async (opts) => {
      await runE2EEval(opts)
    })

  // -------------------------------------------------------------------------
  // Run pipeline
  // -------------------------------------------------------------------------
  pipeline
    .command('run')
    .description('Run pipeline on a single message')
    .requiredOption('--subject <text>', 'Message subject')
    .requiredOption('--body <text>', 'Message body')
    .option('--app <id>', 'App ID', 'total-typescript')
    .option('--dry-run', 'Don\'t actually send', true)
    .option('--json', 'JSON output')
    .action(async (opts) => {
      const { runPipeline } = await import('@skillrecordings/core/pipeline')
      
      const result = await runPipeline({
        message: {
          subject: opts.subject,
          body: opts.body,
        },
        appConfig: {
          appId: opts.app,
          instructorConfigured: false,
          autoSendEnabled: false,
        },
        dryRun: opts.dryRun,
      })

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(`\n📬 Pipeline Result\n`)
        console.log(`Action: ${result.action}`)
        if (result.response) {
          console.log(`\nResponse:\n${result.response}`)
        }
        console.log(`\nSteps:`)
        for (const step of result.steps) {
          const icon = step.success ? '✅' : '❌'
          console.log(`  ${icon} ${step.step} (${step.durationMs}ms)`)
          if (step.error) {
            console.log(`     Error: ${step.error}`)
          }
        }
        console.log(`\nTotal: ${result.totalDurationMs}ms`)
      }
    })
}
