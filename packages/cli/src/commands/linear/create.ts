/**
 * Linear CLI create command - create a new issue
 *
 * Usage:
 * - Basic: skill linear create "Issue title"
 * - With description: skill linear create "Title" --description "Details"
 * - In specific team: skill linear create "Title" --team ENG
 * - With priority: skill linear create "Title" --priority 1
 * - With labels: skill linear create "Title" --label "Bug" --label "Frontend"
 * - With assignee: skill linear create "Title" --assignee user@example.com
 * - Full example: skill linear create "Fix login bug" --team ENG --priority 1 --label "Bug" --assignee me
 *
 * Priority values: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { requirePersonalKey } from '../../core/write-gate'
import { getLinearClient } from './client'
import { hateoasWrap, issueActions, issueLinks } from './hateoas'

interface CreateOptions {
  description?: string
  priority?: number
  team?: string
  label?: string[]
  assignee?: string
  project?: string
  estimate?: number
  dueDate?: string
}

/**
 * Command: skill linear create <title>
 * Create a new issue
 */
export async function createIssue(
  ctx: CommandContext,
  title: string,
  options: CreateOptions = {}
): Promise<void> {
  if (!title || title.trim().length === 0) {
    throw new CLIError({
      userMessage: 'Issue title is required.',
      suggestion: 'Usage: skill linear create "Issue title"',
      exitCode: 1,
    })
  }

  // Require personal API key for write operations
  requirePersonalKey('LINEAR_API_KEY')

  try {
    const client = getLinearClient()

    // Resolve team
    let teamId: string
    let teamKey: string
    const teams = await client.teams()

    if (options.team) {
      const team = teams.nodes.find(
        (t) =>
          t.key.toLowerCase() === options.team!.toLowerCase() ||
          t.name.toLowerCase() === options.team!.toLowerCase()
      )
      if (!team) {
        throw new CLIError({
          userMessage: `Team not found: ${options.team}`,
          suggestion:
            'Use `skill linear teams --json` to list available teams.',
        })
      }
      teamId = team.id
      teamKey = team.key
    } else {
      // Use first team as default
      const team = teams.nodes[0]
      if (!team) {
        throw new CLIError({
          userMessage: 'No teams found in Linear workspace.',
          exitCode: 1,
        })
      }
      teamId = team.id
      teamKey = team.key
    }

    // Resolve assignee
    let assigneeId: string | undefined
    if (options.assignee) {
      if (options.assignee.toLowerCase() === 'me') {
        const viewer = await client.viewer
        assigneeId = viewer.id
      } else {
        const users = await client.users()
        const user = users.nodes.find(
          (u) =>
            u.email?.toLowerCase() === options.assignee!.toLowerCase() ||
            u.name?.toLowerCase() === options.assignee!.toLowerCase()
        )
        if (!user) {
          throw new CLIError({
            userMessage: `User not found: ${options.assignee}`,
            suggestion:
              'Use `skill linear users --json` to list available users.',
          })
        }
        assigneeId = user.id
      }
    }

    // Resolve labels
    let labelIds: string[] | undefined
    if (options.label && options.label.length > 0) {
      const teamLabels = await client.issueLabels({
        filter: { team: { id: { eq: teamId } } },
      })
      const workspaceLabels = await client.issueLabels({
        filter: { team: { null: true } },
      })
      const allLabels = [...teamLabels.nodes, ...workspaceLabels.nodes]

      labelIds = []
      for (const labelName of options.label) {
        const label = allLabels.find(
          (l) => l.name.toLowerCase() === labelName.toLowerCase()
        )
        if (!label) {
          throw new CLIError({
            userMessage: `Label not found: ${labelName}`,
            suggestion: `Use \`skill linear labels ${teamKey} --json\` to list available labels.`,
          })
        }
        labelIds.push(label.id)
      }
    }

    // Resolve project
    let projectId: string | undefined
    if (options.project) {
      const projects = await client.projects()
      const project = projects.nodes.find(
        (p) =>
          p.id === options.project ||
          p.name.toLowerCase() === options.project!.toLowerCase()
      )
      if (!project) {
        throw new CLIError({
          userMessage: `Project not found: ${options.project}`,
          suggestion:
            'Use `skill linear projects --json` to list available projects.',
        })
      }
      projectId = project.id
    }

    const payload = await client.createIssue({
      teamId,
      title: title.trim(),
      description: options.description,
      priority: options.priority ?? 2,
      assigneeId,
      labelIds,
      projectId,
      estimate: options.estimate,
      dueDate: options.dueDate,
    })

    const issue = await payload.issue
    if (!issue) {
      throw new CLIError({
        userMessage: 'Failed to create issue - no issue returned.',
        exitCode: 1,
      })
    }

    const state = await issue.state
    const assignee = await issue.assignee

    const issueData = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || null,
      state: state?.name || null,
      priority: issue.priority,
      assignee: assignee
        ? { id: assignee.id, name: assignee.name, email: assignee.email }
        : null,
      team: { key: teamKey },
      url: issue.url,
      createdAt: issue.createdAt,
    }

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'issue-created',
            command: `skill linear issue ${issue.identifier} --json`,
            data: issueData,
            links: issueLinks(issue.identifier, teamKey),
            actions: issueActions(issue.identifier),
          }),
          null,
          2
        )
      )
      return
    }

    ctx.output.data('')
    ctx.output.data(`✅ Issue created: ${issue.identifier}`)
    ctx.output.data('─'.repeat(50))
    ctx.output.data(`   Title:    ${issue.title}`)
    ctx.output.data(`   Team:     ${teamKey}`)
    ctx.output.data(`   State:    ${state?.name || 'Backlog'}`)
    if (assignee) {
      ctx.output.data(`   Assignee: ${assignee.name}`)
    }
    ctx.output.data(`   URL:      ${issue.url}`)
    ctx.output.data('')
    ctx.output.data('   Next steps:')
    ctx.output.data(`     • View:    skill linear issue ${issue.identifier}`)
    ctx.output.data(
      `     • Assign:  skill linear assign ${issue.identifier} --to <email>`
    )
    ctx.output.data(
      `     • Comment: skill linear comment ${issue.identifier} --body "text"`
    )
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to create Linear issue.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
