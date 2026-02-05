import type { Command } from 'commander'
import { createContext } from '../../core/context'
import { loginAction } from './login'
import { authSetupAction } from './setup'
import { statusAction } from './status'
import { whoamiAction } from './whoami'

const buildContext = async (command: Command, json?: boolean) => {
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

/**
 * Register auth commands with Commander
 */
export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Manage CLI auth status')

  auth
    .command('status')
    .description('Show active auth provider and secret availability')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      await statusAction(ctx, options)
    })

  auth
    .command('login')
    .description('Validate a 1Password service account token')
    .option(
      '--token <token>',
      'Service account token (defaults to OP_SERVICE_ACCOUNT_TOKEN)'
    )
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      await loginAction(ctx, options)
    })

  auth
    .command('whoami')
    .description('Show 1Password service account info')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      await whoamiAction(ctx, options)
    })

  auth
    .command('setup')
    .description('Interactive wizard to configure 1Password secrets')
    .option(
      '--token <token>',
      'Service account token (defaults to 1Password op read)'
    )
    .option('--age-key <ageKey>', 'AGE secret key (defaults to op read)')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      await authSetupAction(ctx, options)
    })
}
