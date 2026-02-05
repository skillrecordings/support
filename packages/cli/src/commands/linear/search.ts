/**
 * Linear CLI search command - search issues
 *
 * Usage:
 * - Search by text: skill linear search "authentication bug"
 * - Limit results: skill linear search "bug" --limit 10
 * - JSON output: skill linear search "login" --json
 *
 * Searches issue titles, descriptions, and comments.
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

interface SearchOptions {
  limit?: number
}

/**
 * Command: skill linear search <query>
 * Search issues by text
 */
export async function searchIssues(
  ctx: CommandContext,
  query: string,
  options: SearchOptions = {}
): Promise<void> {
  if (!query || query.trim().length === 0) {
    throw new CLIError({
      userMessage: 'Search query is required.',
      suggestion: 'Usage: skill linear search "your query"',
      exitCode: 1,
    })
  }

  const limit = options.limit || 20

  try {
    const client = getLinearClient()

    // Use searchIssues for full-text search
    const response = await withSpinner('Searching issues...', () =>
      client.searchIssues(query.trim(), {
        first: limit,
      })
    )

    const issues = response.nodes || []

    // Resolve details for all issues
    const issuesWithDetails = await Promise.all(
      issues.map(async (issue) => ({
        issue,
        state: await issue.state,
        assignee: await issue.assignee,
        team: await issue.team,
      }))
    )

    if (ctx.format === 'json') {
      const issueData = issuesWithDetails.map(
        ({ issue, state, assignee, team }) => ({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          state: state?.name || null,
          priority: issue.priority,
          assignee: assignee
            ? { id: assignee.id, name: assignee.name, email: assignee.email }
            : null,
          team: team ? { key: team.key, name: team.name } : null,
          url: issue.url,
        })
      )

      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'search-results',
            command: `skill linear search "${query}" --json`,
            data: {
              query,
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
    ctx.output.data(`🔍 Search: "${query}" (${issues.length} results)`)
    ctx.output.data('─'.repeat(80))

    if (issues.length === 0) {
      ctx.output.data('')
      ctx.output.data('   No issues found matching your search.')
      ctx.output.data('')
      ctx.output.data('   Try:')
      ctx.output.data('     • Different keywords')
      ctx.output.data('     • skill linear issues (list all)')
      ctx.output.data('     • skill linear my (your assigned issues)')
      ctx.output.data('')
      return
    }

    for (const { issue, state, assignee, team } of issuesWithDetails) {
      const emoji = PRIORITY_EMOJI[issue.priority] || '⚪'
      const teamBadge = team ? `[${team.key}]` : ''

      ctx.output.data('')
      ctx.output.data(
        `   ${emoji} ${teamBadge} ${issue.identifier}: ${issue.title}`
      )
      ctx.output.data(
        `      Status: ${state?.name || 'unknown'}${assignee ? ` | @${assignee.name}` : ''}`
      )
    }

    ctx.output.data('')
    ctx.output.data('   Use `skill linear issue <ID>` for full details.')
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to search issues.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
