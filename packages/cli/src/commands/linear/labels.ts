/**
 * Linear CLI labels command - list labels for a team
 *
 * Usage:
 * - List team labels: skill linear labels ENG
 * - JSON output: skill linear labels ENG --json
 *
 * Shows both team-specific and workspace-level labels.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import { hateoasWrap, teamLinks } from './hateoas'

/**
 * Command: skill linear labels <team-key>
 * List labels for a team
 */
export async function listLabels(
  ctx: CommandContext,
  teamKey: string
): Promise<void> {
  if (!teamKey || teamKey.trim().length === 0) {
    throw new CLIError({
      userMessage: 'Team key is required.',
      suggestion:
        'Usage: skill linear labels ENG\nUse `skill linear teams` to list teams.',
      exitCode: 1,
    })
  }

  try {
    const client = getLinearClient()

    // Find the team
    const teams = await client.teams()
    const team = teams.nodes.find(
      (t) =>
        t.key.toLowerCase() === teamKey.toLowerCase() ||
        t.name.toLowerCase() === teamKey.toLowerCase()
    )

    if (!team) {
      throw new CLIError({
        userMessage: `Team not found: ${teamKey}`,
        suggestion: 'Use `skill linear teams --json` to list available teams.',
        exitCode: 1,
      })
    }

    // Fetch team and workspace labels
    const [teamLabels, workspaceLabels] = await Promise.all([
      client.issueLabels({ filter: { team: { id: { eq: team.id } } } }),
      client.issueLabels({ filter: { team: { null: true } } }),
    ])

    const teamLabelNodes = teamLabels.nodes || []
    const workspaceLabelNodes = workspaceLabels.nodes || []

    if (ctx.format === 'json') {
      const labelData = {
        team: { id: team.id, key: team.key, name: team.name },
        teamLabels: teamLabelNodes.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color,
          description: l.description || null,
        })),
        workspaceLabels: workspaceLabelNodes.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color,
          description: l.description || null,
        })),
        totalCount: teamLabelNodes.length + workspaceLabelNodes.length,
      }

      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'label-list',
            command: `skill linear labels ${team.key} --json`,
            data: labelData,
            links: teamLinks(team.key),
            actions: [
              {
                action: 'add-label',
                command: `skill linear label <issue-id> --add "<label-name>"`,
                description: 'Add a label to an issue',
              },
              {
                action: 'remove-label',
                command: `skill linear label <issue-id> --remove "<label-name>"`,
                description: 'Remove a label from an issue',
              },
            ],
          }),
          null,
          2
        )
      )
      return
    }

    ctx.output.data('')
    ctx.output.data(`🏷️  Labels for ${team.name} (${team.key})`)
    ctx.output.data('─'.repeat(60))

    if (teamLabelNodes.length > 0) {
      ctx.output.data('')
      ctx.output.data('   Team Labels:')
      for (const label of teamLabelNodes) {
        ctx.output.data(`      • ${label.name}`)
      }
    }

    if (workspaceLabelNodes.length > 0) {
      ctx.output.data('')
      ctx.output.data('   Workspace Labels:')
      for (const label of workspaceLabelNodes) {
        ctx.output.data(`      • ${label.name}`)
      }
    }

    if (teamLabelNodes.length === 0 && workspaceLabelNodes.length === 0) {
      ctx.output.data('')
      ctx.output.data('   No labels defined.')
    }

    ctx.output.data('')
    ctx.output.data('   Usage: skill linear label ENG-123 --add "Bug"')
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list labels.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
