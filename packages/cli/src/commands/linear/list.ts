/**
 * Linear CLI list command - list issues with filters
 *
 * Usage:
 * - List recent issues: skill linear issues
 * - Filter by team: skill linear issues --team ENG
 * - Filter by state: skill linear issues --state "In Progress"
 * - Filter by assignee: skill linear issues --assignee me
 * - Filter by project: skill linear issues --project "Q1 Goals"
 * - Combine filters: skill linear issues --team ENG --state "In Progress"
 * - JSON output: skill linear issues --json
 *
 * JSON output includes _links to individual issues and _actions for creating new ones.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import {
  WRITE_ACTION_META,
  hateoasWrap,
  issueListActions,
  issueListLinks,
} from './hateoas'

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

interface ListOptions {
  limit?: number
  team?: string
  state?: string
  assignee?: string
  project?: string
  priority?: number
  olderThan?: string
  export?: boolean
}

/**
 * Parse relative time string (e.g., '90d', '2w', '24h', '3m') into Date
 */
function parseRelativeTime(timeStr: string): Date {
  const match = timeStr.match(/^(\d+)(d|w|h|m)$/)
  if (!match || !match[1] || !match[2]) {
    throw new CLIError({
      userMessage: `Invalid time format: ${timeStr}`,
      suggestion: 'Use format like 90d, 2w, 24h, or 3m',
    })
  }

  const value = parseInt(match[1], 10)
  const unit = match[2] as 'd' | 'w' | 'h' | 'm'

  const msMap: Record<'d' | 'w' | 'h' | 'm', number> = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,
  }

  const ms = value * msMap[unit]
  return new Date(Date.now() - ms)
}

/**
 * Command: skill linear issues
 * List Linear issues with optional filters
 */
