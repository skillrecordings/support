/**
 * Tag Registry Service
 *
 * Maps message categories to Front tags with caching.
 * Auto-creates missing tags with appropriate highlight colors.
 *
 * @see https://dev.frontapp.com/reference/tags
 */

import { FrontApiError, createFrontClient } from '@skillrecordings/front-sdk'
import { log } from '../observability/axiom'
import type {
  CategoryTagConfig,
  CategoryTagMapping,
  MessageCategory,
  TagHighlight,
} from '../pipeline/types'

// ============================================================================
// Default Category → Tag Mapping
// ============================================================================

/**
 * Default mapping of message categories to Front tags.
 * Each category maps to a tag name and highlight color.
 */
export const DEFAULT_CATEGORY_TAG_MAPPING: CategoryTagMapping = {
  // Spam/System (red/grey - don't respond)
  spam: { tagName: 'spam', highlight: 'red', description: 'Spam or marketing' },
  system: {
    tagName: 'system',
    highlight: 'grey',
    description: 'Automated notifications',
  },

  // Support categories (blue family)
  support_access: {
    tagName: 'access-issue',
    highlight: 'blue',
    description: 'Login or access problems',
  },
  support_refund: {
    tagName: 'refund',
    highlight: 'yellow',
    description: 'Refund requests',
  },
  support_transfer: {
    tagName: 'transfer',
    highlight: 'green',
    description: 'License transfers',
  },
  support_technical: {
    tagName: 'technical',
    highlight: 'purple',
    description: 'Technical or product questions',
  },
  support_billing: {
    tagName: 'billing',
    highlight: 'orange',
    description: 'Invoice or payment issues',
  },

  // Fan mail (pink - positive)
  fan_mail: {
    tagName: 'fan-mail',
    highlight: 'pink',
    description: 'Positive feedback to instructor',
  },

  // Presales (teal family)
  presales_faq: {
    tagName: 'presales',
    highlight: 'teal',
    description: 'Pre-purchase questions',
  },
  presales_consult: {
    tagName: 'presales',
    highlight: 'teal',
    description: 'Pre-purchase consultation',
  },
  presales_team: {
    tagName: 'presales-enterprise',
    highlight: 'teal',
    description: 'Enterprise/team inquiries',
  },

  // Voice of customer (green - valuable feedback)
  voc_response: {
    tagName: 'voc',
    highlight: 'green',
    description: 'Voice of customer responses',
  },

  // Thread-aware categories
  instructor_strategy: {
    tagName: 'instructor',
    highlight: 'purple',
    description: 'Instructor discussions',
  },
  resolved: {
    tagName: 'resolved',
    highlight: 'green',
    description: 'Thread already resolved',
  },
  awaiting_customer: {
    tagName: 'awaiting-reply',
    highlight: 'grey',
    description: 'Waiting for customer',
  },

  // Unknown (black - needs review)
  unknown: {
    tagName: 'needs-review',
    highlight: 'black',
    description: 'Could not classify',
  },
}

// ============================================================================
// Tag Registry Class
// ============================================================================

export interface TagRegistryOptions {
  /** Front API token */
  frontApiToken: string
  /** Override default category→tag mapping */
  categoryMapping?: Partial<CategoryTagMapping>
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Registry for managing Front tags.
 *
 * Features:
 * - Maps categories to tag names with colors
 * - Caches tag IDs after first lookup
 * - Auto-creates missing tags
 *
 * @example
 * ```ts
 * const registry = new TagRegistry({ frontApiToken: 'xxx' })
 * const tagId = await registry.getTagIdForCategory('support_access')
 * // Returns 'tag_xxx' or creates if missing
 * ```
 */
export class TagRegistry {
  private front: ReturnType<typeof createFrontClient>
  private categoryMapping: CategoryTagMapping
  private tagIdCache: Map<string, string> = new Map()
  private initialized = false
  private debug: boolean

  constructor(options: TagRegistryOptions) {
    this.front = createFrontClient({ apiToken: options.frontApiToken })
    this.categoryMapping = {
      ...DEFAULT_CATEGORY_TAG_MAPPING,
      ...options.categoryMapping,
    }
    this.debug = options.debug ?? false
  }

  /**
   * Initialize the registry by fetching all existing tags.
   * Call this once before using getTagIdForCategory.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      const tags = await this.front.tags.list()
      for (const tag of tags._results) {
        this.tagIdCache.set(tag.name.toLowerCase(), tag.id)
      }
      this.initialized = true

      await log('debug', 'tag registry initialized', {
        component: 'TagRegistry',
        tagCount: tags._results.length,
        tagNames: tags._results.map((t) => t.name).slice(0, 20),
      })

      if (this.debug) {
        console.log(
          `[TagRegistry] Initialized with ${tags._results.length} tags`
        )
      }
    } catch (error) {
      const isFrontError = error instanceof FrontApiError
      const message = error instanceof Error ? error.message : String(error)

      await log('error', 'tag registry initialization failed', {
        component: 'TagRegistry',
        error: message,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
        frontApiStatus: isFrontError ? error.status : undefined,
        frontApiTitle: isFrontError ? error.title : undefined,
      })

      console.error('[TagRegistry] Failed to initialize:', error)
      throw error
    }
  }

  /**
   * Get the tag configuration for a category.
   */
  getTagConfigForCategory(category: MessageCategory): CategoryTagConfig {
    return this.categoryMapping[category] ?? this.categoryMapping.unknown
  }

