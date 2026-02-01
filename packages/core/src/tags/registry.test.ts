/**
 * TagRegistry tests
 */

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CATEGORY_TAG_MAPPING,
  TagRegistry,
  createTagRegistry,
} from './registry'

// Mock Axiom logging
vi.mock('../observability/axiom', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

// Mock Front SDK
vi.mock('@skillrecordings/front-sdk', () => ({
  createFrontClient: vi.fn(() => ({
    raw: {
      get: vi.fn(),
    },
    tags: {
      create: vi.fn(),
      get: vi.fn(),
    },
    conversations: {
      addTag: vi.fn(),
    },
  })),
  FrontApiError: class FrontApiError extends Error {
    status: number
    title: string
    constructor(status: number, title: string, message: string) {
      super(message)
      this.name = 'FrontApiError'
      this.status = status
      this.title = title
    }
  },
}))

import { createFrontClient } from '@skillrecordings/front-sdk'

describe('TagRegistry', () => {
  let mockFront: {
    raw: {
      get: Mock
    }
    tags: {
      create: Mock
      get: Mock
    }
    conversations: {
      addTag: Mock
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFront = {
      raw: {
        get: vi.fn(),
      },
      tags: {
        create: vi.fn(),
        get: vi.fn(),
      },
      conversations: {
        addTag: vi.fn(),
      },
    }
    ;(createFrontClient as Mock).mockReturnValue(mockFront)
  })

  describe('getTagNameForCategory', () => {
    it('returns correct tag name for each category', () => {
      const registry = createTagRegistry({ frontApiToken: 'test-token' })

      expect(registry.getTagNameForCategory('spam')).toBe('spam')
      expect(registry.getTagNameForCategory('support_access')).toBe(
        'access-issue'
      )
      expect(registry.getTagNameForCategory('support_refund')).toBe('refund')
      expect(registry.getTagNameForCategory('presales_faq')).toBe('presales')
      expect(registry.getTagNameForCategory('unknown')).toBe('needs-review')
    })

    it('returns needs-review for unrecognized categories', () => {
      const registry = createTagRegistry({ frontApiToken: 'test-token' })
      // @ts-expect-error - Testing with invalid category
      expect(registry.getTagNameForCategory('not-a-category')).toBe(
        'needs-review'
      )
    })
  })

  describe('getHighlightForCategory', () => {
    it('returns correct highlight colors', () => {
      const registry = createTagRegistry({ frontApiToken: 'test-token' })

      expect(registry.getHighlightForCategory('spam')).toBe('red')
      expect(registry.getHighlightForCategory('support_access')).toBe('blue')
      expect(registry.getHighlightForCategory('support_refund')).toBe('yellow')
      expect(registry.getHighlightForCategory('voc_response')).toBe('green')
      expect(registry.getHighlightForCategory('unknown')).toBe('black')
    })
  })

  describe('getTagIdForCategory', () => {
    it('initializes and caches tag IDs', async () => {
      mockFront.raw.get.mockResolvedValue({
        _results: [
          { id: 'tag_123', name: 'spam' },
          { id: 'tag_456', name: 'access-issue' },
        ],
      })

      const registry = createTagRegistry({ frontApiToken: 'test-token' })

      const tagId = await registry.getTagIdForCategory('spam')
      expect(tagId).toBe('tag_123')

      // Should be cached - list not called again
      const tagId2 = await registry.getTagIdForCategory('spam')
      expect(tagId2).toBe('tag_123')
      expect(mockFront.raw.get).toHaveBeenCalledTimes(1)
    })

    it('creates missing tags', async () => {
      mockFront.raw.get.mockResolvedValue({ _results: [] })
      mockFront.tags.create.mockResolvedValue({ id: 'tag_new', name: 'spam' })

      const registry = createTagRegistry({ frontApiToken: 'test-token' })

      const tagId = await registry.getTagIdForCategory('spam')
      expect(tagId).toBe('tag_new')
      expect(mockFront.tags.create).toHaveBeenCalledWith({
        name: 'spam',
        description: 'Spam or marketing',
        highlight: 'red',
      })
    })

    it('handles create race condition by re-fetching', async () => {
      mockFront.raw.get
        .mockResolvedValueOnce({ _results: [] })
        .mockResolvedValueOnce({
          _results: [{ id: 'tag_existing', name: 'spam' }],
        })
      mockFront.tags.create.mockRejectedValue(new Error('Already exists'))

      const registry = createTagRegistry({ frontApiToken: 'test-token' })

      const tagId = await registry.getTagIdForCategory('spam')
      expect(tagId).toBe('tag_existing')
    })
  })

  describe('custom mapping', () => {
    it('allows overriding default mappings', () => {
      const registry = createTagRegistry({
        frontApiToken: 'test-token',
        categoryMapping: {
          spam: { tagName: 'custom-spam', highlight: 'orange' },
        },
      })

      expect(registry.getTagNameForCategory('spam')).toBe('custom-spam')
      expect(registry.getHighlightForCategory('spam')).toBe('orange')
      // Other categories unaffected
      expect(registry.getTagNameForCategory('support_access')).toBe(
        'access-issue'
      )
    })
  })

  describe('clearCache', () => {
    it('clears the cache and requires re-initialization', async () => {
      mockFront.raw.get.mockResolvedValue({
        _results: [{ id: 'tag_123', name: 'spam' }],
      })

      const registry = createTagRegistry({ frontApiToken: 'test-token' })

      await registry.getTagIdForCategory('spam')
      expect(mockFront.raw.get).toHaveBeenCalledTimes(1)

      registry.clearCache()

      await registry.getTagIdForCategory('spam')
      expect(mockFront.raw.get).toHaveBeenCalledTimes(2)
    })
  })
})

describe('DEFAULT_CATEGORY_TAG_MAPPING', () => {
  it('has entries for all expected categories', () => {
    const expectedCategories = [
      'spam',
      'system',
      'support_access',
      'support_refund',
      'support_transfer',
      'support_technical',
      'support_billing',
      'fan_mail',
      'presales_faq',
      'presales_consult',
      'presales_team',
      'voc_response',
      'instructor_strategy',
      'resolved',
      'awaiting_customer',
      'unknown',
    ]

    for (const category of expectedCategories) {
      expect(DEFAULT_CATEGORY_TAG_MAPPING).toHaveProperty(category)
      expect(
        DEFAULT_CATEGORY_TAG_MAPPING[
          category as keyof typeof DEFAULT_CATEGORY_TAG_MAPPING
        ]
      ).toHaveProperty('tagName')
      expect(
        DEFAULT_CATEGORY_TAG_MAPPING[
          category as keyof typeof DEFAULT_CATEGORY_TAG_MAPPING
        ]
      ).toHaveProperty('highlight')
    }
  })

  it('multiple presales categories map to same tag', () => {
    expect(DEFAULT_CATEGORY_TAG_MAPPING.presales_faq.tagName).toBe('presales')
    expect(DEFAULT_CATEGORY_TAG_MAPPING.presales_consult.tagName).toBe(
      'presales'
    )
  })
})
