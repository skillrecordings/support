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
  createChannelsClient: vi.fn(() => ({})),
  createContactsClient: vi.fn(() => ({})),
  createConversationsClient: vi.fn(() => ({})),
  createDraftsClient: vi.fn(() => ({})),
  createFrontClient: vi.fn(() => ({
    tags: {
      delete: vi.fn(),
      create: vi.fn(),
    },
  })),
  createInboxesClient: vi.fn(() => ({})),
  createMessagesClient: vi.fn(() => ({})),
  createTagsClient: vi.fn(() => ({
    delete: vi.fn(),
    create: vi.fn(),
  })),
  createTeammatesClient: vi.fn(() => ({})),
  createTemplatesClient: vi.fn(() => ({})),
  FRONT_API_BASE: 'https://api2.frontapp.com',
  ErrorResponseSchema: {
    safeParse: vi.fn(() => ({ success: false })),
  },
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

import { ErrorResponseSchema } from '@skillrecordings/front-sdk'
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
  let fetchMock: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    mockRegistry = {
      getTagIdForCategory: vi.fn(),
      getTagNameForCategory: vi.fn(),
    }
    ;(createTagRegistry as Mock).mockReturnValue(mockRegistry)
    ;(ErrorResponseSchema.safeParse as Mock).mockReturnValue({ success: false })
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      headers: { get: vi.fn().mockReturnValue(null) },
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('applies tag successfully', async () => {
    mockRegistry.getTagIdForCategory.mockResolvedValue('tag_123')
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')
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
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api2.frontapp.com/conversations/cnv_abc/tags',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tag_ids: ['tag_123'] }),
      })
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
    expect(fetchMock).not.toHaveBeenCalled()
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
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'API Error',
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockResolvedValue({}),
    })

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
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockResolvedValue({}),
    })

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
        error: 'Forbidden',
      })
    )
  })

  it('handles FrontApiError with status details', async () => {
    mockRegistry.getTagIdForCategory.mockResolvedValue('tag_123')
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')
    ;(ErrorResponseSchema.safeParse as Mock).mockReturnValue({
      success: true,
      data: {
        _error: {
          status: 404,
          title: 'Not Found',
          message: 'Conversation not found',
          details: [],
        },
      },
    })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockResolvedValue({
        _error: {
          status: 404,
          title: 'Not Found',
          message: 'Conversation not found',
          details: [],
        },
      }),
    })

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
    expect(fetchMock).not.toHaveBeenCalled()
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
    expect(fetchMock).toHaveBeenCalled()
  })

  it('includes durationMs in all results', async () => {
    // Success case
    mockRegistry.getTagIdForCategory.mockResolvedValue('tag_123')
    mockRegistry.getTagNameForCategory.mockReturnValue('spam')

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
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      headers: { get: vi.fn().mockReturnValue(null) },
    })
    vi.stubGlobal('fetch', fetchMock)
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

  it('handles all 19 message categories', async () => {
    const categories = [
      'support_access',
      'support_refund',
      'support_transfer',
      'support_technical',
      'support_billing',
      'technical_support',
      'feedback',
      'sales_pricing',
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
      fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: { get: vi.fn().mockReturnValue(null) },
      })
      vi.stubGlobal('fetch', fetchMock)
      const mockReg = {
        getTagIdForCategory: vi.fn().mockResolvedValue(`tag_${category}`),
        getTagNameForCategory: vi.fn().mockReturnValue(`name_${category}`),
      }
      ;(createTagRegistry as Mock).mockReturnValue(mockReg)

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
    ;(createTagRegistry as Mock).mockReturnValue(mockRegistry)

    const tagStep = createTagStep({ frontApiToken: 'test-token' })
    const result = await tagStep({
      conversationId: 'cnv_123',
      category: 'spam',
      appConfig: defaultAppConfig,
    })

    expect(result.tagged).toBe(true)
  })
})
