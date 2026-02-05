/**
 * Linear CLI comment command - add a comment to an issue
 *
 * Usage:
 * - Add comment: skill linear comment ENG-123 --body "This is my comment"
 * - Comment with markdown: skill linear comment ENG-123 --body "## Update\n- Item 1\n- Item 2"
 * - JSON output: skill linear comment ENG-123 --body "Comment" --json
 *
 * Supports full markdown formatting in comments.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getLinearClient } from './client'
import { commentLinks, hateoasWrap, issueActions, issueLinks } from './hateoas'

interface CommentOptions {
  body: string
}

/**
 * Command: skill linear comment <issue-id> --body "text"
 * Add a comment to an issue
 */
export async function addComment(
  ctx: CommandContext,
  issueId: string,
  options: CommentOptions
): Promise<void> {
  if (!options.body || options.body.trim().length === 0) {
    throw new CLIError({
      userMessage: 'Comment body is required.',
      suggestion: 'Usage: skill linear comment ENG-123 --body "Your comment"',
      exitCode: 1,
    })
  }

  try {
    const client = getLinearClient()

    // Fetch the issue first to validate it exists
    const issue = await client.issue(issueId)
    if (!issue) {
      throw new CLIError({
        userMessage: `Issue not found: ${issueId}`,
        suggestion:
          'Use `skill linear issues --json` to list available issues.',
        exitCode: 1,
      })
    }

    // Create the comment
    const payload = await client.createComment({
      issueId: issue.id,
      body: options.body.trim(),
    })

    const comment = await payload.comment
    if (!comment) {
      throw new CLIError({
        userMessage: 'Failed to create comment - no comment returned.',
        exitCode: 1,
      })
    }

    const user = await comment.user

    const commentData = {
      id: comment.id,
      body: comment.body,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      author: user ? { id: user.id, name: user.name, email: user.email } : null,
      createdAt: comment.createdAt,
      url: comment.url,
    }

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'comment-created',
            command: `skill linear comments ${issue.identifier} --json`,
            data: commentData,
            links: [
              ...commentLinks(comment.id, issue.identifier),
              ...issueLinks(issue.identifier),
            ],
            actions: issueActions(issue.identifier),
          }),
          null,
          2
        )
      )
      return
    }

    ctx.output.data('')
    ctx.output.data(`✅ Comment added to ${issue.identifier}`)
    ctx.output.data('─'.repeat(50))
    ctx.output.data(`   Author:  ${user?.name || 'Unknown'}`)
    ctx.output.data(`   URL:     ${comment.url}`)
    ctx.output.data('')
    ctx.output.data('   Comment:')
    ctx.output.data('   ' + '-'.repeat(40))
    // Indent comment lines
    const bodyLines = options.body.split('\n')
    for (const line of bodyLines.slice(0, 10)) {
      ctx.output.data(`   ${line}`)
    }
    if (bodyLines.length > 10) {
      ctx.output.data(`   ... (${bodyLines.length - 10} more lines)`)
    }
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to add comment.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
