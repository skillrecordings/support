/**
 * Step: TAG
 *
 * Applies appropriate Front tags to conversations based on classification.
 * Tags help organize conversations and enable filtering/reporting in Front.
 *
 * This step runs after classification and is fire-and-forget (failures
 * are logged but don't block the pipeline).
 */

import { FrontApiError, createFrontClient } from '@skillrecordings/front-sdk'
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
      const front = createFrontClient({ apiToken: frontApiToken })
      await front.conversations.addTag(conversationId, tagId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isFrontError = error instanceof FrontApiError
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
  const front = createFrontClient({ apiToken: frontApiToken })
  const applied: string[] = []
  const failed: string[] = []

  for (const tagId of tagIds) {
    try {
      await front.conversations.addTag(conversationId, tagId)
      applied.push(tagId)
    } catch (error) {
      console.error(`[TagStep] Failed to apply tag ${tagId}:`, error)
      failed.push(tagId)
    }
  }

  return { applied, failed }
}
