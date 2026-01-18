#!/usr/bin/env bun

import 'dotenv-flow/config'
import { Command } from 'commander'
import { health } from './commands/health'
import { init } from './commands/init'

const program = new Command()

program
  .name('skill')
  .description('CLI tool for managing app integrations')
  .version('0.0.0')

program
  .command('init')
  .description('Initialize a new app integration')
  .argument(
    '[name]',
    'Name of the integration (required in non-interactive mode)'
  )
  .option('--json', 'Output result as JSON (machine-readable)')
  .action(init)

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

program.parse()
