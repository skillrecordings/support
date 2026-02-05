/**
 * Linear CLI commands for comprehensive issue management
 *
 * Full-featured Linear integration with HATEOAS support for agent discoverability.
 * JSON output includes _links and _actions showing available next operations.
 *
 * QUICK START:
 *   skill linear my                    # Your assigned issues
 *   skill linear issues --team ENG     # Team's issues
 *   skill linear create "Title"        # Create issue
 *   skill linear issue ENG-123         # View issue
 *   skill linear search "query"        # Search issues
 *
 * ISSUE MANAGEMENT:
 *   skill linear create "Title" [--team ENG] [--assignee me] [--priority 1]
 *   skill linear update ENG-123 --title "New" --priority 1
 *   skill linear assign ENG-123 --to user@example.com
 *   skill linear state ENG-123 --state "In Progress"
 *   skill linear close ENG-123
 *   skill linear label ENG-123 --add "Bug"
 *   skill linear link ENG-123 --blocks ENG-456
 *
 * COMMENTS:
 *   skill linear comment ENG-123 --body "Comment text"
 *   skill linear comments ENG-123
 *
 * DISCOVERY:
 *   skill linear teams
 *   skill linear states ENG
 *   skill linear labels ENG
 *   skill linear users
 *   skill linear projects
 *
 * All commands support --json for machine-readable output with HATEOAS links.
 */

import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { assignIssue } from './assign'
import { closeIssue } from './close'
import { addComment } from './comment'
import { listComments } from './comments'
import { createIssue } from './create'
import { getIssue } from './get'
import { modifyLabels } from './label'
import { listLabels } from './labels'
import { linkIssues } from './link'
import { listIssues } from './list'
import { listMyIssues } from './my'
import { listProjects } from './projects'
import { searchIssues } from './search'
import { changeState } from './state'
import { listStates } from './states'
import { listTeams } from './teams'
import { updateIssue } from './update'
import { listUsers } from './users'

/**
 * Helper to create context from command
 */
async function contextFromCommand(
  command: Command,
  options: { json?: boolean }
): Promise<CommandContext> {
  const opts =
    typeof command.optsWithGlobals === 'function'
      ? command.optsWithGlobals()
      : {
          ...command.parent?.opts(),
          ...command.opts(),
        }
  return createContext({
    format: options.json ? 'json' : opts.format,
    verbose: opts.verbose,
    quiet: opts.quiet,
  })
}

/**
 * Register all Linear commands with Commander
 */
