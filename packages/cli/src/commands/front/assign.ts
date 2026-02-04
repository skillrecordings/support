/**
 * Front CLI assign command
 *
 * Assigns or unassigns a conversation via Front API
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
 * Command: skill front assign <conversation-id> [teammate-id]
 * Assign a conversation to a teammate, or unassign with --unassign
 */
async function assignConversation(
  conversationId: string,
  teammateId: string | undefined,
  options: { json?: boolean; unassign?: boolean }
): Promise<void> {
  try {
    const front = getFrontClient()
    const convId = normalizeId(conversationId)

    if (!teammateId && !options.unassign) {
      throw new Error(
        'Provide a teammate ID or use --unassign to remove assignment'
      )
    }

    if (teammateId && options.unassign) {
      throw new Error('Cannot provide both teammate ID and --unassign')
    }

    const assigneeId = options.unassign ? '' : normalizeId(teammateId!)

    await front.conversations.updateAssignee(convId, assigneeId)

    if (options.json) {
      writeJsonOutput(
        hateoasWrap({
          type: 'assign-result',
          command: options.unassign
            ? `skill front assign ${convId} --unassign --json`
            : `skill front assign ${convId} ${assigneeId} --json`,
          data: {
            id: convId,
            assignee: options.unassign ? null : assigneeId,
            success: true,
          },
        })
      )
    } else {
      if (options.unassign) {
        console.log(`✅ Unassigned ${convId}`)
      } else {
        console.log(`✅ Assigned ${convId} to ${assigneeId}`)
      }
    }
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
 * Register assign command with Commander
 */
export function registerAssignCommand(frontCommand: Command): void {
  frontCommand
    .command('assign')
    .description('Assign a conversation to a teammate')
    .argument('<conversation-id>', 'Conversation ID (cnv_xxx)')
    .argument('[teammate-id]', 'Teammate ID (tea_xxx) - omit with --unassign')
    .option('--unassign', 'Remove assignee')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
━━━ Assign / Unassign Conversations ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Assign a conversation to a teammate, or remove the current assignee.
  Accepts conversation IDs (cnv_xxx) and teammate IDs (tea_xxx).

ASSIGN
  skill front assign <conversation-id> <teammate-id>

  The teammate must exist in your Front workspace.

UNASSIGN
  skill front assign <conversation-id> --unassign

  Removes the current assignee. Cannot be combined with a teammate ID.

FINDING IDs
  Teammate IDs:
    skill front teammates                                 # Human-readable list
    skill front teammates --json | jq '.[].id'            # Just the IDs

  Conversation IDs:
    skill front search --inbox inb_xxx --json | jq '.data.conversations[].id'
    skill front conversation <cnv_xxx>                    # Verify a conversation

JSON OUTPUT (--json)
  Returns a HATEOAS-wrapped object:
    { type: "assign-result", data: { id, assignee, success } }

EXAMPLES
  # Assign a conversation to a teammate
  skill front assign cnv_abc123 tea_def456

  # Unassign (remove assignee)
  skill front assign cnv_abc123 --unassign

  # Assign and get JSON output
  skill front assign cnv_abc123 tea_def456 --json

  # Pipeline: assign all unassigned convos in an inbox to a teammate
  skill front search --inbox inb_4bj7r --status unassigned --json \\
    | jq -r '.data.conversations[].id' \\
    | xargs -I{} skill front assign {} tea_def456

RELATED COMMANDS
  skill front teammates              List teammates and their IDs
  skill front conversation <id>      View conversation details + current assignee
  skill front search                 Find conversations by filters
`
    )
    .action(assignConversation)
}
