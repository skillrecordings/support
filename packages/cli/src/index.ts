#!/usr/bin/env bun

import 'dotenv-flow/config'
import { Command } from 'commander'
import { runEval } from './commands/eval'
import { health } from './commands/health'
import { init } from './commands/init'
import { wizard } from './commands/wizard'

const program = new Command()

program
  .name('skill')
  .description('CLI tool for managing app integrations')
  .version('0.0.0')

program
  .command('init')
  .description('Initialize a new app integration (quick mode)')
  .argument(
    '[name]',
    'Name of the integration (required in non-interactive mode)'
  )
  .option('--json', 'Output result as JSON (machine-readable)')
  .action(init)

program
  .command('wizard')
  .description('Interactive wizard for setting up a new property')
  .option('--json', 'Output result as JSON (machine-readable)')
  .action(wizard)

program
  .command('health')
  .description('Test integration endpoint health')
  .argument(
    '[slug|url]',
    'App slug (from database) or URL (e.g., https://totaltypescript.com)'
  )
  .option(
    '-s, --secret <secret>',
    'Webhook secret (required for direct URL mode)'
  )
  .option('-l, --list', 'List all registered apps')
  .option('--json', 'Output result as JSON (machine-readable)')
  .action(health)

program
  .command('eval')
  .description('Run evals against a dataset')
  .argument('<type>', 'Eval type (e.g., routing)')
  .argument('<dataset>', 'Path to dataset JSON file')
  .option('--json', 'Output result as JSON (machine-readable)')
  .option(
    '--min-precision <number>',
    'Minimum precision threshold (default: 0.92)',
    parseFloat
  )
  .option(
    '--min-recall <number>',
    'Minimum recall threshold (default: 0.95)',
    parseFloat
  )
  .option(
    '--max-fp-rate <number>',
    'Maximum false positive rate (default: 0.03)',
    parseFloat
  )
  .option(
    '--max-fn-rate <number>',
    'Maximum false negative rate (default: 0.02)',
    parseFloat
  )
  .action((type, dataset, options) => {
    const gates = {
      ...(options.minPrecision !== undefined && {
        minPrecision: options.minPrecision,
      }),
      ...(options.minRecall !== undefined && { minRecall: options.minRecall }),
      ...(options.maxFpRate !== undefined && { maxFpRate: options.maxFpRate }),
      ...(options.maxFnRate !== undefined && { maxFnRate: options.maxFnRate }),
    }
    runEval(type, dataset, {
      json: options.json,
      gates: Object.keys(gates).length > 0 ? gates : undefined,
    })
  })

program.parse()
