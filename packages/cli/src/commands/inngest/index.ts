import type { Command } from 'commander'
import { getInngestAdaptiveDescription } from '../../core/adaptive-help'
import type { UsageState } from '../../core/usage-tracker'
import { registerEventsCommands } from './events'
import { registerInvestigateCommands } from './investigate'
import { registerPatternsCommand } from './patterns'
import { registerRunsCommands } from './runs'
import { registerSignalCommand } from './signal'

export function registerInngestCommands(
  program: Command,
  usageState?: UsageState | null
): void {
  const baseDescription = getInngestAdaptiveDescription(usageState)
  const descriptionWithEnv = `${baseDescription}\n\nEnvironment: INNGEST_SIGNING_KEY required. Run \`skill doctor\` to check.`

  const inngest = program.command('inngest').description(descriptionWithEnv)

  registerEventsCommands(inngest)
  registerRunsCommands(inngest)
  registerSignalCommand(inngest)
  registerInvestigateCommands(inngest)
  registerPatternsCommand(inngest)
}
