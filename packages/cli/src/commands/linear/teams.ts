import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'

/**
 * Command: skill linear teams
 * List all Linear teams
 */
export async function listTeams(
  ctx: CommandContext,
  options: Record<string, never> = {}
): Promise<void> {
  try {
    const client = getLinearClient()
    const response = await client.teams()

    const teams = response.nodes || []

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          {
            success: true,
            count: teams.length,
            teams: teams.map((team) => ({
              id: team.id,
              key: team.key,
              name: team.name,
              description: team.description,
            })),
          },
          null,
          2
        )
      )
      return
    }

    ctx.output.data(`\n👥 Linear Teams (${teams.length}):`)
    ctx.output.data('-'.repeat(80))

    if (teams.length === 0) {
      ctx.output.data('   No teams found.')
    } else {
      for (const team of teams) {
        ctx.output.data(`   ${team.key} - ${team.name}`)
        ctx.output.data(`      ID: ${team.id}`)
        if (team.description) {
          ctx.output.data(`      Desc: ${team.description}`)
        }
        ctx.output.data('')
      }
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list Linear teams.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
