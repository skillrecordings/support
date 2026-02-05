import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'

/**
 * Command: skill linear projects
 * List all Linear projects
 */
export async function listProjects(
  ctx: CommandContext,
  options: { limit?: number } = {}
): Promise<void> {
  const limit = options.limit || 50

  try {
    const client = getLinearClient()
    const response = await client.projects({
      first: limit,
    })

    const projects = response.nodes || []

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          {
            success: true,
            count: projects.length,
            projects: projects.map((project) => ({
              id: project.id,
              name: project.name,
              description: project.description,
              state: project.state,
              url: project.url,
            })),
          },
          null,
          2
        )
      )
      return
    }

    ctx.output.data(`\n📁 Linear Projects (${projects.length}):`)
    ctx.output.data('-'.repeat(80))

    if (projects.length === 0) {
      ctx.output.data('   No projects found.')
    } else {
      for (const project of projects) {
        const stateIcon = project.state === 'completed' ? '✓' : '●'
        ctx.output.data(`   ${stateIcon} ${project.name}`)
        ctx.output.data(`      ID: ${project.id}`)
        ctx.output.data(`      State: ${project.state}`)
        if (project.description) {
          const truncatedDesc =
            project.description.length > 60
              ? project.description.slice(0, 60) + '...'
              : project.description
          ctx.output.data(`      Desc: ${truncatedDesc}`)
        }
        ctx.output.data('')
      }
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list Linear projects.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
