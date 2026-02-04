/**
 * Front CLI reply command
 *
 * Creates a draft reply on a conversation.
 * DRAFT only — never auto-send. HITL principle.
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Command } from 'commander'
import { hateoasWrap } from './hateoas'
import { writeJsonOutput } from './json-output'

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
      writeJsonOutput(
        hateoasWrap({
          type: 'draft-reply',
          command: `skill front reply ${normalizedId} --body ${JSON.stringify(options.body)}${
            options.author ? ` --author ${options.author}` : ''
          } --json`,
          data: draft,
        })
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
    .addHelpText(
      'after',
      `
━━━ Draft Reply (HITL — Human-in-the-Loop) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚠️  SAFETY: This command creates a DRAFT only. It NEVER auto-sends.
  The draft appears in Front for a human to review, edit, and send manually.
  This is by design — the HITL principle ensures no message goes out without
  human approval.

USAGE
  skill front reply <conversation-id> --body "Your reply text here"

OPTIONS
  --body <text>              Required. The reply body text.
                             Accepts plain text or HTML.
  --author <teammate-id>     Optional. Teammate ID (tea_xxx) to set as sender.
                             Defaults to the API token owner.
  --json                     Output as JSON.

BODY FORMAT
  Plain text:   --body "Thanks for reaching out. We'll look into this."
  HTML:         --body "<p>Hi there,</p><p>Your refund has been processed.</p>"

  For multi-line plain text, the body will render as-is in the Front draft.

JSON OUTPUT (--json)
  Returns a HATEOAS-wrapped object:
    { type: "draft-reply", data: { id, ... } }

WORKFLOW
  1. Read the conversation first:
       skill front conversation cnv_abc123 -m
  2. Draft a reply:
       skill front reply cnv_abc123 --body "We've processed your request."
  3. Open Front → review the draft → edit if needed → click Send.

EXAMPLES
  # Simple draft reply
  skill front reply cnv_abc123 --body "Thanks, we're looking into this now."

  # HTML reply with specific author
  skill front reply cnv_abc123 \\
    --body "<p>Hi! Your license has been transferred.</p>" \\
    --author tea_def456

  # Draft reply and capture the draft ID
  skill front reply cnv_abc123 --body "Processing your refund." --json \\
    | jq '.data.id'

RELATED COMMANDS
  skill front conversation <id> -m    View conversation + message history
  skill front message <id>            View a specific message body
  skill front search                  Find conversations to reply to
`
    )
    .action(replyToConversation)
}
