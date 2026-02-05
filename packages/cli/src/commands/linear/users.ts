/**
 * Linear CLI users command - list workspace users
 *
 * Usage:
 * - List all users: skill linear users
 * - JSON output: skill linear users --json
 *
 * Shows users in your Linear workspace. Use email for assignment.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import { hateoasWrap, userListLinks } from './hateoas'

/**
 * Command: skill linear users
 * List workspace users
 */
export async function listUsers(ctx: CommandContext): Promise<void> {
  try {
    const client = getLinearClient()

    const usersConnection = await client.users()
    const users = usersConnection.nodes || []

    // Filter out inactive users
    const activeUsers = users.filter((u) => u.active)

    if (ctx.format === 'json') {
      const userData = activeUsers.map((user) => ({
        id: user.id,
        name: user.name,
        displayName: user.displayName,
        email: user.email,
        admin: user.admin,
        active: user.active,
        avatarUrl: user.avatarUrl || null,
      }))

      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'user-list',
            command: `skill linear users --json`,
            data: {
              count: activeUsers.length,
              users: userData,
            },
            links: userListLinks(
              activeUsers.map((u) => ({
                id: u.id,
                email: u.email || '',
                name: u.name,
              }))
            ),
            actions: [
              {
                action: 'assign-to-user',
                command: `skill linear assign <issue-id> --to "<email>"`,
                description: 'Assign an issue to this user',
              },
              {
                action: 'filter-by-user',
                command: `skill linear issues --assignee "<email>" --json`,
                description: "View user's assigned issues",
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
    ctx.output.data(`👥 Workspace Users (${activeUsers.length})`)
    ctx.output.data('─'.repeat(60))

    for (const user of activeUsers) {
      const adminBadge = user.admin ? ' [Admin]' : ''
      ctx.output.data('')
      ctx.output.data(`   ${user.name}${adminBadge}`)
      ctx.output.data(`      Email: ${user.email || '(no email)'}`)
    }

    ctx.output.data('')
    ctx.output.data(
      '   Assign: skill linear assign ENG-123 --to "email@example.com"'
    )
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list users.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
