import type { UsageState } from './usage-tracker'

type CommandGroup = 'root' | 'front' | 'auth' | 'inngest'
type ProficiencyLevel = 'full' | 'abbreviated' | 'minimal'

const ABBREVIATED_THRESHOLD = 2
const MINIMAL_THRESHOLD = 5

const ROOT_DESCRIPTIONS: Record<ProficiencyLevel, string> = {
  full:
    'Skill Recordings support agent CLI — triage, investigate, and manage customer conversations.\n\n' +
    '  Getting Started:\n' +
    '    1. skill wizard            Interactive app setup wizard\n' +
    '    2. skill keys              Manage your personal API keys\n' +
    '    3. skill front inbox        See what needs attention right now\n\n' +
    '  Common Workflows:\n' +
    '    Triage inbox          skill front inbox → skill front triage\n' +
    '    Investigate ticket    skill front conversation <id> --messages\n' +
    '    Bulk cleanup          skill front bulk-archive --older-than 30d\n' +
    '    Generate report       skill front report --inbox support\n' +
    '    Check deploys         skill deploys\n\n' +
    '  For AI Agents (Claude Code, MCP):\n' +
    '    skill mcp              Start JSON-RPC server with 9 Front tools\n' +
    '    skill plugin sync      Install the Claude Code plugin\n' +
    '    All commands support --json for structured, HATEOAS-enriched output',
  abbreviated:
    'Skill Recordings support agent CLI — triage and investigate support conversations.\n\n' +
    '  Start here:\n' +
    '    skill wizard            Set up a new product\n' +
    '    skill keys              Manage API keys\n' +
    '    skill front inbox       See what needs attention\n' +
    '    skill front triage      Auto-categorize conversations\n\n' +
    '  Common:\n' +
    '    skill front conversation <id> --messages\n' +
    '    skill front reply <id>\n' +
    '    skill deploys\n' +
    '    skill mcp\n',
  minimal:
    'Skill Recordings support agent CLI. Try: skill wizard, skill keys, skill front inbox, skill front triage. Use --help for details.',
}

const FRONT_DESCRIPTIONS: Record<ProficiencyLevel, string> = {
  full:
    'Front conversations, inboxes, tags, archival, and reporting.\n\n' +
    '  Start here:\n' +
    '    skill front inbox                    See unassigned conversations\n' +
    '    skill front inbox support             List conversations in a specific inbox\n' +
    '    skill front triage                    AI-powered categorization of inbox items\n\n' +
    '  Investigate a conversation:\n' +
    '    skill front conversation <id> -m      Full conversation with messages\n' +
    '    skill front message <id>              Single message details + body\n\n' +
    '  Take action:\n' +
    '    skill front assign <id>               Assign to a teammate\n' +
    '    skill front reply <id>                Draft a reply (HITL, never auto-sends)\n' +
    '    skill front tag <id>                  Add a tag\n' +
    '    skill front archive <id>              Archive a resolved conversation\n\n' +
    '  Bulk operations:\n' +
    '    skill front bulk-archive              Archive old/spam conversations\n' +
    '    skill front report                    Volume + tag + sender forensics\n\n' +
    '  All commands accept --json for HATEOAS-enriched output with _links and _actions.',
  abbreviated:
    'Front API workflows for inbox triage and conversation actions.\n\n' +
    '  Common:\n' +
    '    skill front inbox\n' +
    '    skill front triage\n' +
    '    skill front conversation <id> -m\n' +
    '    skill front reply <id>\n' +
    '    skill front archive <id>',
  minimal: 'Front API commands (inbox, triage, assign, reply, archive).',
}

const AUTH_DESCRIPTIONS: Record<ProficiencyLevel, string> = {
  full:
    'View CLI authentication status.\n\n' +
    '  Check your setup:\n' +
    '    skill auth status          Shows which secrets are loaded\n' +
    '    skill auth whoami          Verify your 1Password service account identity\n\n' +
    '  API keys ship with the CLI (encrypted). To override with personal keys:\n' +
    '    skill keys                  Manage personal API key overrides',
  abbreviated:
    'View CLI authentication status.\n\n' +
    '  Commands:\n' +
    '    skill auth status\n' +
    '    skill auth whoami',
  minimal: 'Auth status commands (auth status, auth whoami).',
}

const INNGEST_DESCRIPTIONS: Record<ProficiencyLevel, string> = {
  full:
    'Inngest event and workflow commands.\n\n' +
    '  Debug pipeline runs:\n' +
    '    skill inngest runs --status failed --after 1h    Recent failures\n' +
    '    skill inngest events --after 12h                 Recent events\n' +
    '    skill inngest investigate <run-id>                Deep-dive a specific run',
  abbreviated:
    'Inngest events and workflow runs.\n\n' +
    '  Common:\n' +
    '    skill inngest runs --status failed --after 1h\n' +
    '    skill inngest events --after 12h\n' +
    '    skill inngest investigate <run-id>',
  minimal: 'Inngest events and runs debugging.',
}

const GROUP_DESCRIPTIONS: Record<
  CommandGroup,
  Record<ProficiencyLevel, string>
> = {
  root: ROOT_DESCRIPTIONS,
  front: FRONT_DESCRIPTIONS,
  auth: AUTH_DESCRIPTIONS,
  inngest: INNGEST_DESCRIPTIONS,
}

const getGroupCommandCount = (
  state: UsageState,
  group: CommandGroup
): number => {
  if (group === 'root') return state.totalRuns
  const prefix = `${group}.`
  let total = 0
  for (const [name, entry] of Object.entries(state.commands)) {
    if (name === group || name.startsWith(prefix)) {
      total += entry.count
    }
  }
  return total
}

const resolveProficiencyLevel = (
  state: UsageState | null | undefined,
  group: CommandGroup
): ProficiencyLevel => {
  if (!state) return 'full'
  const count = getGroupCommandCount(state, group)
  if (count >= MINIMAL_THRESHOLD) return 'minimal'
  if (count >= ABBREVIATED_THRESHOLD) return 'abbreviated'
  return 'full'
}

const getAdaptiveDescription = (
  group: CommandGroup,
  state?: UsageState | null
): string => {
  const level = resolveProficiencyLevel(state, group)
  return GROUP_DESCRIPTIONS[group][level]
}

export const getRootAdaptiveDescription = (state?: UsageState | null): string =>
  getAdaptiveDescription('root', state)

export const getFrontAdaptiveDescription = (
  state?: UsageState | null
): string => getAdaptiveDescription('front', state)

export const getAuthAdaptiveDescription = (state?: UsageState | null): string =>
  getAdaptiveDescription('auth', state)

export const getInngestAdaptiveDescription = (
  state?: UsageState | null
): string => getAdaptiveDescription('inngest', state)
