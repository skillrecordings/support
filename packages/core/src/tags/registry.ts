/**
 * Tag Registry Service
 *
 * Maps message categories to Front tags with caching.
 * Auto-creates missing tags with appropriate highlight colors.
 *
 * @see https://dev.frontapp.com/reference/tags
 */

import { FrontApiError } from '@skillrecordings/front-sdk'
import { createInstrumentedFrontClient } from '../front/instrumented-client'
import { log } from '../observability/axiom'
import type {
  CategoryTagConfig,
  CategoryTagMapping,
  MessageCategory,
  SkillName,
  SkillTagConfig,
  SkillTagMapping,
  TagHighlight,
} from '../pipeline/types'

// ============================================================================
// Skill Tag Configuration
// ============================================================================

/**
 * Prefix for skill-based tags.
 * Skills use pattern: skill/{skill-name} (e.g., skill/refund-request)
 */
export const SKILL_TAG_PREFIX = 'skill/'

/**
 * Default mapping of skills to Front tags.
 * All 45 skills from skills/index.json mapped 1:1.
 */
export const DEFAULT_SKILL_TAG_MAPPING: SkillTagMapping = {
  // Access & Login skills (blue family)
  'access-locked-out': {
    tagName: 'skill/access-locked-out',
    highlight: 'blue',
    description: 'Restore access for locked out customers',
  },
  'login-link': {
    tagName: 'skill/login-link',
    highlight: 'blue',
    description: 'Login link requests',
  },
  'password-reset-issue': {
    tagName: 'skill/password-reset-issue',
    highlight: 'blue',
    description: 'Password reset problems',
  },
  'two-factor-auth-issue': {
    tagName: 'skill/two-factor-auth-issue',
    highlight: 'blue',
    description: '2FA authentication issues',
  },
  'course-content-locked': {
    tagName: 'skill/course-content-locked',
    highlight: 'blue',
    description: 'Purchased content is locked',
  },
  'cohort-access-request': {
    tagName: 'skill/cohort-access-request',
    highlight: 'blue',
    description: 'Cohort materials access',
  },

  // Technical issues (purple family)
  'app-crash-report': {
    tagName: 'skill/app-crash-report',
    highlight: 'purple',
    description: 'Application crashes and bugs',
  },
  'broken-link-404-error': {
    tagName: 'skill/broken-link-404-error',
    highlight: 'purple',
    description: 'Broken links and 404 errors',
  },
  'technical-issue-course-content': {
    tagName: 'skill/technical-issue-course-content',
    highlight: 'purple',
    description: 'Technical issues with course content',
  },
  'website-bug-report': {
    tagName: 'skill/website-bug-report',
    highlight: 'purple',
    description: 'Website bugs and errors',
  },
  'email-delivery-failure': {
    tagName: 'skill/email-delivery-failure',
    highlight: 'purple',
    description: 'Email delivery failures',
  },
  'api-documentation-question': {
    tagName: 'skill/api-documentation-question',
    highlight: 'purple',
    description: 'API and technical documentation',
  },

  // Billing & Payments (orange family)
  'refund-request': {
    tagName: 'skill/refund-request',
    highlight: 'yellow',
    description: 'Refund requests',
  },
  'duplicate-purchase': {
    tagName: 'skill/duplicate-purchase',
    highlight: 'orange',
    description: 'Duplicate purchase issues',
  },
  'invoice-billing-statement': {
    tagName: 'skill/invoice-billing-statement',
    highlight: 'orange',
    description: 'Invoice and billing statements',
  },
  'corporate-invoice': {
    tagName: 'skill/corporate-invoice',
    highlight: 'orange',
    description: 'Corporate invoice requests',
  },
  'payment-method-issue': {
    tagName: 'skill/payment-method-issue',
    highlight: 'orange',
    description: 'Payment method problems',
  },
  'subscription-renewal-issue': {
    tagName: 'skill/subscription-renewal-issue',
    highlight: 'orange',
    description: 'Subscription renewal issues',
  },
  'installment-payment-option': {
    tagName: 'skill/installment-payment-option',
    highlight: 'orange',
    description: 'Payment plan inquiries',
  },

  // Pricing & Discounts (teal family)
  'pricing-inquiry': {
    tagName: 'skill/pricing-inquiry',
    highlight: 'teal',
    description: 'Course pricing questions',
  },
  'ppp-pricing': {
    tagName: 'skill/ppp-pricing',
    highlight: 'teal',
    description: 'PPP pricing requests',
  },
  'discount-code-request': {
    tagName: 'skill/discount-code-request',
    highlight: 'teal',
    description: 'Discount code requests',
  },
  'student-discount-request': {
    tagName: 'skill/student-discount-request',
    highlight: 'teal',
    description: 'Student discount inquiries',
  },
  'nonprofit-government-discount': {
    tagName: 'skill/nonprofit-government-discount',
    highlight: 'teal',
    description: 'Nonprofit/government discounts',
  },
  'scholarship-financial-aid': {
    tagName: 'skill/scholarship-financial-aid',
    highlight: 'teal',
    description: 'Scholarship and financial aid',
  },
  'price-feedback': {
    tagName: 'skill/price-feedback',
    highlight: 'teal',
    description: 'Pricing feedback and concerns',
  },

  // Account & License (green family)
  'email-change': {
    tagName: 'skill/email-change',
    highlight: 'green',
    description: 'Email/license transfers',
  },
  'team-license-purchase': {
    tagName: 'skill/team-license-purchase',
    highlight: 'green',
    description: 'Team/bulk license purchases',
  },
  'gift-purchase-option': {
    tagName: 'skill/gift-purchase-option',
    highlight: 'green',
    description: 'Gift purchase inquiries',
  },

  // Content & Learning (pink family)
  'lesson-content-question': {
    tagName: 'skill/lesson-content-question',
    highlight: 'pink',
    description: 'Lesson content questions',
  },
  'content-feedback': {
    tagName: 'skill/content-feedback',
    highlight: 'pink',
    description: 'Content feedback and suggestions',
  },
  'outdated-course-content': {
    tagName: 'skill/outdated-course-content',
    highlight: 'pink',
    description: 'Outdated content reports',
  },
  'course-difficulty-concern': {
    tagName: 'skill/course-difficulty-concern',
    highlight: 'pink',
    description: 'Course difficulty questions',
  },
  'learning-path-guidance': {
    tagName: 'skill/learning-path-guidance',
    highlight: 'pink',
    description: 'Learning path recommendations',
  },
  'certificate-request': {
    tagName: 'skill/certificate-request',
    highlight: 'pink',
    description: 'Certificate requests',
  },
  'continuing-education-credits': {
    tagName: 'skill/continuing-education-credits',
    highlight: 'pink',
    description: 'CEU credit inquiries',
  },
  'ui-ux-feedback': {
    tagName: 'skill/ui-ux-feedback',
    highlight: 'pink',
    description: 'UI/UX feedback',
  },

  // Workshops & Cohorts (purple-pink)
  'cohort-schedule-inquiry': {
    tagName: 'skill/cohort-schedule-inquiry',
    highlight: 'purple',
    description: 'Cohort schedule questions',
  },
  'workshop-attendance-confirmation': {
    tagName: 'skill/workshop-attendance-confirmation',
    highlight: 'purple',
    description: 'Workshop attendance confirmation',
  },
  'workshop-cancellation-notice': {
    tagName: 'skill/workshop-cancellation-notice',
    highlight: 'red',
    description: 'Workshop cancellation notices',
  },
  'workshop-technical-setup': {
    tagName: 'skill/workshop-technical-setup',
    highlight: 'purple',
    description: 'Workshop technical setup',
  },

  // Business & Partnerships (grey family)
  'partnership-collaboration-inquiry': {
    tagName: 'skill/partnership-collaboration-inquiry',
    highlight: 'grey',
    description: 'Partnership inquiries',
  },
  'event-sponsorship-request': {
    tagName: 'skill/event-sponsorship-request',
    highlight: 'grey',
    description: 'Event sponsorship requests',
  },
  'media-press-outreach': {
    tagName: 'skill/media-press-outreach',
    highlight: 'grey',
    description: 'Media and press outreach',
  },
  'security-vulnerability-report': {
    tagName: 'skill/security-vulnerability-report',
    highlight: 'red',
    description: 'Security vulnerability reports',
  },
}

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
  technical_support: {
    tagName: 'technical-support',
    highlight: 'purple',
    description: 'General technical support issues',
  },
  feedback: {
    tagName: 'feedback',
    highlight: 'pink',
    description: 'Customer feedback',
  },
  sales_pricing: {
    tagName: 'sales-pricing',
    highlight: 'teal',
    description: 'Sales and pricing inquiries',
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
  /** Override default skill→tag mapping */
  skillMapping?: Partial<SkillTagMapping>
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
  private front: ReturnType<typeof createInstrumentedFrontClient>
  private categoryMapping: CategoryTagMapping
  private skillMapping: SkillTagMapping
  private tagIdCache: Map<string, string> = new Map()
  private initialized = false
  private debug: boolean

  // Use raw API to avoid SDK schema parsing issues and to handle pagination.
  private async listTagsRaw(): Promise<Array<{ id: string; name: string }>> {
    type RawTagList = {
      _results: Array<{ id: string; name: string }>
      _pagination?: { next?: string | null }
    }

    const results: RawTagList['_results'] = []
    let page = await this.front.raw.get<RawTagList>('/tags')
    results.push(...page._results)

    while (page._pagination?.next) {
      page = await this.front.raw.get<RawTagList>(page._pagination.next)
      results.push(...page._results)
    }

    return results
  }

  constructor(options: TagRegistryOptions) {
    this.front = createInstrumentedFrontClient({
      apiToken: options.frontApiToken,
    })
    this.categoryMapping = {
      ...DEFAULT_CATEGORY_TAG_MAPPING,
      ...options.categoryMapping,
    }
    this.skillMapping = {
      ...DEFAULT_SKILL_TAG_MAPPING,
      ...options.skillMapping,
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
      const tags = await this.listTagsRaw()
      for (const tag of tags) {
        this.tagIdCache.set(tag.name.toLowerCase(), tag.id)
      }
      this.initialized = true

      await log('debug', 'tag registry initialized', {
        component: 'TagRegistry',
        tagCount: tags.length,
        tagNames: tags.map((t) => t.name).slice(0, 20),
      })

      if (this.debug) {
        console.log(`[TagRegistry] Initialized with ${tags.length} tags`)
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
        const tags = await this.listTagsRaw()
        const existing = tags.find((t) => t.name.toLowerCase() === tagName)
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
          availableTags: tags.map((t) => t.name).slice(0, 30),
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

  // ============================================================================
  // Skill Tag Methods
  // ============================================================================

  /**
   * Get the tag configuration for a skill.
   */
  getTagConfigForSkill(skill: SkillName): SkillTagConfig | undefined {
    return this.skillMapping[skill]
  }

  /**
   * Get the tag name for a skill.
   */
  getTagNameForSkill(skill: SkillName): string | undefined {
    return this.getTagConfigForSkill(skill)?.tagName
  }

  /**
   * Get the highlight color for a skill.
   */
  getHighlightForSkill(skill: SkillName): TagHighlight | undefined {
    return this.getTagConfigForSkill(skill)?.highlight
  }

  /**
   * Get or create a tag ID for a skill.
   *
   * @param skill - The skill name
   * @returns Tag ID (tag_xxx) or undefined if failed
   */
  async getTagIdForSkill(skill: SkillName): Promise<string | undefined> {
    // Initialize if needed
    if (!this.initialized) {
      await this.initialize()
    }

    const config = this.getTagConfigForSkill(skill)
    if (!config) {
      await log('warn', 'unknown skill requested', {
        component: 'TagRegistry',
        skill,
      })
      return undefined
    }

    const tagName = config.tagName.toLowerCase()

    // Check cache first
    if (this.tagIdCache.has(tagName)) {
      return this.tagIdCache.get(tagName)
    }

    // Tag not in cache — try to create it
    await log('info', 'skill tag not in cache, attempting creation', {
      component: 'TagRegistry',
      skill,
      tagName: config.tagName,
      cachedTagCount: this.tagIdCache.size,
    })

    try {
      if (this.debug) {
        console.log(`[TagRegistry] Creating skill tag: ${config.tagName}`)
      }
      const newTag = await this.front.tags.create({
        name: config.tagName,
        description: config.description,
        highlight: config.highlight,
      })
      this.tagIdCache.set(tagName, newTag.id)

      await log('info', 'skill tag created successfully', {
        component: 'TagRegistry',
        skill,
        tagName: config.tagName,
        tagId: newTag.id,
      })

      return newTag.id
    } catch (error) {
      const isFrontError = error instanceof FrontApiError
      const message = error instanceof Error ? error.message : String(error)

      await log('warn', 'skill tag creation failed, attempting re-fetch', {
        component: 'TagRegistry',
        skill,
        tagName: config.tagName,
        error: message,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
        frontApiStatus: isFrontError ? error.status : undefined,
      })

      // Tag might already exist (race condition) - try to find it
      if (this.debug) {
        console.log(
          `[TagRegistry] Skill tag create failed, re-fetching tags:`,
          error
        )
      }
      try {
        const tags = await this.listTagsRaw()
        const existing = tags.find((t) => t.name.toLowerCase() === tagName)
        if (existing) {
          this.tagIdCache.set(tagName, existing.id)

          await log('info', 'found existing skill tag on re-fetch', {
            component: 'TagRegistry',
            skill,
            tagName: config.tagName,
            tagId: existing.id,
          })

          return existing.id
        }

        await log('error', 'skill tag not found on re-fetch either', {
          component: 'TagRegistry',
          skill,
          tagName: config.tagName,
          availableTags: tags.map((t) => t.name).slice(0, 30),
        })
      } catch (refetchError) {
        const refetchMsg =
          refetchError instanceof Error
            ? refetchError.message
            : String(refetchError)
        await log('error', 'skill tag re-fetch also failed', {
          component: 'TagRegistry',
          skill,
          tagName: config.tagName,
          originalError: message,
          refetchError: refetchMsg,
        })
      }

      console.error(
        `[TagRegistry] Failed to get/create tag for skill ${skill}:`,
        error
      )
      return undefined
    }
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
