/**
 * Plugin sync command — generates plugin.json and SKILL.md
 * for the skill-cli Front Inbox Manager Claude Code plugin.
 *
 * Usage:
 *   skill plugin-sync                    # Sync to packages/cli/plugin/
 *   skill plugin-sync --output ./out     # Custom output dir
 *   skill plugin-sync --json             # JSON output
 */

import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../core/context'
import { hateoasWrap } from './front/hateoas'

// ── Types ──

export interface PluginCommand {
  name: string
  description: string
  usage?: string
  options?: string[]
}

export interface PluginSkillMetadata {
  inboxAliases?: Record<string, string>
  hateoasEnabled?: boolean
  environment?: string[]
}

export interface PluginSkill {
  id: string
  name: string
  description: string
  commands: PluginCommand[]
  metadata?: PluginSkillMetadata
}

export interface PluginManifest {
  name: string
  version: string
  description: string
  author: string
  repository: string
  skills: PluginSkill[]
}

// ── Constants ──

/**
 * Default output directory for plugin artifacts, relative to packages/cli.
 */
export const PLUGIN_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../plugin'
)

/**
 * Canonical inbox alias → Front inbox ID mapping.
 * Derived from the DuckDB inboxes table and app registry.
 */
const INBOX_ALIASES: Record<string, string> = {
  'total-typescript': 'inb_3srbb',
  'epic-react': 'inb_1bwzr',
  egghead: 'inb_1c77r',
  'epic-ai': 'inb_jqs11',
  'pro-tailwind': 'inb_3pqh3',
  'just-javascript': 'inb_2odqf',
  'ai-hero': 'inb_4bj7r',
  'testing-accessibility': 'inb_3bkef',
  'epic-web': 'inb_jqs2t',
  'egghead-alt': 'inb_1zh3b',
  'pro-nextjs': 'inb_43olj',
}

/**
 * Short aliases (convenience shorthands).
 */
const SHORT_ALIASES: Record<string, string> = {
  tt: 'inb_3srbb',
  tailwind: 'inb_3pqh3',
  aihero: 'inb_4bj7r',
  ew: 'inb_jqs2t',
  egg: 'inb_1c77r',
  jj: 'inb_2odqf',
  ta: 'inb_3bkef',
}

// ── Generators ──

/**
 * Generate the plugin.json manifest object.
 */
