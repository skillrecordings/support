/**
 * Linear CLI get command - fetch a single issue
 *
 * Usage:
 * - Get issue: skill linear issue ENG-123
 * - JSON with discoverable links: skill linear issue ENG-123 --json
 *
 * The JSON output includes _links and _actions for agent discoverability:
 * - _links: related resources (team issues, comments)
 * - _actions: available operations (comment, assign, close, etc.)
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import {
  WRITE_ACTION_META,
  hateoasWrap,
  issueActions,
  issueLinks,
} from './hateoas'

/**
 * Priority display helpers
 */
const PRIORITY_LABELS: Record<number, string> = {
  0: 'Urgent',
  1: 'High',
  2: 'Medium',
  3: 'Low',
  4: 'None',
}

const PRIORITY_EMOJI: Record<number, string> = {
  0: '🔴',
  1: '🟠',
  2: '🟡',
  3: '🟢',
  4: '⚪',
}

/**
 * Command: skill linear issue <id>
 * Get a specific issue with full details
 */
export async function getIssue(ctx: CommandContext, id: string): Promise<void> {
  try {
    const client = getLinearClient()
    const issue = await client.issue(id)

    if (!issue) {
      throw new CLIError({
        userMessage: `Issue ${id} not found.`,
        suggestion:
          'Use `skill linear issues --json` to list available issues.',
        exitCode: 1,
      })
    }

    // Await relational properties (LinearFetch<T>)
    const [state, assignee, team, labels, project, parent, cycle] =
      await Promise.all([
        issue.state,
        issue.assignee,
        issue.team,
        issue.labels(),
        issue.project,
        issue.parent,
        issue.cycle,
      ])

    const teamKey = team?.key

    const issueData = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || null,
      state: state?.name || null,
      stateType: state?.type || null,
      priority: issue.priority,
      priorityLabel: PRIORITY_LABELS[issue.priority] || 'Unknown',
      estimate: issue.estimate || null,
      assignee: assignee
        ? { id: assignee.id, name: assignee.name, email: assignee.email }
        : null,
      team: team ? { id: team.id, key: team.key, name: team.name } : null,
      project: project
        ? { id: project.id, name: project.name, url: project.url }
        : null,
      parent: parent
        ? { id: parent.id, identifier: parent.identifier, title: parent.title }
        : null,
      cycle: cycle
        ? { id: cycle.id, name: cycle.name, number: cycle.number }
        : null,
      labels: labels.nodes.map((l) => ({ id: l.id, name: l.name })),
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      completedAt: issue.completedAt || null,
      dueDate: issue.dueDate || null,
    }

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'issue',
            command: `skill linear issue ${issue.identifier} --json`,
            data: issueData,
            links: issueLinks(issue.identifier, teamKey),
            actions: issueActions(issue.identifier),
            meta: WRITE_ACTION_META,
          }),
          null,
          2
        )
      )
      return
    }

    // Text output
    ctx.output.data('')
    ctx.output.data(
      `${PRIORITY_EMOJI[issue.priority] || '⚪'} [${issue.identifier}] ${issue.title}`
    )
    ctx.output.data('─'.repeat(80))
    ctx.output.data('')
    ctx.output.data(`   Status:      ${state?.name || 'Unknown'}`)
    ctx.output.data(
      `   Priority:    ${PRIORITY_LABELS[issue.priority] || 'Unknown'} (${issue.priority})`
    )

    if (assignee) {
      ctx.output.data(`   Assignee:    ${assignee.name} <${assignee.email}>`)
    } else {
      ctx.output.data(`   Assignee:    Unassigned`)
    }

    if (team) {
      ctx.output.data(`   Team:        ${team.name} (${team.key})`)
    }

    if (project) {
      ctx.output.data(`   Project:     ${project.name}`)
    }

    if (cycle) {
      ctx.output.data(`   Cycle:       ${cycle.name}`)
    }

    if (parent) {
      ctx.output.data(`   Parent:      ${parent.identifier} - ${parent.title}`)
    }

    if (labels.nodes.length > 0) {
      ctx.output.data(
        `   Labels:      ${labels.nodes.map((l) => l.name).join(', ')}`
      )
    }

    if (issue.estimate) {
      ctx.output.data(`   Estimate:    ${issue.estimate} points`)
    }

    if (issue.dueDate) {
      ctx.output.data(`   Due:         ${issue.dueDate}`)
    }

    ctx.output.data('')
    ctx.output.data(`   URL:         ${issue.url}`)
    ctx.output.data(
      `   Created:     ${new Date(issue.createdAt).toLocaleDateString()}`
    )
    ctx.output.data(
      `   Updated:     ${new Date(issue.updatedAt).toLocaleDateString()}`
    )

    if (issue.description) {
      ctx.output.data('')
      ctx.output.data('   Description:')
      ctx.output.data('   ' + '-'.repeat(40))
      // Indent description lines
      const descLines = issue.description.split('\n')
      for (const line of descLines.slice(0, 20)) {
        ctx.output.data(`   ${line}`)
      }
      if (descLines.length > 20) {
        ctx.output.data(`   ... (${descLines.length - 20} more lines)`)
      }
    }

    ctx.output.data('')
    ctx.output.data('   Actions (require personal API key):')
    ctx.output.data(
      `     • Comment:  skill linear comment ${issue.identifier} --body "text"`
    )
    ctx.output.data(
      `     • Assign:   skill linear assign ${issue.identifier} --to <email>`
    )
    ctx.output.data(
      `     • State:    skill linear state ${issue.identifier} --state "Done"`
    )
    ctx.output.data(`     • Close:    skill linear close ${issue.identifier}`)
    ctx.output.data('')
    ctx.output.data('   ⚠️  Write operations require a personal LINEAR_API_KEY.')
    ctx.output.data('       Run `skill keys add` to set up your keys.')
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to fetch Linear issue.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
