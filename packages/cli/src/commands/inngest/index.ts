import type { Command } from 'commander'
import { registerEventsCommands } from './events'
import { registerInvestigateCommands } from './investigate'
import { registerRunsCommands } from './runs'
import { registerSignalCommand } from './signal'

export function registerInngestCommands(program: Command): void {
  const inngest = program
    .command('inngest')
    .description(
      'Inngest event and workflow commands.\n\n' +
        '  Debug pipeline runs:\n' +
        '    skill inngest runs --status failed --after 1h    Recent failures\n' +
        '    skill inngest events --after 12h                 Recent events\n' +
        '    skill inngest investigate <run-id>                Deep-dive a specific run\n\n' +
        '  Requires: INNGEST_SIGNING_KEY, INNGEST_EVENT_KEY in env'
    )

  registerEventsCommands(inngest)
  registerRunsCommands(inngest)
  registerSignalCommand(inngest)
  registerInvestigateCommands(inngest)
}
