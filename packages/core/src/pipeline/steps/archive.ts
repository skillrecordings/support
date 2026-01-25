/**
 * Step: ARCHIVE
 *
 * Archives Front conversations when the routing decision is "silence".
 * Archiving removes conversations from the inbox without deleting them.
 *
 * Archive conditions:
 * - Route action is 'silence'
 * - Categories: spam, system, resolved, awaiting_customer
 *
 * This step runs after routing and is fire-and-forget (failures
 * are logged but don't block the pipeline).
 */

import { createFrontClient } from '@skillrecordings/front-sdk'
import type { ArchiveInput, ArchiveOutput, RouteAction } from '../types'

// ============================================================================
// Options
// ============================================================================

export interface ArchiveStepOptions {
  /** Front API token */
  frontApiToken: string
  /** Enable debug logging */
  debug?: boolean
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Route actions that should trigger archiving.
 */
const ARCHIVABLE_ACTIONS: RouteAction[] = ['silence']

// ============================================================================
// Archive Step
// ============================================================================

/**
 * Check if a conversation should be archived based on route action.
 */
export function shouldArchive(action: RouteAction): boolean {
  return ARCHIVABLE_ACTIONS.includes(action)
}

/**
 * Archive a Front conversation.
 *
 * Only archives if the route action is 'silence'. Other actions
 * (respond, escalate_*) keep the conversation in the inbox.
 *
 * @param input - Conversation ID, action, and reason
 * @param options - Front API token
 * @returns Result with success status
 *
 * @example
 * ```ts
 * const result = await archiveConversation(
 *   { conversationId: 'cnv_123', action: 'silence', reason: 'spam', appConfig },
 *   { frontApiToken: 'xxx' }
 * )
 * // result: { archived: true }
 * ```
 */
export async function archiveConversation(
  input: ArchiveInput,
  options: ArchiveStepOptions
): Promise<ArchiveOutput> {
  const startTime = Date.now()
  const { conversationId, action, reason } = input
  const { frontApiToken, debug } = options

  // Only archive for silence actions
  if (!shouldArchive(action)) {
    if (debug) {
      console.log(
        `[ArchiveStep] Skipping archive for ${conversationId} - action is "${action}"`
      )
    }
    return {
      archived: false,
      durationMs: Date.now() - startTime,
    }
  }

  try {
    const front = createFrontClient({ apiToken: frontApiToken })

    // Archive the conversation by setting status to 'archived'
    await front.conversations.update(conversationId, {
      status: 'archived',
    })

    if (debug) {
      console.log(
        `[ArchiveStep] Archived ${conversationId} (reason: ${reason})`
      )
    }

    return {
      archived: true,
      durationMs: Date.now() - startTime,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[ArchiveStep] Failed to archive ${conversationId}:`, message)

    return {
      archived: false,
      error: message,
      durationMs: Date.now() - startTime,
    }
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create an archive step function with pre-configured options.
 *
 * @example
 * ```ts
 * const archiveStep = createArchiveStep({ frontApiToken: 'xxx' })
 * await archiveStep({ conversationId: 'cnv_123', action: 'silence', reason: 'spam', appConfig })
 * ```
 */
export function createArchiveStep(options: ArchiveStepOptions) {
  return (input: ArchiveInput) => archiveConversation(input, options)
}
