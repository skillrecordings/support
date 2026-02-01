/**
 * Step: TAG
 *
 * Applies appropriate Front tags to conversations based on classification.
 * Tags help organize conversations and enable filtering/reporting in Front.
 *
 * This step runs after classification and is fire-and-forget (failures
 * are logged but don't block the pipeline).
 */

import { FrontApiError } from '@skillrecordings/front-sdk'
import { createInstrumentedFrontClient } from '../../front/instrumented-client'
import { log } from '../../observability/axiom'
import { type TagRegistry, createTagRegistry } from '../../tags/registry'
import type { MessageCategory, TagInput, TagOutput } from '../types'

// ============================================================================
// Options
// ============================================================================

export interface TagStepOptions {
  /** Front API token */
  frontApiToken: string
  /** Optional pre-initialized TagRegistry (for efficiency across calls) */
  tagRegistry?: TagRegistry
  /** Enable debug logging */
  debug?: boolean
}

// ============================================================================
// Tag Step
// ============================================================================

async function addTagToConversation(
  frontApiToken: string,
  conversationId: string,
  tagId: string
): Promise<void> {
  const baseClient = createInstrumentedFrontClient({
    apiToken: frontApiToken,
  }).raw

  await baseClient.post(`/conversations/${conversationId}/tags`, {
    tag_ids: [tagId],
  })
}

/**
 * Apply a tag to a Front conversation based on category.
 *
 * @param input - Conversation ID and category
 * @param options - Front API token and optional registry
 * @returns Result with success status and tag info
 *
 * @example
 * ```ts
 * const result = await applyTag(
 *   { conversationId: 'cnv_123', category: 'support_access', appConfig },
 *   { frontApiToken: 'xxx' }
 * )
 * // result: { tagged: true, tagId: 'tag_abc', tagName: 'access-issue' }
 * ```
 */
