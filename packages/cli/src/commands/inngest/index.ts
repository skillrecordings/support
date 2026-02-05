import type { Command } from 'commander'
import { getInngestAdaptiveDescription } from '../../core/adaptive-help'
import type { UsageState } from '../../core/usage-tracker'
import { registerEventsCommands } from './events'
import { registerInvestigateCommands } from './investigate'
import { registerRunsCommands } from './runs'
import { registerSignalCommand } from './signal'

export function registerInngestCommands(
  program: Command,
  usageState?: UsageState | null
): void {
  const inngest = program
    .command('inngest')
    .description(getInngestAdaptiveDescription(usageState))

  registerEventsCommands(inngest)
  registerRunsCommands(inngest)
  registerSignalCommand(inngest)
  registerInvestigateCommands(inngest)
}
