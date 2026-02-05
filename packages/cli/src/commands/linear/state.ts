/**
 * Linear CLI state command - change issue workflow state
 *
 * Usage:
 * - Change state: skill linear state ENG-123 --state "In Progress"
 * - View available states: skill linear states ENG (team key)
 * - JSON output: skill linear state ENG-123 --state "Done" --json
 *
 * State names vary by team. Use `skill linear states <team>` to list available states.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import { hateoasWrap, issueActions, issueLinks } from './hateoas'

interface StateOptions {
  state: string
}

/**
 * Command: skill linear state <issue-id> --state "State Name"
 * Change issue workflow state
 */
export async function changeState(
  ctx: CommandContext,
  issueId: string,
  options: StateOptions
): Promise<void> {
  if (!options.state || options.state.trim().length === 0) {
    throw new CLIError({
      userMessage: 'State name is required.',
      suggestion: 'Usage: skill linear state ENG-123 --state "In Progress"',
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

    // Get the team for this issue
    const team = await issue.team
    if (!team) {
      throw new CLIError({
        userMessage: 'Could not determine team for issue.',
        exitCode: 1,
      })
    }

    // Find the workflow state
    const states = await team.states()
    const targetState = states.nodes.find(
      (s) => s.name.toLowerCase() === options.state.toLowerCase()
    )

    if (!targetState) {
      const availableStates = states.nodes.map((s) => s.name).join(', ')
      throw new CLIError({
        userMessage: `State not found: ${options.state}`,
        suggestion: `Available states for ${team.key}: ${availableStates}`,
        exitCode: 1,
      })
    }

    // Get current state for comparison
    const currentState = await issue.state

    // Update the issue
    await client.updateIssue(issue.id, {
      stateId: targetState.id,
    })

    const resultData = {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      previousState: currentState?.name || null,
      newState: targetState.name,
      stateType: targetState.type,
      success: true,
    }

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'state-change-result',
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
    ctx.output.data(`✅ ${issue.identifier} state changed`)
    ctx.output.data('─'.repeat(50))
    ctx.output.data(`   From: ${currentState?.name || 'Unknown'}`)
    ctx.output.data(`   To:   ${targetState.name}`)
    ctx.output.data('')
    ctx.output.data(`   View: skill linear issue ${issue.identifier}`)
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to change state.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
