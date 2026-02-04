import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'

type JsonOption = { json?: boolean }

/**
 * Extract global CLI options from a Commander command and create a CommandContext.
 * Use this in .action() handlers to avoid repeating the same boilerplate.
 */
export async function contextFromCommand(
  command: Command,
  options: JsonOption = {}
): Promise<CommandContext> {
  const opts =
    typeof command.optsWithGlobals === 'function'
      ? command.optsWithGlobals()
      : { ...command.parent?.opts(), ...command.opts() }

  return createContext({
    format: options.json ? 'json' : opts.format,
    verbose: opts.verbose,
    quiet: opts.quiet,
  })
}