export function generatePluginManifest(): PluginManifest {
  return {
    name: 'skill-cli-front-inbox-manager',
    version: '0.3.0',
    description:
      'Claude Code plugin for the Skill Recordings Front Inbox Manager CLI. Provides inbox management, conversation triage, archival, tagging, reporting, and daily briefing workflows.',
    author: 'Skill Recordings',
    repository: 'https://github.com/skillrecordings/support-cli-rearchitect',
    skills: [
      {
        id: 'front-inbox-manager',
        name: 'Front Inbox Manager',
        description:
          'Manage Front inboxes, conversations, tags, archival, triage, and reporting via the skill CLI.',
        commands: [
          {
            name: 'front inbox',
            description:
              'List all inboxes, or list conversations in a specific inbox with filtering',
            usage:
              'skill front inbox [inbox-name-or-id] [--status unassigned] [--tag "500 Error"] [--limit 50] [--json]',
            options: [
              '--json',
              '--status <status>',
              '--tag <tag>',
              '--limit <n>',
            ],
          },
          {
            name: 'front message',
            description:
              'Fetch full message details (body, author, recipients, attachments)',
            usage: 'skill front message <id> [--json]',
            options: ['--json'],
          },
          {
            name: 'front conversation',
            description:
              'Fetch conversation details (status, tags, assignee) with optional message history',
            usage: 'skill front conversation <id> [--messages] [--json]',
            options: ['--json', '-m, --messages'],
          },
          {
            name: 'front triage',
            description:
              'Categorize inbox conversations as actionable, noise, or spam with optional auto-archive',
            usage:
              'skill front triage --inbox <id> [--status unassigned] [--auto-archive] [--json]',
            options: [
              '-i, --inbox <id>',
              '-s, --status <status>',
              '--auto-archive',
              '--json',
            ],
          },
          {
            name: 'front report',
            description:
              'Generate forensics report for an inbox (volume, tags, senders, unresolved)',
            usage: 'skill front report --inbox <id> [--days 30] [--json]',
            options: ['-i, --inbox <id>', '-d, --days <n>', '--json'],
          },
          {
            name: 'front archive',
            description: 'Archive one or more conversations by ID',
            usage: 'skill front archive <id> [ids...] [--json]',
            options: ['--json'],
          },
          {
            name: 'front bulk-archive',
            description:
              'Bulk archive conversations matching filters (sender, tag, age, status)',
            usage:
              'skill front bulk-archive --inbox <id> [--sender <email>] [--subject <text>] [--status <status>] [--tag <name>] [--older-than <duration>] [--dry-run] [--json]',
            options: [
              '-i, --inbox <id>',
              '--sender <email>',
              '--subject <text>',
              '--status <status>',
              '--tag <name>',
              '--older-than <duration>',
              '--dry-run',
              '--json',
            ],
          },
          {
            name: 'front tags list',
            description:
              'List all tags with conversation counts, optionally filtered to unused',
            usage: 'skill front tags list [--unused] [--json]',
            options: ['--json', '--unused'],
          },
          {
            name: 'front tags delete',
            description: 'Delete a tag by ID with optional force flag',
            usage: 'skill front tags delete <id> [--force]',
            options: ['-f, --force'],
          },
          {
            name: 'front tags rename',
            description: 'Rename a tag',
            usage: 'skill front tags rename <id> <name>',
          },
          {
            name: 'front tags cleanup',
            description:
              'Clean up tags: delete duplicates, merge case variants, remove obsolete, create missing standard tags',
            usage: 'skill front tags cleanup [--execute]',
            options: ['--execute'],
          },
          {
            name: 'front teammates',
            description: 'List all teammates in the workspace',
            usage: 'skill front teammates [--json]',
            options: ['--json'],
          },
          {
            name: 'front teammate',
            description: 'Get teammate details by ID',
            usage: 'skill front teammate <id> [--json]',
            options: ['--json'],
          },
          {
            name: 'front pull',
            description:
              'Export conversations to JSON for eval datasets with filtering',
            usage:
              'skill front pull --inbox <id> [--limit <n>] [--output <file>] [--filter <term>] [--json]',
            options: [
              '-i, --inbox <id>',
              '-l, --limit <n>',
              '-o, --output <file>',
              '-f, --filter <term>',
              '--json',
            ],
          },
        ],
        metadata: {
          inboxAliases: { ...INBOX_ALIASES, ...SHORT_ALIASES },
          hateoasEnabled: true,
          environment: ['FRONT_API_TOKEN'],
        },
      },
    ],
  }
}

/**
 * Generate the comprehensive SKILL.md document.
 */
