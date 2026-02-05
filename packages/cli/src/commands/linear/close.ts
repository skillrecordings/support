/**
 * Linear CLI close command - close an issue
 *
 * Usage:
 * - Close as done: skill linear close ENG-123
 * - Close as canceled: skill linear close ENG-123 --canceled
 * - JSON output: skill linear close ENG-123 --json
 *
 * By default, moves to "Done" state. Use --canceled for canceled state.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import { hateoasWrap, issueLinks, teamLinks } from './hateoas'

interface CloseOptions {
  canceled?: boolean
}

/**
 * Command: skill linear close <issue-id>
 * Close an issue
 */
export async function closeIssue(
  ctx: CommandContext,
  issueId: string,
  options: CloseOptions = {}
): Promise<void> {
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

    // Get the team
    const team = await issue.team
    if (!team) {
      throw new CLIError({
        userMessage: 'Could not determine team for issue.',
        exitCode: 1,
      })
    }

    // Find the appropriate close state
    const states = await team.states()
    const targetType = options.canceled ? 'canceled' : 'completed'
    const closeState = states.nodes.find((s) => s.type === targetType)

    if (!closeState) {
      throw new CLIError({
        userMessage: `No ${targetType} state found for team ${team.key}.`,
        suggestion: `Use \`skill linear states ${team.key}\` to see available states.`,
        exitCode: 1,
      })
    }

    // Get current state
    const currentState = await issue.state

    // Update the issue
    await client.updateIssue(issue.id, {
      stateId: closeState.id,
    })

    const resultData = {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      previousState: currentState?.name || null,
      newState: closeState.name,
      closeType: targetType,
      success: true,
    }

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'close-result',
            command: `skill linear issue ${issue.identifier} --json`,
            data: resultData,
            links: [
              ...issueLinks(issue.identifier, team.key),
              ...teamLinks(team.key),
            ],
          }),
          null,
          2
        )
      )
      return
    }

    const emoji = options.canceled ? '❌' : '✅'
    const verb = options.canceled ? 'Canceled' : 'Closed'

    ctx.output.data('')
    ctx.output.data(`${emoji} ${verb} ${issue.identifier}`)
    ctx.output.data('─'.repeat(50))
    ctx.output.data(`   Title: ${issue.title}`)
    ctx.output.data(`   From:  ${currentState?.name || 'Unknown'}`)
    ctx.output.data(`   To:    ${closeState.name}`)
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to close issue.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
