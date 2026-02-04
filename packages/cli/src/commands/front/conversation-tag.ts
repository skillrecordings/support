/**
 * Front CLI conversation tag/untag commands
 *
 * Add or remove tags from conversations via Front API
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
 * Resolve a tag name or ID to { id, name }.
 * If the argument starts with `tag_`, treat it as an ID.
 * Otherwise, treat it as a name and do a case-insensitive lookup.
 */
async function resolveTag(
  front: ReturnType<typeof createInstrumentedFrontClient>,
  tagNameOrId: string
): Promise<{ id: string; name: string }> {
  const normalized = normalizeId(tagNameOrId)

  const data = await front.raw.get<{
    _results: Array<{ id: string; name: string }>
  }>('/tags')
  const tags = data._results ?? []

  if (normalized.startsWith('tag_')) {
    const match = tags.find((t) => t.id === normalized)
    return { id: normalized, name: match?.name ?? normalized }
  }

  // Case-insensitive name lookup
  const needle = tagNameOrId.trim().toLowerCase()
  const match = tags.find((t) => t.name.toLowerCase() === needle)

  if (!match) {
    throw new Error(
      `Tag not found: "${tagNameOrId}". Use \`skill front tags list\` to see available tags.`
    )
  }

  return { id: match.id, name: match.name }
}

/**
 * Command: skill front tag <conversation-id> <tag-name-or-id>
 * Add a tag to a conversation
 */
async function tagConversation(
  convId: string,
  tagNameOrId: string,
  options: { json?: boolean }
): Promise<void> {
  try {
    const front = getFrontClient()
    const normalizedConvId = normalizeId(convId)
    const tag = await resolveTag(front, tagNameOrId)

    await front.conversations.addTag(normalizedConvId, tag.id)

    if (options.json) {
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'tag-result',
            command: `skill front tag ${normalizedConvId} ${tagNameOrId} --json`,
            data: {
              conversationId: normalizedConvId,
              tagId: tag.id,
              tagName: tag.name,
              action: 'added',
            },
          }),
          null,
          2
        )
      )
      return
    }

    console.log(
      `\n   ✅ Tagged ${normalizedConvId} with "${tag.name}" (${tag.id})\n`
    )
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
 * Command: skill front untag <conversation-id> <tag-name-or-id>
 * Remove a tag from a conversation
 */
async function untagConversation(
  convId: string,
  tagNameOrId: string,
  options: { json?: boolean }
): Promise<void> {
  try {
    const front = getFrontClient()
    const normalizedConvId = normalizeId(convId)
    const tag = await resolveTag(front, tagNameOrId)

    await front.conversations.removeTag(normalizedConvId, tag.id)

    if (options.json) {
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'untag-result',
            command: `skill front untag ${normalizedConvId} ${tagNameOrId} --json`,
            data: {
              conversationId: normalizedConvId,
              tagId: tag.id,
              tagName: tag.name,
              action: 'removed',
            },
          }),
          null,
          2
        )
      )
      return
    }

    console.log(`\n   ✅ Removed tag "${tag.name}" from ${normalizedConvId}\n`)
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
 * Register tag and untag commands with Commander
 */
export function registerConversationTagCommands(frontCommand: Command): void {
  frontCommand
    .command('tag')
    .description('Add a tag to a conversation')
    .argument('<conversation-id>', 'Conversation ID (cnv_xxx)')
    .argument('<tag-name-or-id>', 'Tag name or ID (tag_xxx)')
    .option('--json', 'Output as JSON')
    .action(tagConversation)

  frontCommand
    .command('untag')
    .description('Remove a tag from a conversation')
    .argument('<conversation-id>', 'Conversation ID (cnv_xxx)')
    .argument('<tag-name-or-id>', 'Tag name or ID (tag_xxx)')
    .option('--json', 'Output as JSON')
    .action(untagConversation)
}