  /**
   * Get the tag name for a category.
   */
  getTagNameForCategory(category: MessageCategory): string {
    return this.getTagConfigForCategory(category).tagName
  }

  /**
   * Get the highlight color for a category.
   */
  getHighlightForCategory(category: MessageCategory): TagHighlight {
    return this.getTagConfigForCategory(category).highlight
  }

  /**
   * Get or create a tag ID for a category.
   *
   * @param category - The message category
   * @returns Tag ID (tag_xxx) or undefined if failed
   */
  async getTagIdForCategory(
    category: MessageCategory
  ): Promise<string | undefined> {
    // Initialize if needed
    if (!this.initialized) {
      await this.initialize()
    }

    const config = this.getTagConfigForCategory(category)
    const tagName = config.tagName.toLowerCase()

    // Check cache first
    if (this.tagIdCache.has(tagName)) {
      return this.tagIdCache.get(tagName)
    }

    // Tag not in cache — try to create it
    await log('info', 'tag not in cache, attempting creation', {
      component: 'TagRegistry',
      category,
      tagName: config.tagName,
      cachedTagCount: this.tagIdCache.size,
    })

    try {
      if (this.debug) {
        console.log(`[TagRegistry] Creating tag: ${config.tagName}`)
      }
      const newTag = await this.front.tags.create({
        name: config.tagName,
        description: config.description,
        highlight: config.highlight,
      })
      this.tagIdCache.set(tagName, newTag.id)

      await log('info', 'tag created successfully', {
        component: 'TagRegistry',
        category,
        tagName: config.tagName,
        tagId: newTag.id,
      })

      return newTag.id
    } catch (error) {
      const isFrontError = error instanceof FrontApiError
      const message = error instanceof Error ? error.message : String(error)

      await log('warn', 'tag creation failed, attempting re-fetch', {
        component: 'TagRegistry',
        category,
        tagName: config.tagName,
        error: message,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
        frontApiStatus: isFrontError ? error.status : undefined,
      })

      // Tag might already exist (race condition) - try to find it
      if (this.debug) {
        console.log(`[TagRegistry] Create failed, re-fetching tags:`, error)
      }
      try {
        const tags = await this.front.tags.list()
        const existing = tags._results.find(
          (t) => t.name.toLowerCase() === tagName
        )
        if (existing) {
          this.tagIdCache.set(tagName, existing.id)

          await log('info', 'found existing tag on re-fetch', {
            component: 'TagRegistry',
            category,
            tagName: config.tagName,
            tagId: existing.id,
          })

          return existing.id
        }

        await log('error', 'tag not found on re-fetch either', {
          component: 'TagRegistry',
          category,
          tagName: config.tagName,
          availableTags: tags._results.map((t) => t.name).slice(0, 30),
        })
      } catch (refetchError) {
        const refetchMsg =
          refetchError instanceof Error
            ? refetchError.message
            : String(refetchError)
        await log('error', 'tag re-fetch also failed', {
          component: 'TagRegistry',
          category,
          tagName: config.tagName,
          originalError: message,
          refetchError: refetchMsg,
        })
      }

      console.error(
        `[TagRegistry] Failed to get/create tag for ${category}:`,
        error
      )
      return undefined
    }
  }

  /**
   * Get tag ID by tag name directly (for non-category tags).
   */
  async getTagIdByName(tagName: string): Promise<string | undefined> {
    if (!this.initialized) {
      await this.initialize()
    }

    const normalizedName = tagName.toLowerCase()
    if (this.tagIdCache.has(normalizedName)) {
      return this.tagIdCache.get(normalizedName)
    }

    // Not in cache, tag doesn't exist
    return undefined
  }

  /**
   * Clear the tag ID cache. Useful if tags were modified externally.
   */
  clearCache(): void {
    this.tagIdCache.clear()
    this.initialized = false
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a TagRegistry instance.
 *
 * @example
 * ```ts
 * const registry = createTagRegistry({ frontApiToken: process.env.FRONT_TOKEN! })
 * const tagId = await registry.getTagIdForCategory('support_access')
 * ```
 */
export function createTagRegistry(options: TagRegistryOptions): TagRegistry {
  return new TagRegistry(options)
}