export async function listIssues(
  ctx: CommandContext,
  options: ListOptions = {}
): Promise<void> {
  const limit = options.limit || 20

  try {
    const client = getLinearClient()

    // Build filter object
    const filter: Record<string, unknown> = {
      state: {
        type: {
          neq: 'canceled',
        },
      },
    }

    // Time filter
    if (options.olderThan) {
      const date = parseRelativeTime(options.olderThan)
      filter.updatedAt = { lt: date }
    }

    // Team filter
    let teamKey: string | undefined
    if (options.team) {
      const teams = await client.teams()
      const team = teams.nodes.find(
        (t) =>
          t.key.toLowerCase() === options.team!.toLowerCase() ||
          t.name.toLowerCase() === options.team!.toLowerCase()
      )
      if (!team) {
        throw new CLIError({
          userMessage: `Team not found: ${options.team}`,
          suggestion:
            'Use `skill linear teams --json` to list available teams.',
        })
      }
      filter.team = { id: { eq: team.id } }
      teamKey = team.key
    }

    // State filter
    if (options.state) {
      filter.state = {
        ...((filter.state as Record<string, unknown>) || {}),
        name: { eqIgnoreCase: options.state },
      }
    }

    // Assignee filter
    if (options.assignee) {
      if (options.assignee.toLowerCase() === 'me') {
        const viewer = await client.viewer
        filter.assignee = { id: { eq: viewer.id } }
      } else {
        const users = await client.users()
        const user = users.nodes.find(
          (u) =>
            u.email?.toLowerCase() === options.assignee!.toLowerCase() ||
            u.name?.toLowerCase() === options.assignee!.toLowerCase()
        )
        if (!user) {
          throw new CLIError({
            userMessage: `User not found: ${options.assignee}`,
            suggestion:
              'Use `skill linear users --json` to list available users.',
          })
        }
        filter.assignee = { id: { eq: user.id } }
      }
    }

    // Project filter
    if (options.project) {
      const projects = await client.projects()
      const project = projects.nodes.find(
        (p) =>
          p.id === options.project ||
          p.name.toLowerCase() === options.project!.toLowerCase()
      )
      if (!project) {
        throw new CLIError({
          userMessage: `Project not found: ${options.project}`,
          suggestion:
            'Use `skill linear projects --json` to list available projects.',
        })
      }
      filter.project = { id: { eq: project.id } }
    }

    // Priority filter
    if (options.priority !== undefined) {
      filter.priority = { eq: options.priority }
    }

    const response = await client.issues({
      first: limit,
      filter,
    })

    const issues = response.nodes || []

    // Resolve states and teams for all issues (LinearFetch<T> must be awaited)
    const issuesWithDetails = await Promise.all(
      issues.map(async (issue) => {
        const labels = options.export ? await issue.labels() : null
        const comments = options.export ? await issue.comments() : null

        return {
          issue,
          state: await issue.state,
          assignee: await issue.assignee,
          team: await issue.team,
          labels: labels?.nodes || null,
          comments: comments?.nodes || null,
        }
      })
    )

    if (ctx.format === 'json') {
      const issueData = await Promise.all(
        issuesWithDetails.map(
          async ({ issue, state, assignee, team, labels, comments }) => {
            const baseData = {
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              state: state?.name || null,
              stateType: state?.type || null,
              priority: issue.priority,
              assignee: assignee
                ? {
                    id: assignee.id,
                    name: assignee.name,
                    email: assignee.email,
                  }
                : null,
              team: team ? { key: team.key, name: team.name } : null,
              url: issue.url,
              createdAt: issue.createdAt,
              updatedAt: issue.updatedAt,
            }

            if (options.export) {
              return {
                ...baseData,
                description: issue.description,
                labels: labels ? labels.map((l) => l.name) : [],
                comments: comments
                  ? await Promise.all(
                      comments.map(async (c) => ({
                        body: c.body,
                        user: (await c.user)?.name || 'Unknown',
                        createdAt: c.createdAt,
                      }))
                    )
                  : [],
              }
            }

            return baseData
          }
        )
      )

      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'issue-list',
            command: `skill linear issues${teamKey ? ` --team ${teamKey}` : ''} --json`,
            data: {
              count: issues.length,
              issues: issueData,
            },
            links: issueListLinks(
              issuesWithDetails.map(({ issue }) => ({
                identifier: issue.identifier,
                title: issue.title,
              })),
              teamKey
            ),
            actions: issueListActions(teamKey),
            meta: WRITE_ACTION_META,
          }),
          null,
          2
        )
      )
      return
    }

    // Text output
    const filterDesc: string[] = []
    if (options.team) filterDesc.push(`team:${options.team}`)
    if (options.state) filterDesc.push(`state:"${options.state}"`)
    if (options.assignee) filterDesc.push(`assignee:${options.assignee}`)
    if (options.project) filterDesc.push(`project:"${options.project}"`)
    if (options.priority !== undefined)
      filterDesc.push(`priority:${options.priority}`)

    ctx.output.data('')
    ctx.output.data(
      `📋 Linear Issues (${issues.length})${filterDesc.length > 0 ? ` [${filterDesc.join(', ')}]` : ''}`
    )
    ctx.output.data('─'.repeat(80))

    if (issues.length === 0) {
      ctx.output.data('   No issues found matching filters.')
      ctx.output.data('')
      ctx.output.data('   Suggestions:')
      ctx.output.data('     • List all issues: skill linear issues')
      ctx.output.data('     • Create an issue: skill linear create "Title"')
      ctx.output.data('')
      return
    }

    for (const {
      issue,
      state,
      assignee,
      team,
      labels,
      comments,
    } of issuesWithDetails) {
      const emoji = PRIORITY_EMOJI[issue.priority] || '⚪'
      const assigneeName = assignee ? `@${assignee.name}` : ''
      const teamBadge = team ? `[${team.key}]` : ''

      ctx.output.data('')
      ctx.output.data(
        `   ${emoji} ${teamBadge} ${issue.identifier}: ${issue.title}`
      )
      ctx.output.data(
        `      Status: ${state?.name || 'unknown'}${assigneeName ? ` | Assignee: ${assigneeName}` : ''}`
      )

      if (options.export) {
        if (issue.description) {
          ctx.output.data(`      Description: ${issue.description}`)
        }
        if (labels && labels.length > 0) {
          ctx.output.data(
            `      Labels: ${labels.map((l) => l.name).join(', ')}`
          )
        }
        if (comments && comments.length > 0) {
          ctx.output.data(`      Comments: ${comments.length}`)
        }
      }
    }

    ctx.output.data('')
    ctx.output.data('   Use `skill linear issue <ID> --json` for full details.')
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list Linear issues.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
