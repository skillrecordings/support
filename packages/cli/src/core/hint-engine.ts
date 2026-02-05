import type { OutputFormat } from './output'
import type { UsageState } from './usage-tracker'

export type HintAudience = 'onboarding' | 'discovery' | 'contextual'

export interface Hint {
  id: string
  message: string
  audience: HintAudience
}

export interface HintRule {
  id: string
  message: string
  audience: HintAudience
  showWhen: (state: UsageState, context: HintContext) => boolean
  retireWhen: (state: UsageState, context: HintContext) => boolean
  postRun?: boolean
}

export interface HintContext {
  command: string
  format?: OutputFormat
  quiet?: boolean
  maxHints?: number
  previouslyShown?: number
}

const DEFAULT_MAX_HINTS = 2

const getCommandCount = (state: UsageState, command: string): number =>
  state.commands[command]?.count ?? 0

const hasCommand = (state: UsageState, command: string): boolean =>
  getCommandCount(state, command) > 0

const hasCommandPrefix = (state: UsageState, prefix: string): boolean =>
  Object.entries(state.commands).some(
    ([name, entry]) => name.startsWith(prefix) && entry.count > 0
  )

const hasMilestone = (state: UsageState, milestone: string): boolean =>
  state.milestones[milestone]?.achieved ?? false

const shouldSuppressHints = (context: HintContext): boolean =>
  context.quiet === true || context.format === 'json'

const resolveMaxHints = (context: HintContext): number =>
  context.maxHints ?? DEFAULT_MAX_HINTS

const toHint = (rule: HintRule): Hint => ({
  id: rule.id,
  message: rule.message,
  audience: rule.audience,
})

export const DEFAULT_HINT_RULES: HintRule[] = [
  {
    id: 'onboarding.wizard',
    audience: 'onboarding',
    message: 'New here? Run `skill wizard` to set up your first product.',
    showWhen: (state) => state.totalRuns <= 2 && !hasCommand(state, 'wizard'),
    retireWhen: (state) =>
      hasCommand(state, 'wizard') || hasMilestone(state, 'wizard_completed'),
  },
  {
    id: 'onboarding.auth',
    audience: 'onboarding',
    message: 'Set up your own API keys with `skill keys`.',
    showWhen: (state) =>
      state.totalRuns >= 1 && !hasMilestone(state, 'auth_configured'),
    retireWhen: (state) => hasMilestone(state, 'auth_configured'),
  },
  {
    id: 'discovery.health',
    audience: 'discovery',
    message: 'Check integrations fast with `skill health <app-slug>`.',
    showWhen: (state) => state.totalRuns >= 2 && !hasCommand(state, 'health'),
    retireWhen: (state) => hasCommand(state, 'health'),
  },
  {
    id: 'discovery.front.inbox',
    audience: 'discovery',
    message: 'List recent conversations via `skill front inbox <name-or-id>`.',
    showWhen: (state) =>
      state.totalRuns >= 1 && !hasCommand(state, 'front.inbox'),
    retireWhen: (state) => hasCommand(state, 'front.inbox'),
  },
  {
    id: 'discovery.inngest',
    audience: 'discovery',
    message: 'Inspect workflows with `skill inngest stats --after 1d`.',
    showWhen: (state) =>
      state.totalRuns >= 3 && !hasCommandPrefix(state, 'inngest.'),
    retireWhen: (state) => hasCommandPrefix(state, 'inngest.'),
  },
  {
    id: 'discovery.axiom',
    audience: 'discovery',
    message: 'Query logs quickly with `skill axiom query "<APL>" --since 24h`.',
    showWhen: (state) =>
      state.totalRuns >= 3 && !hasCommandPrefix(state, 'axiom.'),
    retireWhen: (state) => hasCommandPrefix(state, 'axiom.'),
  },
  {
    id: 'discovery.keys',
    audience: 'discovery',
    message: 'Override shared credentials with your own: `skill keys add`',
    showWhen: (state) => state.totalRuns >= 3 && !hasCommand(state, 'keys'),
    retireWhen: (state) =>
      hasCommand(state, 'keys') || hasCommand(state, 'keys.add'),
  },
  {
    id: 'context.front.triage',
    audience: 'contextual',
    postRun: true,
    message:
      'Tip: `skill front triage <inbox-id>` surfaces unassigned threads.',
    showWhen: (state, context) =>
      context.command === 'front.inbox' && !hasCommand(state, 'front.triage'),
    retireWhen: (state) => hasCommand(state, 'front.triage'),
  },
  {
    id: 'context.front.conversation',
    audience: 'contextual',
    postRun: true,
    message: 'Tip: `skill front conversation <id> -m` shows the full thread.',
    showWhen: (state, context) =>
      context.command === 'front.message' &&
      !hasCommand(state, 'front.conversation'),
    retireWhen: (state) => hasCommand(state, 'front.conversation'),
  },
  {
    id: 'context.inngest.run',
    audience: 'contextual',
    postRun: true,
    message:
      'Tip: drill in with `skill inngest run <id>` or `skill inngest trace <run-id>`.',
    showWhen: (state, context) =>
      context.command === 'inngest.failures' &&
      !hasCommand(state, 'inngest.run') &&
      !hasCommand(state, 'inngest.trace'),
    retireWhen: (state) =>
      hasCommand(state, 'inngest.run') || hasCommand(state, 'inngest.trace'),
  },
]

export class HintEngine {
  private rules: HintRule[]

  constructor(rules: HintRule[] = DEFAULT_HINT_RULES) {
    this.rules = rules
  }

  getHints(state: UsageState, context: HintContext): Hint[] {
    if (shouldSuppressHints(context)) return []

    const maxHints = resolveMaxHints(context)
    if (maxHints <= 0) return []

    const hints: Hint[] = []
    for (const rule of this.rules) {
      if (rule.postRun) continue
      if (!rule.showWhen(state, context)) continue
      if (rule.retireWhen(state, context)) continue
      hints.push(toHint(rule))
      if (hints.length >= maxHints) break
    }

    return hints
  }

  getPostRunHint(state: UsageState, context: HintContext): Hint | null {
    if (shouldSuppressHints(context)) return null

    const maxHints = resolveMaxHints(context)
    if (maxHints <= 0) return null

    const previouslyShown = context.previouslyShown ?? 0
    if (previouslyShown >= maxHints) return null

    for (const rule of this.rules) {
      if (!rule.postRun) continue
      if (!rule.showWhen(state, context)) continue
      if (rule.retireWhen(state, context)) continue
      return toHint(rule)
    }

    return null
  }
}

export const writeHints = (hints: Hint[], stderr: NodeJS.WriteStream): void => {
  for (const hint of hints) {
    stderr.write(`${hint.message}\n`)
  }
}
