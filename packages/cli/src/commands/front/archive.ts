/**
 * Front CLI archive command
 *
 * Archives one or more conversations via Front API
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
 * Archive a single conversation
 */
async function archiveConversation(
  front: ReturnType<typeof createInstrumentedFrontClient>,
  convId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const normalizedId = normalizeId(convId)
    await front.raw.patch(`/conversations/${normalizedId}`, {
      status: 'archived',
    })
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Command: skill front archive <id> [ids...]
 * Archive one or more conversations
 */
async function archiveConversations(
  convId: string,
  additionalIds: string[],
  options: { json?: boolean }
): Promise<void> {
  try {
    const front = getFrontClient()
    const allIds = [convId, ...additionalIds]

    if (options.json) {
      // JSON output: show results for each conversation
      const results = await Promise.all(
        allIds.map(async (id) => {
          const result = await archiveConversation(front, id)
          return {
            id: normalizeId(id),
            success: result.success,
            error: result.error,
          }
        })
      )
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'archive-result',
            command: `skill front archive ${allIds.map(normalizeId).join(' ')} --json`,
            data: results,
          }),
          null,
          2
        )
      )
      return
    }

    // Human-readable output
    console.log(`\n📦 Archiving ${allIds.length} conversation(s)...\n`)

    const results = await Promise.all(
      allIds.map(async (id) => {
        const normalizedId = normalizeId(id)
        const result = await archiveConversation(front, id)

        if (result.success) {
          console.log(`   ✅ Archived ${normalizedId}`)
        } else {
          console.log(
            `   ❌ Failed to archive ${normalizedId}: ${result.error}`
          )
        }

        return result
      })
    )

    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length

    console.log('')
    console.log(`📊 Summary:`)
    console.log(`   ✅ Successful: ${successCount}`)
    if (failureCount > 0) {
      console.log(`   ❌ Failed: ${failureCount}`)
    }
    console.log('')

    // Exit with error code if any failed
    if (failureCount > 0) {
      process.exit(1)
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
 * Register archive command with Commander
 */
export function registerArchiveCommand(frontCommand: Command): void {
  frontCommand
    .command('archive')
    .description('Archive one or more conversations by ID')
    .argument('<id>', 'Conversation ID (e.g., cnv_xxx)')
    .argument('[ids...]', 'Additional conversation IDs to archive')
    .option('--json', 'Output as JSON')
    .action(archiveConversations)
}