export function generateSkillDoc(): string {
  const lines: string[] = []

  const push = (...args: string[]) => {
    for (const line of args) lines.push(line)
  }

  // ── Frontmatter ──
  push(
    '---',
    'name: skill-cli-front-inbox-manager',
    'description: Claude Code plugin for managing Front inboxes, conversations, tags, triage, archival, and reporting via the Skill Recordings CLI.',
    'version: 0.3.0',
    '---',
    ''
  )

  // ── Title & overview ──
  push(
    '# Skill CLI Front Inbox Manager',
    '',
    'A Claude Code plugin skill for the **Skill Recordings Support Agent CLI**.',
    'Provides full Front inbox management: listing inboxes, reading messages &',
    'conversations, triaging noise vs actionable items, bulk archival, tag',
    'governance, forensics reporting, and eval-dataset export.',
    '',
    '**Repo:** `skillrecordings/support-cli-rearchitect`',
    '**Package:** `packages/cli`',
    '**CLI prefix:** `skill front …`',
    ''
  )

  // ── Quick Start ──
  push(
    '## Quick Start',
    '',
    '```bash',
    'cd packages/cli',
    '',
    '# List all inboxes',
    'bun src/index.ts front inbox',
    '',
    '# List conversations in Total TypeScript inbox',
    'bun src/index.ts front inbox inb_3srbb --json',
    '',
    '# Triage unassigned conversations',
    'bun src/index.ts front triage --inbox inb_3srbb --json',
    '',
    '# Generate a 30-day report',
    'bun src/index.ts front report --inbox inb_3srbb --days 30 --json',
    '```',
    ''
  )

  // ── Inbox Aliases ──
  push(
    '## Inbox Aliases',
    '',
    'The Skill Recordings platform manages multiple product properties, each',
    'with a dedicated Front inbox. Use aliases for convenience in commands.',
    '',
    '### Full Product Names',
    '',
    '| Alias | Inbox ID | Product |',
    '|-------|----------|---------|'
  )

  const productDescriptions: Record<string, string> = {
    'total-typescript': 'Total TypeScript (Matt Pocock)',
    'epic-react': 'Epic React / KCD Support (Kent C. Dodds)',
    egghead: 'egghead.io',
    'epic-ai': 'Epic AI',
    'pro-tailwind': 'Pro Tailwind (Simon Vrachliotis)',
    'just-javascript': 'Just JavaScript (Dan Abramov)',
    'ai-hero': 'AI Hero (Chance Strickland)',
    'testing-accessibility': 'Testing Accessibility (Marcy Sutton)',
    'epic-web': 'Epic Web Dev (Kent C. Dodds)',
    'egghead-alt': 'egghead.io (alt inbox)',
    'pro-nextjs': 'Pro Next.js (Jack Herrington)',
  }

  for (const [alias, inboxId] of Object.entries(INBOX_ALIASES)) {
    const desc = productDescriptions[alias] ?? alias
    push(`| \`${alias}\` | \`${inboxId}\` | ${desc} |`)
  }

  push(
    '',
    '### Short Aliases',
    '',
    '| Short | Expands To | Inbox ID |',
    '|-------|------------|----------|'
  )

  const shortExpansions: Record<string, string> = {
    tt: 'total-typescript',
    tailwind: 'pro-tailwind',
    aihero: 'ai-hero',
    ew: 'epic-web',
    egg: 'egghead',
    jj: 'just-javascript',
    ta: 'testing-accessibility',
  }

  for (const [short, inboxId] of Object.entries(SHORT_ALIASES)) {
    const expandsTo = shortExpansions[short] ?? short
    push(`| \`${short}\` | \`${expandsTo}\` | \`${inboxId}\` |`)
  }

  push('')

  // ── Command Reference ──
  push(
    '## Command Reference',
    '',
    'All commands are prefixed with `skill front`. Every command supports',
    '`--json` for machine-readable output with HATEOAS links.',
    ''
  )

  // --- front inbox ---
  push(
    '### `skill front inbox`',
    '',
    'List all inboxes or list conversations in a specific inbox.',
    '',
    '```bash',
    '# List all inboxes',
    'skill front inbox',
    'skill front inbox --json',
    '',
    '# List conversations in a specific inbox',
    'skill front inbox inb_3srbb',
    'skill front inbox inb_3srbb --json',
    '',
    '# Filter by status',
    'skill front inbox inb_3srbb --status unassigned',
    '',
    '# Filter by tag',
    'skill front inbox inb_3srbb --tag "500 Error"',
    '',
    '# Limit results',
    'skill front inbox inb_3srbb --limit 25',
    '```',
    '',
    '**Options:**',
    '| Option | Description |',
    '|--------|-------------|',
    '| `--json` | JSON output with HATEOAS links |',
    '| `--status <status>` | Filter: `unassigned`, `assigned`, `archived` |',
    '| `--tag <tag>` | Filter by tag name |',
    '| `--limit <n>` | Max results (default 50) |',
    '',
    '**JSON response type:** `inbox-list` or `conversation-list`',
    ''
  )

  // --- front message ---
  push(
    '### `skill front message`',
    '',
    'Fetch full message details from the Front API.',
    '',
    '```bash',
    'skill front message msg_xxx',
    'skill front message msg_xxx --json',
    '```',
    '',
    '**Returned fields:** id, type, subject, created_at, author, recipients, body (HTML + text preview), attachments.',
    '',
    '**JSON response type:** `message`',
    ''
  )

  // --- front conversation ---
  push(
    '### `skill front conversation`',
    '',
    'Fetch conversation details with optional full message history.',
    '',
    '```bash',
    '# Basic details (status, tags, assignee)',
    'skill front conversation cnv_xxx',
    '',
    '# Include full message history',
    'skill front conversation cnv_xxx --messages',
    'skill front conversation cnv_xxx -m --json',
    '```',
    '',
    '**Options:**',
    '| Option | Description |',
    '|--------|-------------|',
    '| `-m, --messages` | Include full message thread |',
    '| `--json` | JSON output |',
    '',
    '**Returned fields:** id, subject, status, created_at, recipient, assignee, tags, messages (if `-m`).',
    '',
    '**JSON response type:** `conversation`',
    ''
  )

  // --- front triage ---
  push(
    '### `skill front triage`',
    '',
    'Categorize inbox conversations as **actionable**, **noise**, or **spam**',
    'using heuristic rules (sender patterns, subject keywords, etc.).',
    '',
    '```bash',
    '# Triage unassigned conversations (default)',
    'skill front triage --inbox inb_3srbb',
    '',
    '# Triage assigned conversations',
    'skill front triage --inbox inb_3srbb --status assigned',
    '',
    '# Auto-archive noise and spam',
    'skill front triage --inbox inb_3srbb --auto-archive',
    '',
    '# JSON output for programmatic processing',
    'skill front triage --inbox inb_3srbb --json',
    '```',
    '',
    '**Options:**',
    '| Option | Description |',
    '|--------|-------------|',
    '| `-i, --inbox <id>` | **(required)** Inbox ID to triage |',
    '| `-s, --status <status>` | Status filter (default: `unassigned`) |',
    '| `--auto-archive` | Archive noise + spam automatically |',
    '| `--json` | JSON output |',
    '',
    '**Category rules:**',
    '- **Noise:** `noreply`, `mailer-daemon`, delivery failures, auto-replies, automated reports, certificate notifications',
    '- **Spam:** partnership pitches, SEO spam, guest post requests, marketing emails',
    '- **Actionable:** everything else (real support issues)',
    '',
    '**JSON response type:** `triage-result`',
    ''
  )

  // --- front report ---
  push(
    '### `skill front report`',
    '',
    'Generate a forensics report for an inbox: volume by week, tag breakdown,',
    'top senders, and unresolved issues.',
    '',
    '```bash',
    '# Default: last 30 days',
    'skill front report --inbox inb_3srbb',
    '',
    '# Last 60 days',
    'skill front report --inbox inb_3srbb --days 60',
    '',
    '# JSON output',
    'skill front report --inbox inb_3srbb --json',
    '```',
    '',
    '**Options:**',
    '| Option | Description |',
    '|--------|-------------|',
    '| `-i, --inbox <id>` | **(required)** Inbox ID |',
    '| `-d, --days <n>` | Report window in days (default: 30) |',
    '| `--json` | JSON output |',
    '',
    '**Report sections:**',
    '- Overview (total, by-status breakdown, date range)',
    '- Volume by week (histogram)',
    '- Tag breakdown (top 15)',
    '- Top senders (top 10)',
    '- Unresolved issues (unassigned, newest first)',
    '',
    '**JSON response type:** `report`',
    ''
  )

  // --- front archive ---
  push(
    '### `skill front archive`',
    '',
    'Archive one or more conversations by ID.',
    '',
    '```bash',
    '# Single conversation',
    'skill front archive cnv_xxx',
    '',
    '# Multiple conversations',
    'skill front archive cnv_1 cnv_2 cnv_3',
    '',
    '# JSON output',
    'skill front archive cnv_xxx --json',
    '```',
    '',
    '**JSON response type:** `archive-result`',
    '',
    '> ⚠️ **Destructive.** Archived conversations can be restored from Front but are removed from the active inbox.',
    ''
  )

  // --- front bulk-archive ---
  push(
    '### `skill front bulk-archive`',
    '',
    'Bulk archive conversations matching filter criteria. Always preview with',
    '`--dry-run` first.',
    '',
    '```bash',
    '# Preview matches (dry run)',
    'skill front bulk-archive --inbox inb_3srbb --status unassigned --older-than 30d --dry-run',
    '',
    '# Filter by sender',
    'skill front bulk-archive --inbox inb_3srbb --sender "mailer-daemon" --dry-run',
    '',
    '# Filter by subject',
    'skill front bulk-archive --inbox inb_3srbb --subject "Daily Report" --dry-run',
    '',
    '# Filter by tag',
    'skill front bulk-archive --inbox inb_3srbb --tag "spam" --dry-run',
    '',
    '# Execute (remove --dry-run)',
    'skill front bulk-archive --inbox inb_3srbb --tag "spam"',
    '',
    '# JSON output',
    'skill front bulk-archive --inbox inb_3srbb --sender "noreply" --dry-run --json',
    '```',
    '',
    '**Options:**',
    '| Option | Description |',
    '|--------|-------------|',
    '| `-i, --inbox <id>` | Inbox ID |',
    '| `--sender <email>` | Filter by sender email (contains) |',
    '| `--subject <text>` | Filter by subject (contains) |',
    '| `--status <status>` | Filter by status |',
    '| `--tag <name>` | Filter by tag name (contains) |',
    '| `--older-than <duration>` | Age filter: `30d`, `7d`, `24h`, `60m` |',
    '| `--dry-run` | Preview without archiving |',
    '| `--json` | JSON output |',
    '',
    '> ⚠️ **Destructive.** Always use `--dry-run` first. At least one filter is required.',
    '',
    '**JSON response type:** `bulk-archive-result`',
    ''
  )

  // --- front tags ---
  push(
    '### `skill front tags`',
    '',
    'Tag management: list, delete, rename, and clean up tags.',
    '',
    '```bash',
    '# List all tags with conversation counts',
    'skill front tags list',
    'skill front tags list --json',
    '',
    '# Show only unused tags (0 conversations)',
    'skill front tags list --unused',
    '',
    '# Delete a tag',
    'skill front tags delete tag_xxx',
    'skill front tags delete tag_xxx --force  # skip confirmation',
    '',
    '# Rename a tag',
    'skill front tags rename tag_xxx "new-name"',
    '',
    '# Cleanup: dry-run (show plan without executing)',
    'skill front tags cleanup',
    '',
    '# Cleanup: execute changes',
    'skill front tags cleanup --execute',
    '```',
    '',
    '**Cleanup actions:**',
    '- Delete exact duplicate tags (keep the one with most conversations)',
    '- Rename case variants to canonical lowercase-hyphenated form',
    '- Delete obsolete tags (old date tags, Gmail import artifacts)',
    '- Create missing standard category tags from the tag registry',
    '',
    '**JSON response type:** `tag-list`',
    ''
  )

  // --- front teammates ---
  push(
    '### `skill front teammates`',
    '',
    'List all teammates in the Front workspace.',
    '',
    '```bash',
    'skill front teammates',
    'skill front teammates --json',
    '```',
    '',
    '**JSON response type:** `teammate-list`',
    ''
  )

  // --- front teammate ---
  push(
    '### `skill front teammate`',
    '',
    'Get a specific teammate by ID.',
    '',
    '```bash',
    'skill front teammate tea_xxx',
    'skill front teammate tea_xxx --json',
    '```',
    '',
    '**JSON response type:** `teammate`',
    ''
  )

  // --- front pull ---
  push(
    '### `skill front pull`',
    '',
    'Export conversations from an inbox to JSON for eval datasets.',
    'Extracts trigger messages, conversation history, and inferred categories.',
    '',
    '```bash',
    '# Pull 50 conversations (default)',
    'skill front pull --inbox inb_3srbb',
    '',
    '# Pull 100 and save to file',
    'skill front pull --inbox inb_3srbb --limit 100 --output data/front-conversations.json',
    '',
    '# Filter by subject/tag',
    'skill front pull --inbox inb_3srbb --filter "refund"',
    '',
    '# JSON output',
    'skill front pull --inbox inb_3srbb --json',
    '```',
    '',
    '**Options:**',
    '| Option | Description |',
    '|--------|-------------|',
    '| `-i, --inbox <id>` | Inbox ID to pull from |',
    '| `-l, --limit <n>` | Max conversations (default 50) |',
    '| `-o, --output <file>` | Save to file |',
    '| `-f, --filter <term>` | Filter by subject/tag containing term |',
    '| `--json` | JSON output |',
    '',
    '**JSON response type:** `eval-dataset`',
    ''
  )

  // ── HATEOAS Chaining ──
  push(
    '## HATEOAS Chaining Rules',
    '',
    'All `--json` output wraps data in a HATEOAS envelope with `_links` and',
    '`_actions` for agent-driven navigation. This enables autonomous discovery',
    'of next steps without hardcoded command sequences.',
    '',
    '### Response Envelope',
    '',
    '```json',
    '{',
    '  "_type": "conversation-list",',
    '  "_command": "skill front inbox inb_3srbb --json",',
    '  "data": [ ... ],',
    '  "_links": [',
    '    {',
    '      "rel": "conversation",',
    '      "command": "skill front conversation cnv_xxx --json",',
    '      "description": "Support request about refund"',
    '    },',
    '    {',
    '      "rel": "inbox",',
    '      "command": "skill front inbox inb_3srbb --json",',
    '      "description": "Parent inbox"',
    '    }',
    '  ],',
    '  "_actions": [',
    '    {',
    '      "action": "bulk-archive",',
    '      "command": "skill front bulk-archive --inbox inb_3srbb --dry-run --json",',
    '      "description": "Bulk archive with filters",',
    '      "destructive": true',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '### Chaining Pattern',
    '',
    '```',
    'inbox list → pick inbox → conversation list → pick conversation → message details',
    '         ↘ triage    ↘ bulk-archive       ↘ archive',
    '         ↘ report                          ↘ tags',
    '```',
    '',
    '### Link Relations',
    '',
    '| `_type` | Available `_links.rel` | Available `_actions.action` |',
    '|---------|----------------------|----------------------------|',
    '| `inbox-list` | `inbox` (per inbox) | — |',
    '| `conversation-list` | `conversation` (per conv), `inbox` | `bulk-archive`, `triage` |',
    '| `conversation` | `self`, `messages`, `inbox` | `archive`, `tags` |',
    '| `message` | `self`, `conversation` | — |',
    '| `triage-result` | — | `bulk-archive-noise`, `bulk-archive` |',
    '| `report` | `inbox`, `unresolved` (per issue) | `triage`, `bulk-archive` |',
    '| `tag-list` | `tag` (per tag) | `cleanup` |',
    '| `teammate-list` | `teammate` (per teammate) | — |',
    '| `archive-result` | — | — |',
    '| `bulk-archive-result` | — | — |',
    '| `eval-dataset` | — | — |',
    '',
    '### Agent Rule',
    '',
    '**Always follow `_links` and `_actions` from the previous response** rather',
    'than constructing commands from scratch. This ensures correct IDs propagate',
    'through the chain and destructive actions are properly flagged.',
    '',
    '### Destructive Action Safety',
    '',
    'Actions with `"destructive": true` should always be confirmed before',
    'execution. Use `--dry-run` where available to preview effects first.',
    ''
  )

  // ── Daily Briefing Workflow ──
  push(
    '## Daily Briefing Workflow',
    '',
    'A recommended daily workflow for checking inbox health across all properties.',
    '',
    '### Morning Check (Full)',
    '',
    '```bash',
    '# 1. List all inboxes — check which have conversations',
    'skill front inbox --json',
    '',
    '# 2. For each active inbox, run a report (last 24h or 7d)',
    'skill front report --inbox inb_3srbb --days 7 --json   # Total TypeScript',
    'skill front report --inbox inb_4bj7r --days 7 --json   # AI Hero',
    'skill front report --inbox inb_jqs2t --days 7 --json   # Epic Web',
    '',
    '# 3. Triage the inbox with highest unassigned count',
    'skill front triage --inbox inb_3srbb --json',
    '',
    '# 4. Auto-archive noise/spam from triage results',
    'skill front triage --inbox inb_3srbb --auto-archive',
    '',
    '# 5. Review actionable conversations',
    '# (Follow _links from triage result to drill into specific conversations)',
    'skill front conversation cnv_xxx --messages --json',
    '```',
    '',
    '### Quick Check (Abbreviated)',
    '',
    '```bash',
    '# 1. Inboxes overview',
    'skill front inbox --json',
    '',
    '# 2. Triage highest-volume inbox',
    'skill front triage --inbox inb_3srbb --json',
    '',
    '# 3. Bulk-archive obvious noise (30+ days old, unassigned)',
    'skill front bulk-archive --inbox inb_3srbb --status unassigned --older-than 30d --dry-run --json',
    '```',
    '',
    '### Weekly Maintenance',
    '',
    '```bash',
    '# 1. Full 30-day report for each property',
    'skill front report --inbox inb_3srbb --days 30 --json',
    '',
    '# 2. Tag cleanup — dry run first, then execute',
    'skill front tags cleanup',
    'skill front tags cleanup --execute',
    '',
    '# 3. Review unused tags',
    'skill front tags list --unused --json',
    '',
    '# 4. Pull fresh eval dataset',
    'skill front pull --inbox inb_3srbb --limit 200 --output data/eval-dataset.json',
    '```',
    ''
  )

  // ── Environment ──
  push(
    '## Environment',
    '',
    '### Required',
    '',
    '| Variable | Description |',
    '|----------|-------------|',
    '| `FRONT_API_TOKEN` | Front API token with read/write access to inboxes, conversations, tags, and teammates |',
    '',
    '### Setup',
    '',
    '```bash',
    '# Set in shell',
    'export FRONT_API_TOKEN="your-token-here"',
    '',
    '# Or in .env.local at repo root or packages/cli',
    'echo "FRONT_API_TOKEN=your-token-here" >> .env.local',
    '```',
    '',
    '### Using agent-secrets (Recommended)',
    '',
    '```bash',
    '# Lease token with time-bounded TTL',
    'export FRONT_API_TOKEN=$(secrets lease front_api_token --ttl 1h --client-id "front-briefing")',
    '',
    '# Or use exec for auto-cleanup',
    'secrets exec -- bun src/index.ts front inbox --json',
    '```',
    ''
  )

  // ── Plugin Sync ──
  push(
    '## Plugin Sync',
    '',
    'Regenerate this SKILL.md and plugin.json from source:',
    '',
    '```bash',
    'skill plugin-sync',
    'skill plugin-sync --output ./custom-dir',
    'skill plugin-sync --json',
    '```',
    '',
    'This ensures the plugin manifest and skill doc stay in sync with the',
    'actual CLI command definitions.',
    ''
  )

  // ── JSON Output Format ──
  push(
    '## JSON Output Format',
    '',
    'All commands accept `--json` for machine-readable output. Non-JSON commands',
    'produce human-readable tables and summaries.',
    '',
    '```bash',
    '# Pipe JSON output to jq for filtering',
    'skill front inbox inb_3srbb --json | jq ".data[] | select(.status == \\"unassigned\\")"',
    '',
    '# Extract conversation IDs',
    'skill front inbox inb_3srbb --json | jq ".data[].id"',
    '',
    '# Get HATEOAS links',
    'skill front inbox inb_3srbb --json | jq "._links"',
    '```',
    '',
    '### Global Options',
    '',
    '| Option | Description |',
    '|--------|-------------|',
    '| `-f, --format <format>` | Output format: `json`, `text`, `table` |',
    '| `-v, --verbose` | Enable verbose output (progress, debug info) |',
    '| `-q, --quiet` | Suppress non-error output |',
    ''
  )

  // ── Error Handling ──
  push(
    '## Error Handling',
    '',
    'All commands use structured `CLIError` with:',
    '- `userMessage` — what went wrong',
    '- `suggestion` — how to fix it',
    '- `exitCode` — non-zero on failure',
    '',
    'Common errors:',
    '',
    '| Error | Cause | Fix |',
    '|-------|-------|-----|',
    '| `FRONT_API_TOKEN environment variable is required` | Missing token | Set `FRONT_API_TOKEN` |',
    '| `Inbox not found` | Invalid inbox ID/name | Run `skill front inbox` to list |',
    '| `At least one filter is required` | `bulk-archive` without filters | Add `--sender`, `--tag`, etc. |',
    '| `Failed to fetch Front message` | Invalid message ID or API error | Verify ID format (`msg_xxx`) |',
    ''
  )

  // ── Architecture Notes ──
  push(
    '## Architecture Notes',
    '',
    '- **Instrumented Client:** All Front API calls go through `createInstrumentedFrontClient`',
    '  which adds observability and rate limiting.',
    '- **HATEOAS Wrapper:** `hateoasWrap()` in `src/commands/front/hateoas.ts` provides',
    '  the `_links`/`_actions` envelope for every JSON response.',
    '- **CommandContext:** All commands receive a `CommandContext` with stdout/stderr',
    '  streams, output formatter, secrets provider, and abort signal.',
    '- **Output Formatter:** Three modes — `JsonFormatter`, `TextFormatter`, `TableFormatter`.',
    '  JSON goes to stdout; messages, errors, and progress go to stderr.',
    '- **Error Pattern:** Catch errors → wrap in `CLIError` → format with `formatError()`',
    '  → write to stderr → set `process.exitCode`.',
    ''
  )

  return lines.join('\n')
}