export function registerLinearCommands(program: Command): void {
  const linear = program.command('linear').description(
    `Linear issue tracking commands

Quick start:
  skill linear my                    Your assigned issues
  skill linear issues --team ENG     Team's issues
  skill linear create "Title"        Create issue
  skill linear search "query"        Search issues

All commands support --json for machine-readable output.`
  )

  // ─────────────────────────────────────────────────────────────
  // LISTING COMMANDS
  // ─────────────────────────────────────────────────────────────

  linear
    .command('issues')
    .description(
      `List issues with optional filters

Examples:
  skill linear issues                         All recent issues
  skill linear issues --team ENG              Filter by team
  skill linear issues --state "In Progress"   Filter by state
  skill linear issues --assignee me           Your issues
  skill linear issues --priority 0            Urgent only`
    )
    .option('--limit <number>', 'Maximum results (default: 20)', '20')
    .option('--team <key>', 'Filter by team key (e.g., ENG)')
    .option('--state <name>', 'Filter by state name')
    .option('--assignee <email>', 'Filter by assignee (or "me")')
    .option('--project <name>', 'Filter by project name')
    .option('--priority <0-4>', 'Filter by priority (0=urgent)')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await listIssues(ctx, {
        limit: parseInt(options.limit || '20', 10),
        team: options.team,
        state: options.state,
        assignee: options.assignee,
        project: options.project,
        priority:
          options.priority !== undefined
            ? parseInt(options.priority, 10)
            : undefined,
      })
    })

  linear
    .command('my')
    .description(
      `List your assigned issues (excludes completed/canceled)

Examples:
  skill linear my                     All your open issues
  skill linear my --state "In Progress"  Only in-progress
  skill linear my --limit 5           Just top 5`
    )
    .option('--limit <number>', 'Maximum results (default: 20)', '20')
    .option('--state <name>', 'Filter by state name')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await listMyIssues(ctx, {
        limit: parseInt(options.limit || '20', 10),
        state: options.state,
      })
    })

  linear
    .command('search')
    .description(
      `Search issues by text

Examples:
  skill linear search "authentication bug"
  skill linear search "login" --limit 10
  skill linear search "error" --json`
    )
    .argument('<query>', 'Search query')
    .option('--limit <number>', 'Maximum results (default: 20)', '20')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (query: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await searchIssues(ctx, query, {
        limit: parseInt(options.limit || '20', 10),
      })
    })

  // ─────────────────────────────────────────────────────────────
  // SINGLE ISSUE COMMANDS
  // ─────────────────────────────────────────────────────────────

  linear
    .command('issue')
    .description(
      `Get detailed info about an issue

Examples:
  skill linear issue ENG-123
  skill linear issue ENG-123 --json`
    )
    .argument('<id>', 'Issue identifier (e.g., ENG-123)')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (id: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await getIssue(ctx, id)
    })

  linear
    .command('create')
    .description(
      `Create a new issue

Examples:
  skill linear create "Fix login bug"
  skill linear create "Title" --team ENG --priority 1
  skill linear create "Task" --assignee me --label "Frontend"

Priority: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None`
    )
    .argument('<title>', 'Issue title')
    .option('--description <text>', 'Issue description (markdown)')
    .option('--team <key>', 'Team key (defaults to first team)')
    .option('--priority <0-4>', 'Priority level', '2')
    .option('--assignee <email>', 'Assignee email (or "me")')
    .option(
      '--label <name>',
      'Add label (repeatable)',
      (v, p: string[]) => [...p, v],
      [] as string[]
    )
    .option('--project <name>', 'Project name')
    .option('--estimate <points>', 'Estimate in points')
    .option('--due-date <YYYY-MM-DD>', 'Due date')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (title: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await createIssue(ctx, title, {
        description: options.description,
        priority: parseInt(options.priority || '2', 10),
        team: options.team,
        label: options.label,
        assignee: options.assignee,
        project: options.project,
        estimate: options.estimate ? parseInt(options.estimate, 10) : undefined,
        dueDate: options.dueDate,
      })
    })

  linear
    .command('update')
    .description(
      `Update issue properties

Examples:
  skill linear update ENG-123 --title "New title"
  skill linear update ENG-123 --priority 1 --estimate 3
  skill linear update ENG-123 --due-date 2024-03-15`
    )
    .argument('<id>', 'Issue identifier')
    .option('--title <text>', 'New title')
    .option('--description <text>', 'New description')
    .option('--priority <0-4>', 'New priority')
    .option('--estimate <points>', 'New estimate')
    .option('--due-date <YYYY-MM-DD>', 'New due date')
    .option('--project <name>', 'Move to project')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (id: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await updateIssue(ctx, id, {
        title: options.title,
        description: options.description,
        priority:
          options.priority !== undefined
            ? parseInt(options.priority, 10)
            : undefined,
        estimate:
          options.estimate !== undefined
            ? parseInt(options.estimate, 10)
            : undefined,
        dueDate: options.dueDate,
        project: options.project,
      })
    })

  linear
    .command('assign')
    .description(
      `Assign or unassign an issue

Examples:
  skill linear assign ENG-123 --to user@example.com
  skill linear assign ENG-123 --to me
  skill linear assign ENG-123 --unassign`
    )
    .argument('<id>', 'Issue identifier')
    .option('--to <email>', 'Assign to user email (or "me")')
    .option('--unassign', 'Remove assignee')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (id: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await assignIssue(ctx, id, {
        to: options.to,
        unassign: options.unassign,
      })
    })

  linear
    .command('state')
    .description(
      `Change issue workflow state

Examples:
  skill linear state ENG-123 --state "In Progress"
  skill linear state ENG-123 --state "Done"

Use 'skill linear states <team>' to see available states.`
    )
    .argument('<id>', 'Issue identifier')
    .requiredOption('--state <name>', 'Target state name')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (id: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await changeState(ctx, id, { state: options.state })
    })

  linear
    .command('close')
    .description(
      `Close an issue (mark as done or canceled)

Examples:
  skill linear close ENG-123              Close as done
  skill linear close ENG-123 --canceled   Cancel the issue`
    )
    .argument('<id>', 'Issue identifier')
    .option('--canceled', 'Close as canceled instead of done')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (id: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await closeIssue(ctx, id, { canceled: options.canceled })
    })

  linear
    .command('label')
    .description(
      `Add or remove labels from an issue

Examples:
  skill linear label ENG-123 --add "Bug"
  skill linear label ENG-123 --add "Bug" --add "Frontend"
  skill linear label ENG-123 --remove "WIP"

Use 'skill linear labels <team>' to see available labels.`
    )
    .argument('<id>', 'Issue identifier')
    .option(
      '--add <name>',
      'Add label (repeatable)',
      (v, p: string[]) => [...p, v],
      [] as string[]
    )
    .option(
      '--remove <name>',
      'Remove label (repeatable)',
      (v, p: string[]) => [...p, v],
      [] as string[]
    )
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (id: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await modifyLabels(ctx, id, {
        add: options.add,
        remove: options.remove,
      })
    })

  linear
    .command('link')
    .description(
      `Link issues together (dependencies, relations)

Examples:
  skill linear link ENG-123 --blocks ENG-456
  skill linear link ENG-123 --blocked-by ENG-456
  skill linear link ENG-123 --related ENG-456
  skill linear link ENG-123 --duplicate ENG-456`
    )
    .argument('<id>', 'Source issue identifier')
    .option('--blocks <id>', 'This issue blocks <id>')
    .option('--blocked-by <id>', 'This issue is blocked by <id>')
    .option('--related <id>', 'Related to <id>')
    .option('--duplicate <id>', 'Duplicate of <id>')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (id: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await linkIssues(ctx, id, {
        blocks: options.blocks,
        blockedBy: options.blockedBy,
        related: options.related,
        duplicate: options.duplicate,
      })
    })

  // ─────────────────────────────────────────────────────────────
  // COMMENTS
  // ─────────────────────────────────────────────────────────────

  linear
    .command('comment')
    .description(
      `Add a comment to an issue

Examples:
  skill linear comment ENG-123 --body "Great work!"
  skill linear comment ENG-123 --body "## Update\\n- Item 1\\n- Item 2"`
    )
    .argument('<id>', 'Issue identifier')
    .requiredOption('--body <text>', 'Comment text (supports markdown)')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (id: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await addComment(ctx, id, { body: options.body })
    })

  linear
    .command('comments')
    .description(
      `List comments on an issue

Examples:
  skill linear comments ENG-123
  skill linear comments ENG-123 --limit 10 --json`
    )
    .argument('<id>', 'Issue identifier')
    .option('--limit <number>', 'Maximum results (default: 50)', '50')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (id: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await listComments(ctx, id, {
        limit: parseInt(options.limit || '50', 10),
      })
    })

  // ─────────────────────────────────────────────────────────────
  // DISCOVERY / METADATA
  // ─────────────────────────────────────────────────────────────

  linear
    .command('teams')
    .description(
      `List all teams in your workspace

Examples:
  skill linear teams
  skill linear teams --json`
    )
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await listTeams(ctx)
    })

  linear
    .command('states')
    .description(
      `List workflow states for a team

Examples:
  skill linear states ENG
  skill linear states "Product" --json`
    )
    .argument('<team>', 'Team key or name')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (team: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await listStates(ctx, team)
    })

  linear
    .command('labels')
    .description(
      `List labels for a team

Examples:
  skill linear labels ENG
  skill linear labels ENG --json`
    )
    .argument('<team>', 'Team key or name')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (team: string, options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await listLabels(ctx, team)
    })

  linear
    .command('users')
    .description(
      `List workspace users

Examples:
  skill linear users
  skill linear users --json`
    )
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await listUsers(ctx)
    })

  linear
    .command('projects')
    .description(
      `List all projects

Examples:
  skill linear projects
  skill linear projects --limit 100 --json`
    )
    .option('--limit <number>', 'Maximum results (default: 50)', '50')
    .option('--json', 'Output as JSON with HATEOAS links')
    .action(async (options, command: Command) => {
      const ctx = await contextFromCommand(command, options)
      await listProjects(ctx, { limit: parseInt(options.limit || '50', 10) })
    })
}
