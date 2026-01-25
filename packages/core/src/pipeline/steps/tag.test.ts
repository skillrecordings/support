/**
 * Tag step tests
 */

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTag, createTagStep } from './tag'

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
}))

import { createFrontClient } from '@skillrecordings/front-sdk'
import { createTagRegistry } from '../../tags/registry'

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
        appConfig: {
          appId: 'app_1',
          autoSendEnabled: false,
          instructorConfigured: false,
        },
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
        appConfig: {
          appId: 'app_1',
          autoSendEnabled: false,
          instructorConfigured: false,
        },
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.tagged).toBe(false)
    expect(result.error).toContain('Could not get/create tag')
    expect(mockFront.conversations.addTag).not.toHaveBeenCalled()
  })

  it('handles Front API errors gracefully', async () => {
    mockRegistry.getTagIdForCategory.mockResolvedValue('tag_123')
    mockRegistry.getTagNameForCategory.mockReturnValue('access-issue')
    mockFront.conversations.addTag.mockRejectedValue(new Error('API Error'))

    const result = await applyTag(
      {
        conversationId: 'cnv_abc',
        category: 'support_access',
        appConfig: {
          appId: 'app_1',
          autoSendEnabled: false,
          instructorConfigured: false,
        },
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.tagged).toBe(false)
    expect(result.error).toBe('API Error')
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
        appConfig: {
          appId: 'app_1',
          autoSendEnabled: false,
          instructorConfigured: false,
        },
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
      appConfig: {
        appId: 'app_1',
        autoSendEnabled: false,
        instructorConfigured: false,
      },
    })

    expect(result.tagged).toBe(true)
  })
})
