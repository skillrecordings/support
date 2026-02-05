/**
 * Eval-pipeline CLI commands
 *
 * Run evals against individual pipeline steps or full e2e.
 * Uses actual pipeline implementations from @skillrecordings/core/pipeline.
 */

import type { Command } from 'commander'
import { createContext } from '../../core/context'
import { run } from './run'
import { seed } from './seed'

export function registerEvalPipelineCommands(program: Command): void {
  const evalPipeline = program
    .command('eval-pipeline')
    .description('Evaluate pipeline steps against labeled scenarios')

  // Run subcommand (main functionality)
  evalPipeline
    .command('run')
    .description('Run eval suite against pipeline steps')
    .option(
      '--step <step>',
      'Which step to test: classify | route | gather | draft | validate | e2e',
      'classify'
    )
    .option('--scenarios <glob>', 'Scenario files glob pattern')
    .option('--dataset <file>', 'Dataset JSON file (alternative to scenarios)')
    .option('--limit <n>', 'Max scenarios to run', parseInt)
    .option('--verbose', 'Show individual scenario results')
    .option('--json', 'JSON output for scripting')
    .option(
      '--model <model>',
      'Model for LLM steps',
      'anthropic/claude-haiku-4-5'
    )
    .option('--force-llm', 'Skip fast path, always use LLM (classify step)')
    .option('--real-tools', 'Use real Docker MySQL/Qdrant instead of mocks')
    .option('--parallel <n>', 'Run N scenarios concurrently', parseInt, 10)
    .option('--cache-classify', 'Cache classify results between runs')
    .option('--clear-cache', 'Clear cached classify results before run')
    .option('--fail-fast', 'Stop on first failure')
    .option('--quick', 'Run smoke test subset (~10 scenarios)')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await run(ctx, options)
    })

  // Seed subcommand
  evalPipeline
    .command('seed')
    .description('Seed MySQL and Qdrant with test fixtures')
    .option('--clean', 'Drop and recreate all data')
    .option('--fixtures <path>', 'Path to fixtures directory', 'fixtures')
    .option('--json', 'JSON output for scripting')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await seed(ctx, options)
    })
}
