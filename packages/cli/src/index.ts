#!/usr/bin/env bun

import { Command } from 'commander';
import { init } from './commands/init';

const program = new Command();

program
  .name('skill')
  .description('CLI tool for scaffolding new app integrations')
  .version('0.0.0');

program
  .command('init')
  .description('Initialize a new app integration')
  .argument('[name]', 'Name of the integration')
  .action(init);

program.parse();
