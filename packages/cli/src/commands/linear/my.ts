/**
 * Linear CLI my command - list issues assigned to you
 *
 * Usage:
 * - List my issues: skill linear my
 * - Filter by state: skill linear my --state "In Progress"
 * - Limit results: skill linear my --limit 10
 * - JSON output: skill linear my --json
 *
 * Shorthand for `skill linear issues --assignee me`.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { withSpinner } from '../../core/spinner'
import { getLinearClient } from './client'
import { hateoasWrap, issueListActions, issueListLinks } from './hateoas'

/**
 * Priority emoji mapping
 */
const PRIORITY_EMOJI: Record<number, string> = {
  0: '🔴',
  1: '🟠',
  2: '🟡',
  3: '🟢',
  4: '⚪',
}

interface MyOptions {
  limit?: number
  state?: string
}

/**
 * Command: skill linear my
 * List issues assigned to the current user
 */
export async function listMyIssues(
  ctx: CommandContext,
  options: MyOptions = {}
): Promise<void> {
  const limit = options.limit || 20

  try {
    const client = getLinearClient()

    // Get current user and issues
    const { viewer, issues } = await withSpinner(
      'Loading issues...',
      async () => {
        const viewer = await client.viewer

        // Build filter
        const filter: Record<string, unknown> = {
          assignee: { id: { eq: viewer.id } },
          state: {
            type: {
              nin: ['canceled', 'completed'],
            },
          },
        }

        if (options.state) {
          filter.state = {
            ...((filter.state as Record<string, unknown>) || {}),
            name: { eqIgnoreCase: options.state },
          }
        }

        const response = await client.issues({
          first: limit,
          filter,
        })

        return { viewer, issues: response.nodes || [] }
      }
    )

    // Resolve details
    const issuesWithDetails = await Promise.all(
      issues.map(async (issue) => ({
        issue,
        state: await issue.state,
        team: await issue.team,
      }))
    )

    if (ctx.format === 'json') {
      const issueData = issuesWithDetails.map(({ issue, state, team }) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        state: state?.name || null,
        stateType: state?.type || null,
        priority: issue.priority,
        team: team ? { key: team.key, name: team.name } : null,
        url: issue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        dueDate: issue.dueDate || null,
      }))

      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'my-issues',
            command: `skill linear my --json`,
            data: {
              user: {
                id: viewer.id,
                name: viewer.name,
                email: viewer.email,
              },
              count: issues.length,
              issues: issueData,
            },
            links: issueListLinks(
              issuesWithDetails.map(({ issue }) => ({
                identifier: issue.identifier,
                title: issue.title,
              }))
            ),
            actions: issueListActions(),
          }),
          null,
          2
        )
      )
      return
    }

    ctx.output.data('')
    ctx.output.data(`👤 My Issues (${issues.length}) - ${viewer.name}`)
    ctx.output.data('─'.repeat(80))

    if (issues.length === 0) {
      ctx.output.data('')
      ctx.output.data('   No issues assigned to you.')
      ctx.output.data('')
      ctx.output.data(
        '   Create one: skill linear create "Title" --assignee me'
      )
      ctx.output.data('')
      return
    }

    // Group by state type for better visualization
    const byStateType = new Map<string, typeof issuesWithDetails>()
    for (const item of issuesWithDetails) {
      const stateType = item.state?.type || 'unknown'
      const existing = byStateType.get(stateType) || []
      existing.push(item)
      byStateType.set(stateType, existing)
    }

    const stateOrder = ['started', 'unstarted', 'backlog', 'triage']
    for (const stateType of stateOrder) {
      const items = byStateType.get(stateType)
      if (!items || items.length === 0) continue

      ctx.output.data('')
      ctx.output.data(`   ${stateType.toUpperCase()}:`)

      for (const { issue, state, team } of items) {
        const emoji = PRIORITY_EMOJI[issue.priority] || '⚪'
        const teamBadge = team ? `[${team.key}]` : ''
        const dueInfo = issue.dueDate ? ` | Due: ${issue.dueDate}` : ''

        ctx.output.data(
          `      ${emoji} ${teamBadge} ${issue.identifier}: ${issue.title}`
        )
        ctx.output.data(`         ${state?.name || 'unknown'}${dueInfo}`)
      }
    }

    ctx.output.data('')
    ctx.output.data('   Use `skill linear issue <ID>` for full details.')
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list your issues.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
