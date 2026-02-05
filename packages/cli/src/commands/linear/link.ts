/**
 * Linear CLI link command - link issues together
 *
 * Usage:
 * - Blocks relationship: skill linear link ENG-123 --blocks ENG-456
 * - Blocked by: skill linear link ENG-123 --blocked-by ENG-456
 * - Related to: skill linear link ENG-123 --related ENG-456
 * - Duplicate of: skill linear link ENG-123 --duplicate ENG-456
 * - JSON output: skill linear link ENG-123 --blocks ENG-456 --json
 *
 * Creates issue relations for tracking dependencies.
 */

import type { CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { requirePersonalKey } from '../../core/write-gate'
import { getLinearClient } from './client'
import { hateoasWrap, issueActions, issueLinks } from './hateoas'

interface LinkOptions {
  blocks?: string
  blockedBy?: string
  related?: string
  duplicate?: string
}

/**
 * Command: skill linear link <issue-id>
 * Link issues together
 */
export async function linkIssues(
  ctx: CommandContext,
  issueId: string,
  options: LinkOptions
): Promise<void> {
  // Exactly one relationship type must be specified
  const relationships = [
    { type: 'blocks', value: options.blocks },
    { type: 'blocked_by', value: options.blockedBy },
    { type: 'related', value: options.related },
    { type: 'duplicate', value: options.duplicate },
  ].filter((r) => r.value)

  if (relationships.length === 0) {
    throw new CLIError({
      userMessage: 'No relationship specified.',
      suggestion:
        'Use --blocks, --blocked-by, --related, or --duplicate with a target issue ID.',
      exitCode: 1,
    })
  }

  if (relationships.length > 1) {
    throw new CLIError({
      userMessage: 'Only one relationship type can be specified at a time.',
      suggestion:
        'Choose one: --blocks, --blocked-by, --related, or --duplicate.',
      exitCode: 1,
    })
  }

  // TypeScript needs help here - we've verified length is exactly 1
  const relationship = relationships[0]!
  const targetValue = relationship.value!

  // Require personal API key for write operations
  requirePersonalKey('LINEAR_API_KEY')

  try {
    const client = getLinearClient()

    // Fetch both issues to validate they exist
    const [issue, targetIssue] = await Promise.all([
      client.issue(issueId),
      client.issue(targetValue),
    ])

    if (!issue) {
      throw new CLIError({
        userMessage: `Issue not found: ${issueId}`,
        suggestion:
          'Use `skill linear issues --json` to list available issues.',
        exitCode: 1,
      })
    }

    if (!targetIssue) {
      throw new CLIError({
        userMessage: `Target issue not found: ${targetValue}`,
        suggestion:
          'Use `skill linear issues --json` to list available issues.',
        exitCode: 1,
      })
    }

    // Create the issue relation
    // Linear SDK uses createIssueRelation
    await client.createIssueRelation({
      issueId: issue.id,
      relatedIssueId: targetIssue.id,
      type: relationship.type as any,
    })

    const team = await issue.team

    const resultData = {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      targetIssueId: targetIssue.id,
      targetIdentifier: targetIssue.identifier,
      relationshipType: relationship.type,
      success: true,
    }

    if (ctx.format === 'json') {
      ctx.output.data(
        JSON.stringify(
          hateoasWrap({
            type: 'link-result',
            command: `skill linear issue ${issue.identifier} --json`,
            data: resultData,
            links: [
              ...issueLinks(issue.identifier, team?.key),
              {
                rel: 'linked-issue',
                command: `skill linear issue ${targetIssue.identifier} --json`,
                description: targetIssue.title,
              },
            ],
            actions: issueActions(issue.identifier),
          }),
          null,
          2
        )
      )
      return
    }

    const relationDesc = {
      blocks: 'blocks',
      blocked_by: 'is blocked by',
      related: 'is related to',
      duplicate: 'is a duplicate of',
    }[relationship.type]

    ctx.output.data('')
    ctx.output.data(`🔗 Link created`)
    ctx.output.data('─'.repeat(50))
    ctx.output.data(
      `   ${issue.identifier} ${relationDesc} ${targetIssue.identifier}`
    )
    ctx.output.data('')
    ctx.output.data(
      `   View ${issue.identifier}: skill linear issue ${issue.identifier}`
    )
    ctx.output.data(
      `   View ${targetIssue.identifier}: skill linear issue ${targetIssue.identifier}`
    )
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to link issues.',
            suggestion: 'Verify LINEAR_API_KEY is set correctly.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
