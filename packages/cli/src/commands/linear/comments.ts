/**
 * Linear CLI comments command - list comments on an issue
 *
 * Usage:
 * - List comments: skill linear comments ENG-123
 * - JSON output: skill linear comments ENG-123 --json
 * - Limit results: skill linear comments ENG-123 --limit 10
 *
 * Shows comment history with author and timestamps.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import { hateoasWrap, issueActions, issueLinks } from './hateoas'

interface CommentsOptions {
  limit?: number
}

/**
 * Command: skill linear comments <issue-id>
 * List comments on an issue
 */
export async function listComments(
  ctx: CommandContext,
  issueId: string,
  options: CommentsOptions = {}
): Promise<void> {
  const limit = options.limit || 50

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

    // Fetch comments
    const commentsConnection = await issue.comments({ first: limit })
    const comments = commentsConnection.nodes || []

    // Resolve users for all comments
    const commentsWithUsers = await Promise.all(
      comments.map(async (comment) => ({
        comment,
        user: await comment.user,
      }))
    )

    if (ctx.format === 'json') {
      const commentData = commentsWithUsers.map(({ comment, user }) => ({
        id: comment.id,
        body: comment.body,
        author: user
          ? { id: user.id, name: user.name, email: user.email }
          : null,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        url: comment.url,
      }))

      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'comment-list',
            command: `skill linear comments ${issue.identifier} --json`,
            data: {
              issueId: issue.id,
              issueIdentifier: issue.identifier,
              issueTitle: issue.title,
              count: comments.length,
              comments: commentData,
            },
            links: issueLinks(issue.identifier),
            actions: [
              {
                action: 'add-comment',
                command: `skill linear comment ${issue.identifier} --body "<text>"`,
                description: 'Add a new comment',
              },
              ...issueActions(issue.identifier),
            ],
          }),
          null,
          2
        )
      )
      return
    }

    ctx.output.data('')
    ctx.output.data(`💬 Comments on ${issue.identifier}: ${issue.title}`)
    ctx.output.data('─'.repeat(80))

    if (comments.length === 0) {
      ctx.output.data('')
      ctx.output.data('   No comments yet.')
      ctx.output.data('')
      ctx.output.data(
        `   Add one: skill linear comment ${issue.identifier} --body "Your comment"`
      )
      ctx.output.data('')
      return
    }

    for (const { comment, user } of commentsWithUsers) {
      const date = new Date(comment.createdAt).toLocaleDateString()
      const authorName = user?.name || 'Unknown'

      ctx.output.data('')
      ctx.output.data(`   📝 ${authorName} • ${date}`)
      ctx.output.data('   ' + '-'.repeat(40))

      // Indent and truncate comment body
      const bodyLines = comment.body.split('\n')
      for (const line of bodyLines.slice(0, 5)) {
        ctx.output.data(`   ${line}`)
      }
      if (bodyLines.length > 5) {
        ctx.output.data(`   ... (${bodyLines.length - 5} more lines)`)
      }
    }

    ctx.output.data('')
    ctx.output.data(
      `   Add comment: skill linear comment ${issue.identifier} --body "text"`
    )
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list comments.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
