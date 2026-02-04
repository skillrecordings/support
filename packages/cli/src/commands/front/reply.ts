/**
 * Front CLI reply command
 *
 * Creates a draft reply on a conversation.
 * DRAFT only — never auto-send. HITL principle.
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Command } from 'commander'
import { hateoasWrap } from './hateoas'

/**
 * Get Front API client from environment
 */
function getFrontClient() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createInstrumentedFrontClient({ apiToken })
}

/**
 * Normalize Front resource ID or URL to ID
 */
function normalizeId(idOrUrl: string): string {
  return idOrUrl.startsWith('http') ? idOrUrl.split('/').pop()! : idOrUrl
}

/**
 * Command: skill front reply <conversation-id> --body "message text"
 * Creates a DRAFT reply — does NOT auto-send.
 */
async function replyToConversation(
  conversationId: string,
  options: { body: string; author?: string; json?: boolean }
): Promise<void> {
  try {
    const front = getFrontClient()
    const normalizedId = normalizeId(conversationId)

    // Use raw.post because CreateDraft schema requires channel_id,
    // but conversation reply endpoint infers it from the conversation.
    const draft = await front.raw.post<{ id?: string }>(
      `/conversations/${normalizedId}/drafts`,
      {
        body: options.body,
        ...(options.author ? { author_id: options.author } : {}),
      }
    )

    if (options.json) {
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'draft-reply',
            command: `skill front reply ${normalizedId} --body ${JSON.stringify(options.body)}${
              options.author ? ` --author ${options.author}` : ''
            } --json`,
            data: draft,
          }),
          null,
          2
        )
      )
      return
    }

    const draftId = draft.id
    const bodyPreview =
      options.body.length > 100
        ? options.body.slice(0, 100) + '...'
        : options.body

    console.log('')
    console.log(`📝 Draft reply created on ${normalizedId}`)
    if (draftId) {
      console.log(`   Draft ID: ${draftId}`)
    }
    console.log(`   Body preview: ${bodyPreview}`)
    console.log('')
    console.log(`   💡 Review and send from Front.`)
    console.log('')
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Register reply command with Commander
 */
export function registerReplyCommand(frontCommand: Command): void {
  frontCommand
    .command('reply')
    .description('Create a draft reply on a conversation')
    .argument('<conversation-id>', 'Conversation ID (cnv_xxx)')
    .requiredOption('--body <text>', 'Reply body text')
    .option('--author <teammate-id>', 'Author teammate ID')
    .option('--json', 'Output as JSON')
    .action(replyToConversation)
}
