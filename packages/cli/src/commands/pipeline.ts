/**
 * Pipeline CLI commands
 *
 * Commands for running and evaluating the pipeline steps.
 */

import {
  buildClassifyDataset,
  runClassifyEval,
} from '@skillrecordings/core/pipeline/evals/classify.eval'
import { runE2EEval } from '@skillrecordings/core/pipeline/evals/e2e.eval'
import {
  buildValidateDatasetFromProduction,
  runValidateEval,
} from '@skillrecordings/core/pipeline/evals/validate.eval'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

const buildContext = async (
  command: Command,
  json?: boolean
): Promise<CommandContext> => {
  const opts =
    typeof command.optsWithGlobals === 'function'
      ? command.optsWithGlobals()
      : {
          ...command.parent?.opts(),
          ...command.opts(),
        }
  return createContext({
    format: json ? 'json' : opts.format,
    verbose: opts.verbose,
    quiet: opts.quiet,
  })
}

const handlePipelineError = (
  ctx: CommandContext,
  error: unknown,
  message: string,
  suggestion = 'Verify inputs and try again.'
): void => {
  const cliError =
    error instanceof CLIError
      ? error
      : new CLIError({
          userMessage: message,
          suggestion,
          cause: error,
        })

  ctx.output.error(formatError(cliError))
  process.exitCode = cliError.exitCode
}

export async function runPipelineCommand(
  ctx: CommandContext,
  opts: {
    subject: string
    body: string
    app: string
    dryRun: boolean
    json?: boolean
  }
): Promise<void> {
  const outputJson = opts.json === true || ctx.format === 'json'

  try {
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

    if (outputJson) {
      ctx.output.data(result)
      return
    }

    ctx.output.data(`\n📬 Pipeline Result\n`)
    ctx.output.data(`Action: ${result.action}`)
    if (result.response) {
      ctx.output.data(`\nResponse:\n${result.response}`)
    }
    ctx.output.data(`\nSteps:`)
    for (const step of result.steps) {
      const icon = step.success ? '✅' : '❌'
      ctx.output.data(`  ${icon} ${step.step} (${step.durationMs}ms)`)
      if (step.error) {
        ctx.output.data(`     Error: ${step.error}`)
      }
    }
    ctx.output.data(`\nTotal: ${result.totalDurationMs}ms`)
  } catch (error) {
    handlePipelineError(ctx, error, 'Failed to run pipeline.')
  }
}

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
    .option(
      '--model <model>',
      'Model for LLM classification',
      'anthropic/claude-haiku-4-5'
    )
    .action(async (opts, command) => {
      const ctx = await buildContext(command, opts.json)
      try {
        await runClassifyEval({
          ...opts,
          json: opts.json ?? ctx.format === 'json',
        })
      } catch (error) {
        handlePipelineError(ctx, error, 'Classify eval failed.')
      }
    })

  pipeline
    .command('build-classify-dataset')
    .description('Build classify eval dataset from production data')
    .requiredOption('--production <file>', 'Production dataset JSON')
    .requiredOption('--output <file>', 'Output scenarios JSON')
    .action(async (opts, command) => {
      const ctx = await buildContext(command)
      try {
        await buildClassifyDataset(opts.production, opts.output)
        ctx.output.success(`Dataset written to ${opts.output}`)
      } catch (error) {
        handlePipelineError(ctx, error, 'Failed to build classify dataset.')
      }
    })

  // -------------------------------------------------------------------------
  // Validate eval
  // -------------------------------------------------------------------------
  pipeline
    .command('eval-validate')
    .description('Run validator evaluation')
    .option(
      '--dataset <file>',
      'Path to scenarios JSON (uses built-in if not provided)'
    )
    .option('--output <file>', 'Save results to JSON')
    .option('--verbose', 'Show individual failures')
    .option('--json', 'JSON output')
    .action(async (opts, command) => {
      const ctx = await buildContext(command, opts.json)
      try {
        await runValidateEval({
          ...opts,
          json: opts.json ?? ctx.format === 'json',
        })
      } catch (error) {
        handlePipelineError(ctx, error, 'Validate eval failed.')
      }
    })

  pipeline
    .command('build-validate-dataset')
    .description('Build validate eval dataset from production failures')
    .requiredOption('--production <file>', 'Production baseline results JSON')
    .requiredOption('--output <file>', 'Output scenarios JSON')
    .action(async (opts, command) => {
      const ctx = await buildContext(command)
      try {
        await buildValidateDatasetFromProduction(opts.production, opts.output)
        ctx.output.success(`Dataset written to ${opts.output}`)
      } catch (error) {
        handlePipelineError(ctx, error, 'Failed to build validate dataset.')
      }
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
    .option(
      '--model <model>',
      'Model for LLM steps',
      'anthropic/claude-haiku-4-5'
    )
    .action(async (opts, command) => {
      const ctx = await buildContext(command, opts.json)
      try {
        await runE2EEval({ ...opts, json: opts.json ?? ctx.format === 'json' })
      } catch (error) {
        handlePipelineError(ctx, error, 'E2E eval failed.')
      }
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
    .option('--dry-run', "Don't actually send", true)
    .option('--json', 'JSON output')
    .action(async (opts, command) => {
      const ctx = await buildContext(command, opts.json)
      await runPipelineCommand(ctx, opts)
    })
}