// ── Sync Command ──

interface SyncOptions {
  outputDir?: string
  json?: boolean
}

/**
 * Write plugin.json and SKILL.md to the target directory.
 */
export async function syncPlugin(
  ctx: CommandContext,
  options: SyncOptions = {}
): Promise<void> {
  const outputDir = options.outputDir ?? PLUGIN_DIR
  const outputJson = options.json === true || ctx.format === 'json'

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true })

  // Generate artifacts
  const manifest = generatePluginManifest()
  const skillDoc = generateSkillDoc()

  // Write files
  const pluginJsonPath = join(outputDir, 'plugin.json')
  const skillMdPath = join(outputDir, 'SKILL.md')

  writeFileSync(pluginJsonPath, JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(skillMdPath, skillDoc)

  // Output
  if (outputJson) {
    ctx.output.data(
      hateoasWrap({
        type: 'plugin-sync-result',
        command: 'skill plugin-sync --json',
        data: {
          pluginName: manifest.name,
          version: manifest.version,
          files: [
            { path: pluginJsonPath, type: 'plugin.json' },
            { path: skillMdPath, type: 'SKILL.md' },
          ],
          skillCount: manifest.skills.length,
          commandCount: manifest.skills.reduce(
            (acc, s) => acc + s.commands.length,
            0
          ),
        },
      })
    )
  } else {
    ctx.output.data(`\n✅ Plugin synced to ${outputDir}`)
    ctx.output.data(
      `   📄 plugin.json — ${manifest.skills.length} skill(s), ${manifest.skills.reduce((acc, s) => acc + s.commands.length, 0)} command(s)`
    )
    ctx.output.data(`   📝 SKILL.md — ${skillDoc.split('\n').length} lines`)
    ctx.output.data('')
  }
}

/**
 * Register the plugin-sync command with Commander.
 */
export function registerPluginSyncCommand(program: Command): void {
  program
    .command('plugin-sync')
    .description(
      'Generate plugin.json and SKILL.md for the Front Inbox Manager Claude Code plugin'
    )
    .option(
      '-o, --output <dir>',
      'Output directory (default: packages/cli/plugin/)'
    )
    .option('--json', 'JSON output')
    .action(
      async (
        options: { output?: string; json?: boolean },
        command: Command
      ) => {
        const opts =
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals()
            : {
                ...command.parent?.opts(),
                ...command.opts(),
              }
        const ctx = await createContext({
          format: options.json ? 'json' : opts.format,
          verbose: opts.verbose,
          quiet: opts.quiet,
        })
        await syncPlugin(ctx, {
          outputDir: options.output,
          json: options.json,
        })
      }
    )
}
