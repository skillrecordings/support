/**
 * Linear CLI states command - list workflow states for a team
 *
 * Usage:
 * - List states: skill linear states ENG
 * - JSON output: skill linear states ENG --json
 *
 * Each team has its own workflow states. Use this to discover
 * available states before changing an issue's state.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import { hateoasWrap, teamLinks } from './hateoas'

/**
 * State type emoji mapping
 */
const STATE_TYPE_EMOJI: Record<string, string> = {
  backlog: '📋',
  unstarted: '⚪',
  started: '🔵',
  completed: '✅',
  canceled: '❌',
  triage: '📥',
}

/**
 * Command: skill linear states <team-key>
 * List workflow states for a team
 */
export async function listStates(
  ctx: CommandContext,
  teamKey: string
): Promise<void> {
  if (!teamKey || teamKey.trim().length === 0) {
    throw new CLIError({
      userMessage: 'Team key is required.',
      suggestion:
        'Usage: skill linear states ENG\nUse `skill linear teams` to list teams.',
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

    // Get states
    const statesConnection = await team.states()
    const states = statesConnection.nodes || []

    // Sort by position
    const sortedStates = [...states].sort((a, b) => a.position - b.position)

    if (ctx.format === 'json') {
      const stateData = sortedStates.map((state) => ({
        id: state.id,
        name: state.name,
        type: state.type,
        color: state.color,
        position: state.position,
        description: state.description || null,
      }))

      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'state-list',
            command: `skill linear states ${team.key} --json`,
            data: {
              team: { id: team.id, key: team.key, name: team.name },
              count: states.length,
              states: stateData,
            },
            links: teamLinks(team.key),
            actions: [
              {
                action: 'change-issue-state',
                command: `skill linear state <issue-id> --state "<state-name>"`,
                description: 'Change an issue to this state',
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
    ctx.output.data(`📊 Workflow States for ${team.name} (${team.key})`)
    ctx.output.data('─'.repeat(60))

    // Group by type
    const typeOrder = [
      'triage',
      'backlog',
      'unstarted',
      'started',
      'completed',
      'canceled',
    ]
    const statesByType = new Map<string, typeof sortedStates>()

    for (const state of sortedStates) {
      const existing = statesByType.get(state.type) || []
      existing.push(state)
      statesByType.set(state.type, existing)
    }

    for (const type of typeOrder) {
      const typeStates = statesByType.get(type)
      if (!typeStates || typeStates.length === 0) continue

      const emoji = STATE_TYPE_EMOJI[type] || '📌'
      ctx.output.data('')
      ctx.output.data(`   ${emoji} ${type.toUpperCase()}`)

      for (const state of typeStates) {
        ctx.output.data(`      • ${state.name}`)
      }
    }

    ctx.output.data('')
    ctx.output.data(
      '   Usage: skill linear state ENG-123 --state "In Progress"'
    )
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list states.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
