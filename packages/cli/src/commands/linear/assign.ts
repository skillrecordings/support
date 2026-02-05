/**
 * Linear CLI assign command - assign or unassign an issue
 *
 * Usage:
 * - Assign to user: skill linear assign ENG-123 --to user@example.com
 * - Assign to self: skill linear assign ENG-123 --to me
 * - Unassign: skill linear assign ENG-123 --unassign
 * - JSON output: skill linear assign ENG-123 --to me --json
 *
 * Use `skill linear users --json` to find user emails.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { requirePersonalKey } from '../../core/write-gate'
import { getLinearClient } from './client'
import { hateoasWrap, issueActions, issueLinks } from './hateoas'

interface AssignOptions {
  to?: string
  unassign?: boolean
}

/**
 * Command: skill linear assign <issue-id>
 * Assign or unassign an issue
 */
export async function assignIssue(
  ctx: CommandContext,
  issueId: string,
  options: AssignOptions
): Promise<void> {
  if (options.to && options.unassign) {
    throw new CLIError({
      userMessage: 'Cannot use both --to and --unassign.',
      suggestion: 'Choose one: --to <email> OR --unassign',
      exitCode: 1,
    })
  }

  if (!options.to && !options.unassign) {
    throw new CLIError({
      userMessage: 'Missing assignment option.',
      suggestion:
        'Use --to <email> to assign or --unassign to remove assignee.',
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

    let assigneeId: string | null = null
    let assigneeName: string | null = null

    if (options.to) {
      // Resolve assignee
      if (options.to.toLowerCase() === 'me') {
        const viewer = await client.viewer
        assigneeId = viewer.id
        assigneeName = viewer.name
      } else {
        const users = await client.users()
        const user = users.nodes.find(
          (u) =>
            u.email?.toLowerCase() === options.to!.toLowerCase() ||
            u.name?.toLowerCase() === options.to!.toLowerCase()
        )
        if (!user) {
          throw new CLIError({
            userMessage: `User not found: ${options.to}`,
            suggestion:
              'Use `skill linear users --json` to list available users.',
            exitCode: 1,
          })
        }
        assigneeId = user.id
        assigneeName = user.name
      }
    }

    // Update the issue
    await client.updateIssue(issue.id, {
      assigneeId: assigneeId || undefined,
    })

    const team = await issue.team
    const resultData = {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      action: options.unassign ? 'unassigned' : 'assigned',
      assignee: assigneeName ? { id: assigneeId, name: assigneeName } : null,
      success: true,
    }

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'assign-result',
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
    if (options.unassign) {
      ctx.output.data(`✅ Unassigned ${issue.identifier}`)
    } else {
      ctx.output.data(`✅ Assigned ${issue.identifier} to ${assigneeName}`)
    }
    ctx.output.data('')
    ctx.output.data(`   View: skill linear issue ${issue.identifier}`)
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to assign issue.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
