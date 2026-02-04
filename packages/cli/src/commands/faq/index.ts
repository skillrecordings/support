import type { Command } from 'commander'
import { registerFaqClassifyCommands } from './classify'
import { registerFaqClusterCommands } from './cluster'
import { registerFaqExtractCommands } from './extract'
import { registerFaqMineCommands } from './mine'
import { registerFaqReviewCommands } from './review'

export function registerFaqCommands(program: Command): void {
  const faq = program.command('faq').description('FAQ tools')

  registerFaqMineCommands(faq)
  registerFaqClusterCommands(faq)
  registerFaqClassifyCommands(faq)
  registerFaqExtractCommands(faq)
  registerFaqReviewCommands(faq)
}
