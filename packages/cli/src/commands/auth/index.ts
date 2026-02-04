import type { Command } from 'commander'
import { statusAction } from './status'

/**
 * Register auth commands with Commander
 */
export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Manage CLI auth status')

  auth
    .command('status')
    .description('Check encryption setup status')
    .option('--json', 'Output as JSON')
    .action(statusAction)
}
