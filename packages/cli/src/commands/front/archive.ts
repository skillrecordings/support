/**
 * Front CLI archive command
 *
 * Archives one or more conversations via Front API
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { hateoasWrap } from './hateoas'

/**
 * Get Front API client from environment
 */
function getFrontClient() {
  return createInstrumentedFrontClient({ apiToken: requireFrontToken() })
}

function requireFrontToken(): string {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new CLIError({
      userMessage: 'FRONT_API_TOKEN environment variable is required.',
      suggestion: 'Set FRONT_API_TOKEN in your shell or .env.local.',
    })
  }
  return apiToken
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
export async function archiveConversations(
  ctx: CommandContext,
  convId: string,
  additionalIds: string[],
  options: { json?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const front = getFrontClient()
    const allIds = [convId, ...additionalIds]

    if (outputJson) {
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
      ctx.output.data(
        hateoasWrap({
          type: 'archive-result',
          command: `skill front archive ${allIds.map(normalizeId).join(' ')} --json`,
          data: results,
        })
      )
      return
    }

    // Human-readable output
    ctx.output.data(`\n📦 Archiving ${allIds.length} conversation(s)...\n`)

    const results = await Promise.all(
      allIds.map(async (id) => {
        const normalizedId = normalizeId(id)
        const result = await archiveConversation(front, id)

        if (result.success) {
          ctx.output.data(`   ✅ Archived ${normalizedId}`)
        } else {
          ctx.output.data(
            `   ❌ Failed to archive ${normalizedId}: ${result.error}`
          )
        }

        return result
      })
    )

    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length

    ctx.output.data('')
    ctx.output.data(`📊 Summary:`)
    ctx.output.data(`   ✅ Successful: ${successCount}`)
    if (failureCount > 0) {
      ctx.output.data(`   ❌ Failed: ${failureCount}`)
    }
    ctx.output.data('')

    // Exit with error code if any failed
    if (failureCount > 0) {
      const cliError = new CLIError({
        userMessage: 'One or more conversations failed to archive.',
        suggestion: 'Review the output above for failed IDs.',
      })
      ctx.output.error(formatError(cliError))
      process.exitCode = cliError.exitCode
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to archive Front conversations.',
            suggestion: 'Verify the conversation IDs and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
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
    .action(
      async (
        id: string,
        ids: string[],
        options: { json?: boolean },
        command: Command
      ) => {
        const opts =
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals()
            : {
                ...command.parent?.opts(),
                ...command.opts(),
              }
        const ctx = await createContext({
          format: options.json ? 'json' : opts.format,
          verbose: opts.verbose,
          quiet: opts.quiet,
        })
        await archiveConversations(ctx, id, ids ?? [], options)
      }
    )
}
