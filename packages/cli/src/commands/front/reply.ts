/**
 * Front CLI reply command
 *
 * Creates a draft reply on a conversation (HITL-only, never sends).
 */

import type { Command } from 'commander'
import { type CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getFrontClient, normalizeId } from './client'
import { conversationActions, conversationLinks, hateoasWrap } from './hateoas'
import { contextFromCommand } from './with-context'

interface ReplyOptions {
  message?: string
  dryRun?: boolean
  json?: boolean
}

export async function replyToConversation(
  ctx: CommandContext,
  conversationId: string,
  options: ReplyOptions
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const dryRun = options.dryRun === true

  try {
    if (!options.message) {
      throw new CLIError({
        userMessage: 'Message body is required.',
        suggestion: 'Use --message "<text>".',
      })
    }

    const front = getFrontClient(ctx)
    const normalizedId = normalizeId(conversationId)

    let draft: unknown = null
    if (!dryRun) {
      // Use raw client to avoid channel_id validation in typed schema.
      draft = await front.raw.post(`/conversations/${normalizedId}/drafts`, {
        body: options.message,
      })
    }

    const result = {
      id: normalizedId,
      action: 'reply-draft',
      message: options.message,
      dryRun,
      draft,
      success: true,
    }

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'reply-result',
          command: `skill front reply ${normalizedId} --message "${options.message}" --json`,
          data: result,
          links: conversationLinks(normalizedId),
          actions: conversationActions(normalizedId),
        })
      )
      return
    }

    ctx.output.data('')
    if (dryRun) {
      ctx.output.data(`🧪 DRY RUN: Draft reply for ${normalizedId}`)
    } else {
      ctx.output.data(`✉️  Draft created for ${normalizedId}`)
      ctx.output.data('   (Draft only - not sent. Requires human approval.)')
    }
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to draft reply.',
            suggestion:
              'Verify conversation ID, message body, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export function registerReplyCommand(frontCommand: Command): void {
  frontCommand
    .command('reply')
    .description('Draft a reply on a conversation (HITL, never auto-send)')
    .argument('<conversation-id>', 'Conversation ID (e.g., cnv_xxx)')
    .option('--message <text>', 'Reply body text')
    .option('--dry-run', 'Preview without making changes')
    .option('--json', 'Output as JSON')
    .action(
      async (
        conversationId: string,
        options: ReplyOptions,
        command: Command
      ) => {
        const ctx = await contextFromCommand(command, options)
        await replyToConversation(ctx, conversationId, options)
      }
    )
}
