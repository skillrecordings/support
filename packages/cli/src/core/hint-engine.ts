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

/**
 * Check if command is in a specific group (e.g., 'front' matches 'front.inbox')
 */
const isCommandGroup = (command: string, group: string): boolean =>
  command === group || command.startsWith(`${group}.`)

/**
 * All hints are now contextual and shown AFTER command output.
 * No more random discovery hints before you even see your results.
 */
export const DEFAULT_HINT_RULES: HintRule[] = [
  // Front contextual hints
  {
    id: 'context.front.triage',
    audience: 'contextual',
    postRun: true,
    message: 'Tip: `skill front triage` to auto-categorize unassigned threads.',
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
    id: 'context.front.reply',
    audience: 'contextual',
    postRun: true,
    message: 'Tip: `skill front reply <id>` to draft a response.',
    showWhen: (state, context) =>
      context.command === 'front.conversation' &&
      !hasCommand(state, 'front.reply'),
    retireWhen: (state) => hasCommand(state, 'front.reply'),
  },

  // Inngest contextual hints
  {
    id: 'context.inngest.run',
    audience: 'contextual',
    postRun: true,
    message: 'Tip: `skill inngest run <id>` to inspect a specific run.',
    showWhen: (state, context) =>
      (context.command === 'inngest.failures' ||
        context.command === 'inngest.runs') &&
      !hasCommand(state, 'inngest.run'),
    retireWhen: (state) => hasCommand(state, 'inngest.run'),
  },
  {
    id: 'context.inngest.trace',
    audience: 'contextual',
    postRun: true,
    message: 'Tip: `skill inngest trace <run-id>` for full workflow trace.',
    showWhen: (state, context) =>
      context.command === 'inngest.run' && !hasCommand(state, 'inngest.trace'),
    retireWhen: (state) => hasCommand(state, 'inngest.trace'),
  },

  // Linear contextual hints
  {
    id: 'context.linear.my',
    audience: 'contextual',
    postRun: true,
    message: 'Tip: `skill linear my` to see your assigned issues.',
    showWhen: (state, context) =>
      isCommandGroup(context.command, 'linear') &&
      context.command !== 'linear.my' &&
      !hasCommand(state, 'linear.my'),
    retireWhen: (state) => hasCommand(state, 'linear.my'),
  },

  // Axiom contextual hints
  {
    id: 'context.axiom.errors',
    audience: 'contextual',
    postRun: true,
    message: 'Tip: `skill axiom errors --since 1h` to see recent errors.',
    showWhen: (state, context) =>
      context.command === 'axiom.query' && !hasCommand(state, 'axiom.errors'),
    retireWhen: (state) => hasCommand(state, 'axiom.errors'),
  },

  // Keys hint - only when auth issues are likely
  {
    id: 'context.keys',
    audience: 'contextual',
    postRun: true,
    message: 'Tip: `skill keys setup` to configure keychain integration.',
    showWhen: (state, context) =>
      context.command === 'auth.status' &&
      !hasCommand(state, 'keys.setup') &&
      !hasMilestone(state, 'auth_configured'),
    retireWhen: (state) =>
      hasCommand(state, 'keys.setup') || hasMilestone(state, 'auth_configured'),
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
