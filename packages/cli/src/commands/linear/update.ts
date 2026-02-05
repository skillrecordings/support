/**
 * Linear CLI update command - update issue properties
 *
 * Usage:
 * - Update title: skill linear update ENG-123 --title "New title"
 * - Update priority: skill linear update ENG-123 --priority 1
 * - Update description: skill linear update ENG-123 --description "New description"
 * - Update estimate: skill linear update ENG-123 --estimate 3
 * - Update due date: skill linear update ENG-123 --due-date 2024-03-15
 * - Move to project: skill linear update ENG-123 --project "Q1 Goals"
 * - Multiple updates: skill linear update ENG-123 --priority 1 --estimate 3
 *
 * Priority values: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { requirePersonalKey } from '../../core/write-gate'
import { getLinearClient } from './client'
import { hateoasWrap, issueActions, issueLinks } from './hateoas'

interface UpdateOptions {
  title?: string
  description?: string
  priority?: number
  estimate?: number
  dueDate?: string
  project?: string
}

/**
 * Command: skill linear update <issue-id>
 * Update issue properties
 */
export async function updateIssue(
  ctx: CommandContext,
  issueId: string,
  options: UpdateOptions
): Promise<void> {
  // Check if any update was specified
  const hasUpdate = Object.values(options).some((v) => v !== undefined)
  if (!hasUpdate) {
    throw new CLIError({
      userMessage: 'No updates specified.',
      suggestion:
        'Use --title, --description, --priority, --estimate, --due-date, or --project.',
      exitCode: 1,
    })
  }

  // Require personal API key for write operations
  requirePersonalKey('LINEAR_API_KEY')

  try {
    const client = getLinearClient()

    // Fetch the issue
    const issue = await client.issue(issueId)
    if (!issue) {
      throw new CLIError({
        userMessage: `Issue not found: ${issueId}`,
        suggestion:
          'Use `skill linear issues --json` to list available issues.',
        exitCode: 1,
      })
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {}

    if (options.title) {
      updatePayload.title = options.title
    }

    if (options.description !== undefined) {
      updatePayload.description = options.description
    }

    if (options.priority !== undefined) {
      if (options.priority < 0 || options.priority > 4) {
        throw new CLIError({
          userMessage: 'Invalid priority value.',
          suggestion:
            'Priority must be 0-4: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None',
          exitCode: 1,
        })
      }
      updatePayload.priority = options.priority
    }

    if (options.estimate !== undefined) {
      updatePayload.estimate = options.estimate
    }

    if (options.dueDate !== undefined) {
      updatePayload.dueDate = options.dueDate
    }

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
          exitCode: 1,
        })
      }
      updatePayload.projectId = project.id
    }

    // Update the issue
    await client.updateIssue(issue.id, updatePayload)

    // Fetch updated issue
    const updatedIssue = await client.issue(issueId)
    const [state, assignee, team] = await Promise.all([
      updatedIssue?.state,
      updatedIssue?.assignee,
      updatedIssue?.team,
    ])

    const changes = Object.keys(options).filter(
      (k) => options[k as keyof UpdateOptions] !== undefined
    )

    const resultData = {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      changes,
      updated: {
        title: updatedIssue?.title,
        description: updatedIssue?.description || null,
        priority: updatedIssue?.priority,
        estimate: updatedIssue?.estimate || null,
        dueDate: updatedIssue?.dueDate || null,
        state: state?.name || null,
        assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
      },
      success: true,
    }

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'update-result',
            command: `skill linear issue ${issue.identifier} --json`,
            data: resultData,
            links: issueLinks(issue.identifier, team?.key),
            actions: issueActions(issue.identifier),
          }),
          null,
          2
        )
      )
      return
    }

    ctx.output.data('')
    ctx.output.data(`✅ Updated ${issue.identifier}`)
    ctx.output.data('─'.repeat(50))
    for (const change of changes) {
      const value = options[change as keyof UpdateOptions]
      ctx.output.data(`   ${change}: ${value}`)
    }
    ctx.output.data('')
    ctx.output.data(`   View: skill linear issue ${issue.identifier}`)
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to update issue.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
