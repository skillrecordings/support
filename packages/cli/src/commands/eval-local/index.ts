/**
 * Local eval CLI commands
 *
 * Commands for running evals against a local Docker environment
 */

import type { Command } from 'commander'
import { health } from './health'
import { run } from './run'
import { scoreProduction } from './score-production'
import { seed } from './seed'

export function registerEvalLocalCommands(program: Command): void {
  const evalLocal = program
    .command('eval-local')
    .description('Local evaluation environment commands')

  evalLocal
    .command('health')
    .description('Check health of local eval environment services')
    .option('--json', 'Output as JSON')
    .action(health)

  evalLocal
    .command('seed')
    .description('Seed the local eval environment with fixtures')
    .option('--clean', 'Drop and recreate all data before seeding')
    .option('--fixtures <path>', 'Path to fixtures directory', 'fixtures')
    .option('--json', 'Output as JSON')
    .action(seed)

  evalLocal
    .command('run')
    .description('Run eval suite against local environment')
    .option('--scenarios <glob>', 'Scenario files glob pattern')
    .option('--dataset <file>', 'Dataset JSON file (alternative to scenarios)')
    .option('--prompt <file>', 'Custom prompt file (default: production)')
    .option('--model <model>', 'Model to use', 'anthropic/claude-haiku-4-5')
    .option('--limit <number>', 'Max scenarios to run', parseInt)
    .option('--output <file>', 'Save results to JSON file')
    .option('--baseline <file>', 'Compare against baseline results')
    .option(
      '--fail-threshold <number>',
      'Fail if pass rate below threshold',
      parseFloat
    )
    .option('--verbose', 'Show individual scenario results')
    .option('--json', 'JSON output for scripting')
    .option('--real-tools', 'Use real Docker services instead of mocks')
    .action(run)

  evalLocal
    .command('score-production')
    .description(
      'Score actual production responses from dataset (no mocks, real data)'
    )
    .requiredOption(
      '--dataset <file>',
      'Dataset JSON file with production responses'
    )
    .option('--output <file>', 'Save results to JSON file')
    .option('--verbose', 'Show individual failures')
    .option('--json', 'JSON output for scripting')
    .action(scoreProduction)
}
