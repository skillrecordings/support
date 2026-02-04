import type { Command } from 'commander'
import { loginAction } from './login'
import { statusAction } from './status'
import { whoamiAction } from './whoami'

/**
 * Register auth commands with Commander
 */
export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Manage CLI auth status')

  auth
    .command('status')
    .description('Show active auth provider and secret availability')
    .option('--json', 'Output as JSON')
    .action(statusAction)

  auth
    .command('login')
    .description('Validate a 1Password service account token')
    .option(
      '--token <token>',
      'Service account token (defaults to OP_SERVICE_ACCOUNT_TOKEN)'
    )
    .option('--json', 'Output as JSON')
    .action(loginAction)

  auth
    .command('whoami')
    .description('Show 1Password service account info')
    .option('--json', 'Output as JSON')
    .action(whoamiAction)
}
