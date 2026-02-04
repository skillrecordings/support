import type { Command } from 'commander'
import { registerEventsCommands } from './events'
import { registerInvestigateCommands } from './investigate'
import { registerRunsCommands } from './runs'
import { registerSignalCommand } from './signal'

export function registerInngestCommands(program: Command): void {
  const inngest = program.command('inngest').description('Inngest API commands')

  registerEventsCommands(inngest)
  registerRunsCommands(inngest)
  registerSignalCommand(inngest)
  registerInvestigateCommands(inngest)
}
