import type { Command } from 'commander'
import { registerSetupCommand } from './setup.js'
import { registerStatusCommand } from './status.js'

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Auth and secret management')

  registerSetupCommand(auth)
  registerStatusCommand(auth)
}
