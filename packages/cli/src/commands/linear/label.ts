/**
 * Linear CLI label command - add or remove labels from an issue
 *
 * Usage:
 * - Add label: skill linear label ENG-123 --add "Bug"
 * - Remove label: skill linear label ENG-123 --remove "Bug"
 * - Add multiple: skill linear label ENG-123 --add "Bug" --add "Frontend"
 * - View labels: skill linear labels ENG (team key)
 * - JSON output: skill linear label ENG-123 --add "Bug" --json
 *
 * Labels are team-specific. Use `skill linear labels <team>` to list available labels.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import { hateoasWrap, issueActions, issueLinks } from './hateoas'

interface LabelOptions {
  add?: string[]
  remove?: string[]
}

/**
 * Command: skill linear label <issue-id>
 * Add or remove labels from an issue
 */
export async function modifyLabels(
  ctx: CommandContext,
  issueId: string,
  options: LabelOptions
): Promise<void> {
  const hasAdd = options.add && options.add.length > 0
  const hasRemove = options.remove && options.remove.length > 0

  if (!hasAdd && !hasRemove) {
    throw new CLIError({
      userMessage: 'No label changes specified.',
      suggestion: 'Use --add "Label" or --remove "Label".',
      exitCode: 1,
    })
  }

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

    // Get the team for label resolution
    const team = await issue.team
    if (!team) {
      throw new CLIError({
        userMessage: 'Could not determine team for issue.',
        exitCode: 1,
      })
    }

    // Fetch all available labels (team + workspace)
    const [teamLabels, workspaceLabels] = await Promise.all([
      client.issueLabels({ filter: { team: { id: { eq: team.id } } } }),
      client.issueLabels({ filter: { team: { null: true } } }),
    ])
    const allLabels = [...teamLabels.nodes, ...workspaceLabels.nodes]

    // Get current labels on the issue
    const currentLabelsConnection = await issue.labels()
    const currentLabelIds = new Set(
      currentLabelsConnection.nodes.map((l) => l.id)
    )

    // Process adds
    const labelsToAdd: string[] = []
    if (options.add) {
      for (const labelName of options.add) {
        const label = allLabels.find(
          (l) => l.name.toLowerCase() === labelName.toLowerCase()
        )
        if (!label) {
          throw new CLIError({
            userMessage: `Label not found: ${labelName}`,
            suggestion: `Use \`skill linear labels ${team.key} --json\` to list available labels.`,
            exitCode: 1,
          })
        }
        if (!currentLabelIds.has(label.id)) {
          labelsToAdd.push(label.id)
          currentLabelIds.add(label.id)
        }
      }
    }

    // Process removes
    const labelsToRemove: string[] = []
    if (options.remove) {
      for (const labelName of options.remove) {
        const label = currentLabelsConnection.nodes.find(
          (l) => l.name.toLowerCase() === labelName.toLowerCase()
        )
        if (!label) {
          // Label might not be on the issue - that's ok
          continue
        }
        labelsToRemove.push(label.id)
        currentLabelIds.delete(label.id)
      }
    }

    // Update the issue
    if (labelsToAdd.length > 0 || labelsToRemove.length > 0) {
      await client.updateIssue(issue.id, {
        labelIds: Array.from(currentLabelIds),
      })
    }

    // Fetch updated labels
    const updatedIssue = await client.issue(issueId)
    const updatedLabelsConnection = await updatedIssue?.labels()
    const updatedLabels = updatedLabelsConnection?.nodes || []

    const resultData = {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      added: options.add || [],
      removed: options.remove || [],
      currentLabels: updatedLabels.map((l) => ({ id: l.id, name: l.name })),
      success: true,
    }

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'label-result',
            command: `skill linear issue ${issue.identifier} --json`,
            data: resultData,
            links: issueLinks(issue.identifier, team.key),
            actions: issueActions(issue.identifier),
          }),
          null,
          2
        )
      )
      return
    }

    ctx.output.data('')
    ctx.output.data(`✅ Labels updated on ${issue.identifier}`)
    ctx.output.data('─'.repeat(50))

    if (options.add && options.add.length > 0) {
      ctx.output.data(`   Added: ${options.add.join(', ')}`)
    }
    if (options.remove && options.remove.length > 0) {
      ctx.output.data(`   Removed: ${options.remove.join(', ')}`)
    }

    ctx.output.data('')
    ctx.output.data(
      `   Current labels: ${updatedLabels.length > 0 ? updatedLabels.map((l) => l.name).join(', ') : '(none)'}`
    )
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to modify labels.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
