#!/usr/bin/env bun

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
  .argument('[name]', 'Name of the integration')
  .action(init)

program
  .command('health')
  .description('Test integration endpoint health')
  .argument('<url>', 'Base URL of the app (e.g., https://totaltypescript.com)')
  .option(
    '-s, --secret <secret>',
    'Webhook secret (or set SUPPORT_WEBHOOK_SECRET)'
  )
  .action(health)

program.parse()
