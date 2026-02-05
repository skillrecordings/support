import type { Command } from 'commander'
import { createContext } from '../../core/context'
import { configGetAction } from './get'
import { configInitAction } from './init'
import { configListAction } from './list'
import { configSetAction } from './set'

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
 * Register config commands with Commander
 */
export function registerConfigCommands(program: Command): void {
  const config = program
    .command('config')
    .description('Manage user-specific config overrides (encrypted)')

  config
    .command('init')
    .description('Generate age keypair for user config encryption')
    .option('--force', 'Overwrite existing keypair')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      await configInitAction(ctx, options)
    })

  config
    .command('set <key-value>')
    .description('Set encrypted config value (format: KEY=value)')
    .option('--json', 'Output as JSON')
    .action(async (keyValue, options, command) => {
      const ctx = await buildContext(command, options.json)
      await configSetAction(ctx, keyValue, options)
    })

  config
    .command('get <key>')
    .description('Get decrypted config value')
    .option('--json', 'Output as JSON')
    .action(async (key, options, command) => {
      const ctx = await buildContext(command, options.json)
      await configGetAction(ctx, key, options)
    })

  config
    .command('list')
    .description('List all user config overrides')
    .option('--show-values', 'Show decrypted values (keys only by default)')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      await configListAction(ctx, options)
    })
}
