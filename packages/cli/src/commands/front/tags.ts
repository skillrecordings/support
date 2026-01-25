/**
 * Front CLI tag management commands
 *
 * Provides commands for:
 * - Listing tags with conversation counts
 * - Filtering unused tags
 * - Deleting tags
 * - Renaming tags
 */

import { confirm } from '@inquirer/prompts'
import { createFrontClient } from '@skillrecordings/front-sdk'
import type { Command } from 'commander'

/**
 * Get Front SDK client from environment
 */
function getFrontSdkClient() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createFrontClient({ apiToken })
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 3) + '...'
}

interface TagWithCount {
  id: string
  name: string
  highlight: string | null
  is_private: boolean
  description: string | null
  conversation_count: number
}

/**
 * Get conversation count for a tag
 * Uses the conversations endpoint and checks pagination
 */
async function getConversationCount(
  front: ReturnType<typeof createFrontClient>,
  tagId: string
): Promise<number> {
  try {
    const result = (await front.tags.listConversations(tagId)) as {
      _results?: unknown[]
      _pagination?: { total?: number }
    }
    // Use pagination total if available, otherwise count results
    return result._pagination?.total ?? result._results?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * Command: skill front tags list
 * List all tags with conversation counts
 */
async function listTags(options: {
  json?: boolean
  unused?: boolean
}): Promise<void> {
  try {
    const front = getFrontSdkClient()
    const result = await front.tags.list()

    // Fetch conversation counts for each tag
    const tagsWithCounts: TagWithCount[] = await Promise.all(
      result._results.map(async (tag) => {
        const count = await getConversationCount(front, tag.id)
        return {
          id: tag.id,
          name: tag.name,
          highlight: tag.highlight ?? null,
          is_private: tag.is_private,
          description: tag.description ?? null,
          conversation_count: count,
        }
      })
    )

    // Filter to unused if requested
    const filteredTags = options.unused
      ? tagsWithCounts.filter((t) => t.conversation_count === 0)
      : tagsWithCounts

    if (options.json) {
      console.log(JSON.stringify(filteredTags, null, 2))
      return
    }

    if (filteredTags.length === 0) {
      if (options.unused) {
        console.log('\n✨ No unused tags found!\n')
      } else {
        console.log('\n📭 No tags found.\n')
      }
      return
    }

    const header = options.unused ? '🏷️  Unused Tags' : '🏷️  All Tags'
    console.log(`\n${header} (${filteredTags.length}):`)
    console.log('-'.repeat(80))

    // Table header
    console.log(
      `${'ID'.padEnd(20)} ${'Name'.padEnd(30)} ${'Color'.padEnd(10)} ${'Convos'.padEnd(8)}`
    )
    console.log('-'.repeat(80))

    for (const tag of filteredTags) {
      const highlight = tag.highlight || '-'
      const countStr =
        tag.conversation_count === 0 ? '0 ⚠️' : tag.conversation_count.toString()

      console.log(
        `${truncate(tag.id, 20).padEnd(20)} ${truncate(tag.name, 30).padEnd(30)} ${highlight.padEnd(10)} ${countStr.padEnd(8)}`
      )
    }

    console.log('')

    if (!options.unused) {
      const unusedCount = tagsWithCounts.filter(
        (t) => t.conversation_count === 0
      ).length
      if (unusedCount > 0) {
        console.log(
          `💡 Found ${unusedCount} unused tag(s). Use --unused to filter.\n`
        )
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
 * Command: skill front tags delete <id>
 * Delete a tag by ID
 */
async function deleteTag(
  id: string,
  options: { force?: boolean }
): Promise<void> {
  try {
    const front = getFrontSdkClient()

    // Fetch tag details first
    const tag = await front.tags.get(id)
    const convCount = await getConversationCount(front, id)

    if (!options.force) {
      console.log(`\n🏷️  Tag: ${tag.name}`)
      console.log(`   ID: ${tag.id}`)
      console.log(`   Conversations: ${convCount}`)

      if (convCount > 0) {
        console.log(
          `\n⚠️  Warning: This tag is used in ${convCount} conversation(s).`
        )
        console.log(
          '   Deleting it will remove the tag from those conversations.'
        )
      }

      const confirmed = await confirm({
        message: `Are you sure you want to delete tag "${tag.name}"?`,
        default: false,
      })

      if (!confirmed) {
        console.log('\n❌ Cancelled.\n')
        return
      }
    }

    await front.tags.delete(id)
    console.log(`\n✅ Deleted tag "${tag.name}" (${id})\n`)
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : 'Unknown error'
    )
    process.exit(1)
  }
}

/**
 * Command: skill front tags rename <id> <name>
 * Rename a tag
 */
async function renameTag(id: string, newName: string): Promise<void> {
  try {
    const front = getFrontSdkClient()

    // Fetch current tag details
    const oldTag = await front.tags.get(id)
    const oldName = oldTag.name

    // Update the tag
    const updatedTag = await front.tags.update(id, { name: newName })

    console.log(`\n✅ Renamed tag:`)
    console.log(`   "${oldName}" → "${updatedTag.name}"`)
    console.log(`   ID: ${id}\n`)
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : 'Unknown error'
    )
    process.exit(1)
  }
}

/**
 * Register tag commands with Commander
 */
export function registerTagCommands(frontCommand: Command): void {
  const tags = frontCommand.command('tags').description('Manage Front tags')

  tags
    .command('list')
    .description('List all tags with conversation counts')
    .option('--json', 'Output as JSON')
    .option('--unused', 'Show only tags with 0 conversations')
    .action(listTags)

  tags
    .command('delete')
    .description('Delete a tag by ID')
    .argument('<id>', 'Tag ID (e.g., tag_xxx)')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(deleteTag)

  tags
    .command('rename')
    .description('Rename a tag')
    .argument('<id>', 'Tag ID (e.g., tag_xxx)')
    .argument('<name>', 'New tag name')
    .action(renameTag)
}
