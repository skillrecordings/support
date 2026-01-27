/**
 * Tag step tests
 */

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTag, createTagStep } from './tag'

// Mock Axiom logging
vi.mock('../../observability/axiom', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

// Mock TagRegistry
vi.mock('../../tags/registry', () => ({
  createTagRegistry: vi.fn(() => ({
    getTagIdForCategory: vi.fn(),
    getTagNameForCategory: vi.fn(),
  })),
}))

// Mock Front SDK
vi.mock('@skillrecordings/front-sdk', () => ({
  createFrontClient: vi.fn(() => ({
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

import { FrontApiError, createFrontClient } from '@skillrecordings/front-sdk'
import { log } from '../../observability/axiom'
import { createTagRegistry } from '../../tags/registry'

const defaultAppConfig = {
  appId: 'app_1',
  autoSendEnabled: false,
  instructorConfigured: false,
}

describe('applyTag', () => {
  let mockRegistry: {
    getTagIdForCategory: Mock
    getTagNameForCategory: Mock
  }
  let mockFront: {
    conversations: {
      addTag: Mock
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRegistry = {
      getTagIdForCategory: vi.fn(),
      getTagNameForCategory: vi.fn(),
    }
    mockFront = {
      conversations: {
        addTag: vi.fn(),
      },
    }
    ;(createTagRegistry as Mock).mockReturnValue(mockRegistry)
    ;(createFrontClient as Mock).mockReturnValue(mockFront)
  })

  it('applies tag successfully', async () => {
    mockRegistry.getTagIdForCategory.mockResolvedValue('tag_123')
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')
    mockFront.conversations.addTag.mockResolvedValue(undefined)

    const result = await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'support_access',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.tagged).toBe(true)
    expect(result.tagId).toBe('tag_123')
    expect(result.tagName).toBe('access-issue')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(mockFront.conversations.addTag).toHaveBeenCalledWith(
      'cnv_abc',
      'tag_123'
    )
  })

  it('returns error when tag ID cannot be resolved', async () => {
    mockRegistry.getTagIdForCategory.mockResolvedValue(undefined)
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')

    const result = await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'support_access',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.tagged).toBe(false)
    expect(result.error).toContain('Could not get/create tag')
    expect(mockFront.conversations.addTag).not.toHaveBeenCalled()
  })

  it('logs error to Axiom when tag ID cannot be resolved', async () => {
    mockRegistry.getTagIdForCategory.mockResolvedValue(undefined)
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')

    await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'support_access',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )

    expect(log).toHaveBeenCalledWith(
      'error',
      'tag ID not found for category',
      expect.objectContaining({
        step: 'apply-tag',
        conversationId: 'cnv_abc',
        category: 'support_access',
        tagName: 'access-issue',
      })
    )
  })

  it('handles Front API addTag errors gracefully', async () => {
    mockRegistry.getTagIdForCategory.mockResolvedValue('tag_123')
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')
    mockFront.conversations.addTag.mockRejectedValue(new Error('API Error'))

    const result = await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'support_access',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.tagged).toBe(false)
    expect(result.error).toContain('Front API addTag failed')
    expect(result.error).toContain('API Error')
  })

  it('logs Front API addTag errors to Axiom', async () => {
    mockRegistry.getTagIdForCategory.mockResolvedValue('tag_123')
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')
    mockFront.conversations.addTag.mockRejectedValue(new Error('403 Forbidden'))

    await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'support_access',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )

    expect(log).toHaveBeenCalledWith(
      'error',
      'Front API addTag call failed',
      expect.objectContaining({
        step: 'apply-tag',
        conversationId: 'cnv_abc',
        tagId: 'tag_123',
        tagName: 'access-issue',
        error: '403 Forbidden',
      })
    )
  })

  it('handles FrontApiError with status details', async () => {
    mockRegistry.getTagIdForCategory.mockResolvedValue('tag_123')
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')
    const frontError = new FrontApiError(
      404,
      'Not Found',
      'Conversation not found'
    )
    mockFront.conversations.addTag.mockRejectedValue(frontError)

    const result = await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'support_access',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.tagged).toBe(false)
    expect(result.error).toContain('Front API addTag failed')

    expect(log).toHaveBeenCalledWith(
      'error',
      'Front API addTag call failed',
      expect.objectContaining({
        errorType: 'FrontApiError',
        frontApiStatus: 404,
        frontApiTitle: 'Not Found',
      })
    )
  })

  it('handles registry getTagIdForCategory throwing', async () => {
    mockRegistry.getTagIdForCategory.mockRejectedValue(
      new Error('Registry init failed: Zod validation error')
    )
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')

    const result = await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'support_access',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.tagged).toBe(false)
    expect(result.error).toContain('Tag lookup failed')
    expect(result.error).toContain('Zod validation error')
    expect(mockFront.conversations.addTag).not.toHaveBeenCalled()
  })

  it('logs registry initialization failures to Axiom', async () => {
    mockRegistry.getTagIdForCategory.mockRejectedValue(
      new Error('Failed to fetch tags')
    )

    await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'support_access',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )

    expect(log).toHaveBeenCalledWith(
      'error',
      'tag ID lookup failed',
      expect.objectContaining({
        step: 'apply-tag',
        conversationId: 'cnv_abc',
        category: 'support_access',
        error: 'Failed to fetch tags',
      })
    )
  })

  it('uses provided tagRegistry', async () => {
    const customRegistry = {
      getTagIdForCategory: vi.fn().mockResolvedValue('tag_custom'),
      getTagNameForCategory: vi.fn().mockReturnValue('custom-tag'),
    }
    mockFront.conversations.addTag.mockResolvedValue(undefined)

    const result = await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'spam',
        appConfig: defaultAppConfig,
      },
      {
        frontApiToken: 'test-token',
        tagRegistry: customRegistry as any,
      }
    )

    expect(result.tagged).toBe(true)
    expect(result.tagId).toBe('tag_custom')
    expect(customRegistry.getTagIdForCategory).toHaveBeenCalledWith('spam')
    expect(createTagRegistry).not.toHaveBeenCalled()
  })

  it('includes durationMs in all results', async () => {
    // Success case
    mockRegistry.getTagIdForCategory.mockResolvedValue('tag_123')
    mockRegistry.getTagNameForCategory.mockReturnValue('spam')
    mockFront.conversations.addTag.mockResolvedValue(undefined)

    const successResult = await applyTag(
      {
        conversationId: 'cnv_1',
        category: 'spam',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )
    expect(successResult.durationMs).toBeGreaterThanOrEqual(0)

    // Failure case — tag not found
    vi.clearAllMocks()
    ;(createTagRegistry as Mock).mockReturnValue({
      getTagIdForCategory: vi.fn().mockResolvedValue(undefined),
      getTagNameForCategory: vi.fn().mockReturnValue('spam'),
    })

    const failResult = await applyTag(
      {
        conversationId: 'cnv_2',
        category: 'spam',
        appConfig: defaultAppConfig,
      },
      { frontApiToken: 'test-token' }
    )
    expect(failResult.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('handles all 17 message categories', async () => {
    const categories = [
      'support_access',
      'support_refund',
      'support_transfer',
      'support_technical',
      'support_billing',
      'fan_mail',
      'spam',
      'system',
      'unknown',
      'instructor_strategy',
      'resolved',
      'awaiting_customer',
      'voc_response',
      'presales_faq',
      'presales_consult',
      'presales_team',
    ] as const

    for (const category of categories) {
      vi.clearAllMocks()
      const mockReg = {
        getTagIdForCategory: vi.fn().mockResolvedValue(`tag_${category}`),
        getTagNameForCategory: vi.fn().mockReturnValue(`name_${category}`),
      }
      const mockFr = {
        conversations: { addTag: vi.fn().mockResolvedValue(undefined) },
      }
      ;(createTagRegistry as Mock).mockReturnValue(mockReg)
      ;(createFrontClient as Mock).mockReturnValue(mockFr)

      const result = await applyTag(
        { conversationId: 'cnv_test', category, appConfig: defaultAppConfig },
        { frontApiToken: 'test-token' }
      )

      expect(result.tagged).toBe(true)
      expect(result.tagId).toBe(`tag_${category}`)
    }
  })
})

describe('createTagStep', () => {
  it('creates a configured tag function', async () => {
    const mockRegistry = {
      getTagIdForCategory: vi.fn().mockResolvedValue('tag_123'),
      getTagNameForCategory: vi.fn().mockReturnValue('spam'),
    }
    const mockFront = {
      conversations: {
        addTag: vi.fn().mockResolvedValue(undefined),
      },
    }
    ;(createTagRegistry as Mock).mockReturnValue(mockRegistry)
    ;(createFrontClient as Mock).mockReturnValue(mockFront)

    const tagStep = createTagStep({ frontApiToken: 'test-token' })
    const result = await tagStep({
      conversationId: 'cnv_123',
      category: 'spam',
      appConfig: defaultAppConfig,
    })

    expect(result.tagged).toBe(true)
  })
})