export async function applyTag(
  input: TagInput,
  options: TagStepOptions
): Promise<TagOutput> {
  const startTime = Date.now()
  const { conversationId, category } = input
  const { frontApiToken, debug } = options

  try {
    // Get or create tag registry
    let registry: TagRegistry
    try {
      registry =
        options.tagRegistry ?? createTagRegistry({ frontApiToken, debug })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await log('error', 'tag registry creation failed', {
        step: 'apply-tag',
        conversationId,
        category,
        error: message,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
      })
      return {
        tagged: false,
        error: `Registry creation failed: ${message}`,
        durationMs: Date.now() - startTime,
      }
    }

    // Get tag ID for this category
    let tagId: string | undefined
    try {
      tagId = await registry.getTagIdForCategory(category)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isFrontError = error instanceof FrontApiError
      await log('error', 'tag ID lookup failed', {
        step: 'apply-tag',
        conversationId,
        category,
        error: message,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
        frontApiStatus: isFrontError ? error.status : undefined,
        frontApiTitle: isFrontError ? error.title : undefined,
      })
      return {
        tagged: false,
        error: `Tag lookup failed: ${message}`,
        durationMs: Date.now() - startTime,
      }
    }

    const tagName = registry.getTagNameForCategory(category)

    if (!tagId) {
      await log('error', 'tag ID not found for category', {
        step: 'apply-tag',
        conversationId,
        category,
        tagName,
        error: `Could not get/create tag for category: ${category}`,
      })
      return {
        tagged: false,
        tagName,
        error: `Could not get/create tag for category: ${category}`,
        durationMs: Date.now() - startTime,
      }
    }

    // Apply tag to conversation via Front API
    try {
      await addTagToConversation(frontApiToken, conversationId, tagId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isFrontError = error instanceof FrontApiError

      // Check for archived tag error - attempt recovery by recreating the tag
      const isArchivedError =
        message.toLowerCase().includes('archived') ||
        (isFrontError && error.title?.toLowerCase().includes('archived'))

      if (isArchivedError) {
        await log('warn', 'Tag is archived, attempting recovery', {
          step: 'apply-tag',
          conversationId,
          category,
          tagId,
          tagName,
          originalError: message,
        })

        // Clear the stale tag from cache
        registry.clearCache()

        // Get the tag config to recreate it
        const config = registry.getTagConfigForCategory(category)

        try {
          const front = createInstrumentedFrontClient({
            apiToken: frontApiToken,
          })
          // Try to delete the archived tag first (if allowed)
          try {
            await front.tags.delete(tagId)
            await log('info', 'Deleted archived tag', {
              step: 'apply-tag',
              tagId,
              tagName,
            })
          } catch (deleteErr) {
            // Ignore delete errors - tag might not be deletable
            await log('debug', 'Could not delete archived tag (continuing)', {
              step: 'apply-tag',
              tagId,
              error:
                deleteErr instanceof Error
                  ? deleteErr.message
                  : String(deleteErr),
            })
          }

          // Create a fresh tag with the same name
          const newTag = await front.tags.create({
            name: config.tagName,
            description: config.description,
            highlight: config.highlight,
          })

          await log('info', 'Recreated tag after archive recovery', {
            step: 'apply-tag',
            conversationId,
            category,
            oldTagId: tagId,
            newTagId: newTag.id,
            tagName: config.tagName,
          })

          // Retry applying with the new tag ID
          await addTagToConversation(frontApiToken, conversationId, newTag.id)

          return {
            tagged: true,
            tagId: newTag.id,
            tagName,
            recovered: true,
            durationMs: Date.now() - startTime,
          }
        } catch (recoveryError) {
          const recoveryMsg =
            recoveryError instanceof Error
              ? recoveryError.message
              : String(recoveryError)
          await log('error', 'Tag recovery failed', {
            step: 'apply-tag',
            conversationId,
            category,
            tagId,
            tagName,
            originalError: message,
            recoveryError: recoveryMsg,
          })
          return {
            tagged: false,
            tagId,
            tagName,
            error: `Tag archived and recovery failed: ${recoveryMsg}`,
            durationMs: Date.now() - startTime,
          }
        }
      }

      // Non-archived error - log and fail
      await log('error', 'Front API addTag call failed', {
        step: 'apply-tag',
        conversationId,
        category,
        tagId,
        tagName,
        error: message,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
        frontApiStatus: isFrontError ? error.status : undefined,
        frontApiTitle: isFrontError ? error.title : undefined,
      })
      return {
        tagged: false,
        tagId,
        tagName,
        error: `Front API addTag failed: ${message}`,
        durationMs: Date.now() - startTime,
      }
    }

    if (debug) {
      console.log(
        `[TagStep] Applied tag "${tagName}" (${tagId}) to ${conversationId}`
      )
    }

    return {
      tagged: true,
      tagId,
      tagName,
      durationMs: Date.now() - startTime,
    }
  } catch (error) {
    // Unexpected error — something outside the specific try/catches above
    const message = error instanceof Error ? error.message : String(error)
    await log('error', 'tag step unexpected error', {
      step: 'apply-tag',
      conversationId,
      category,
      error: message,
      errorType: error instanceof Error ? error.constructor.name : 'unknown',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return {
      tagged: false,
      error: `Unexpected: ${message}`,
      durationMs: Date.now() - startTime,
    }
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a tag step function with pre-configured options.
 *
 * @example
 * ```ts
 * const tagStep = createTagStep({ frontApiToken: 'xxx' })
 * await tagStep({ conversationId: 'cnv_123', category: 'spam', appConfig })
 * ```
 */
export function createTagStep(options: TagStepOptions) {
  return (input: TagInput) => applyTag(input, options)
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get all tags that should be applied for a category.
 * Some categories may map to multiple tags.
 *
 * @param category - Message category
 * @param registry - TagRegistry instance
 * @returns Array of tag IDs
 */
export async function getTagsForCategory(
  category: MessageCategory,
  registry: TagRegistry
): Promise<string[]> {
  const tagId = await registry.getTagIdForCategory(category)
  return tagId ? [tagId] : []
}

/**
 * Apply multiple tags to a conversation.
 * Useful when a conversation needs multiple category tags.
 *
 * @param conversationId - Front conversation ID
 * @param tagIds - Array of tag IDs to apply
 * @param frontApiToken - Front API token
 */
export async function applyMultipleTags(
  conversationId: string,
  tagIds: string[],
  frontApiToken: string
): Promise<{ applied: string[]; failed: string[] }> {
  const applied: string[] = []
  const failed: string[] = []

  for (const tagId of tagIds) {
    try {
      await addTagToConversation(frontApiToken, conversationId, tagId)
      applied.push(tagId)
    } catch (error) {
      console.error(`[TagStep] Failed to apply tag ${tagId}:`, error)
      failed.push(tagId)
    }
  }

  return { applied, failed }
}
