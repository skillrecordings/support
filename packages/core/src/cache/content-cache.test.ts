import type {
  ContentSearchRequest,
  ContentSearchResponse,
} from '@skillrecordings/sdk/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cachedContentSearch,
  clearAppCache,
  clearContentCache,
  getCacheKey,
  getCachedQuickLinks,
} from '../../src/cache/content-cache'

describe('getCacheKey', () => {
  it('should generate correct cache key with all parameters', () => {
    const request: ContentSearchRequest = {
      query: 'typescript generics',
      types: ['lesson', 'article'],
      limit: 10,
    }

    const key = getCacheKey('app-123', request)

    expect(key).toBe('app-123:typescript generics:lesson,article:10')
  })

  it('should handle missing types parameter', () => {
    const request: ContentSearchRequest = {
      query: 'react hooks',
      limit: 5,
    }

    const key = getCacheKey('app-456', request)

    expect(key).toBe('app-456:react hooks::5')
  })

  it('should handle missing limit parameter', () => {
    const request: ContentSearchRequest = {
      query: 'node.js',
      types: ['course'],
    }

    const key = getCacheKey('app-789', request)

    expect(key).toBe('app-789:node.js:course:5')
  })

  it('should generate different keys for different queries', () => {
    const request1: ContentSearchRequest = { query: 'query1' }
    const request2: ContentSearchRequest = { query: 'query2' }

    const key1 = getCacheKey('app-1', request1)
    const key2 = getCacheKey('app-1', request2)

    expect(key1).not.toBe(key2)
  })

  it('should generate different keys for different apps', () => {
    const request: ContentSearchRequest = { query: 'test' }

    const key1 = getCacheKey('app-1', request)
    const key2 = getCacheKey('app-2', request)

    expect(key1).not.toBe(key2)
  })
})

describe('cachedContentSearch', () => {
  beforeEach(() => {
    // Clear cache before each test to ensure isolation
    clearContentCache()
  })

  it('should call fetcher and cache result on first call', async () => {
    const mockResponse: ContentSearchResponse = {
      results: [
        {
          id: 'result-1',
          type: 'lesson',
          title: 'Test Lesson',
          url: 'https://example.com/lesson',
        },
      ],
    }

    const fetcher = vi.fn().mockResolvedValue(mockResponse)
    const request: ContentSearchRequest = { query: 'test' }

    const result = await cachedContentSearch('app-1', request, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result).toEqual(mockResponse)
  })

  it('should return cached result within TTL without calling fetcher', async () => {
    const mockResponse: ContentSearchResponse = {
      results: [
        {
          id: 'result-1',
          type: 'lesson',
          title: 'Test Lesson',
          url: 'https://example.com/lesson',
        },
      ],
    }

    const fetcher = vi.fn().mockResolvedValue(mockResponse)
    const request: ContentSearchRequest = { query: 'test' }

    // First call - should fetch
    const result1 = await cachedContentSearch('app-1', request, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Second call within TTL - should use cache
    const result2 = await cachedContentSearch('app-1', request, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1) // Not called again
    expect(result2).toEqual(result1)
  })

  it('should call fetcher again when cache expires', async () => {
    const mockResponse1: ContentSearchResponse = {
      results: [{ id: '1', type: 'lesson', title: 'Old', url: 'https://old' }],
    }
    const mockResponse2: ContentSearchResponse = {
      results: [{ id: '2', type: 'lesson', title: 'New', url: 'https://new' }],
    }

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockResponse1)
      .mockResolvedValueOnce(mockResponse2)

    const request: ContentSearchRequest = { query: 'test' }

    // First call
    const result1 = await cachedContentSearch('app-1', request, fetcher)
    expect(result1).toEqual(mockResponse1)

    // Mock time passing (5 minutes + 1 second = 301000ms)
    const realDateNow = Date.now
    vi.spyOn(Date, 'now').mockReturnValue(realDateNow() + 301000)

    // Second call after expiry - should fetch again
    const result2 = await cachedContentSearch('app-1', request, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result2).toEqual(mockResponse2)

    vi.restoreAllMocks()
  })

  it('should cache quick links separately with 24h TTL', async () => {
    const mockResponse: ContentSearchResponse = {
      results: [
        {
          id: 'result-1',
          type: 'lesson',
          title: 'Test',
          url: 'https://example.com',
        },
      ],
      quickLinks: [
        {
          id: 'quick-1',
          type: 'social',
          title: 'Discord',
          url: 'https://discord.gg/example',
        },
      ],
    }

    const fetcher = vi.fn().mockResolvedValue(mockResponse)
    const request: ContentSearchRequest = { query: 'test' }

    await cachedContentSearch('app-1', request, fetcher)

    // Quick links should be cached
    const cachedQuickLinks = getCachedQuickLinks('app-1')
    expect(cachedQuickLinks).toEqual(mockResponse.quickLinks)
  })

  it('should handle different apps independently', async () => {
    const mockResponse1: ContentSearchResponse = {
      results: [
        {
          id: 'app1-result',
          type: 'lesson',
          title: 'App 1',
          url: 'https://app1.com',
        },
      ],
    }
    const mockResponse2: ContentSearchResponse = {
      results: [
        {
          id: 'app2-result',
          type: 'lesson',
          title: 'App 2',
          url: 'https://app2.com',
        },
      ],
    }

    const fetcher1 = vi.fn().mockResolvedValue(mockResponse1)
    const fetcher2 = vi.fn().mockResolvedValue(mockResponse2)
    const request: ContentSearchRequest = { query: 'test' }

    const result1 = await cachedContentSearch('app-1', request, fetcher1)
    const result2 = await cachedContentSearch('app-2', request, fetcher2)

    expect(result1).toEqual(mockResponse1)
    expect(result2).toEqual(mockResponse2)
    expect(fetcher1).toHaveBeenCalledTimes(1)
    expect(fetcher2).toHaveBeenCalledTimes(1)
  })
})

describe('getCachedQuickLinks', () => {
  beforeEach(() => {
    clearContentCache()
  })

  it('should return null when no quick links cached', () => {
    const result = getCachedQuickLinks('app-1')
    expect(result).toBeNull()
  })

  it('should return cached quick links within TTL', async () => {
    const mockResponse: ContentSearchResponse = {
      results: [],
      quickLinks: [
        {
          id: 'quick-1',
          type: 'social',
          title: 'Discord',
          url: 'https://discord.gg/example',
        },
      ],
    }

    const fetcher = vi.fn().mockResolvedValue(mockResponse)
    await cachedContentSearch('app-1', { query: 'test' }, fetcher)

    const cachedQuickLinks = getCachedQuickLinks('app-1')
    expect(cachedQuickLinks).toEqual(mockResponse.quickLinks)
  })

  it('should return null when quick links cache expires', async () => {
    const mockResponse: ContentSearchResponse = {
      results: [],
      quickLinks: [
        {
          id: 'quick-1',
          type: 'social',
          title: 'Discord',
          url: 'https://discord.gg/example',
        },
      ],
    }

    const fetcher = vi.fn().mockResolvedValue(mockResponse)
    await cachedContentSearch('app-1', { query: 'test' }, fetcher)

    // Mock time passing (24 hours + 1 second)
    const realDateNow = Date.now
    vi.spyOn(Date, 'now').mockReturnValue(
      realDateNow() + 24 * 60 * 60 * 1000 + 1000
    )

    const cachedQuickLinks = getCachedQuickLinks('app-1')
    expect(cachedQuickLinks).toBeNull()

    vi.restoreAllMocks()
  })

  it('should return null when response has no quick links', async () => {
    const mockResponse: ContentSearchResponse = {
      results: [
        {
          id: 'result-1',
          type: 'lesson',
          title: 'Test',
          url: 'https://example.com',
        },
      ],
      // No quickLinks
    }

    const fetcher = vi.fn().mockResolvedValue(mockResponse)
    await cachedContentSearch('app-1', { query: 'test' }, fetcher)

    const cachedQuickLinks = getCachedQuickLinks('app-1')
    expect(cachedQuickLinks).toBeNull()
  })
})

describe('clearContentCache', () => {
  beforeEach(() => {
    // Ensure clean state before testing cache clearing
    clearContentCache()
  })

  it('should clear all cache entries', async () => {
    const mockResponse1: ContentSearchResponse = {
      results: [],
      quickLinks: [
        {
          id: 'quick-1',
          type: 'social',
          title: 'Discord',
          url: 'https://discord.gg/example',
        },
      ],
    }
    const mockResponse2: ContentSearchResponse = {
      results: [],
      quickLinks: [
        {
          id: 'quick-2',
          type: 'social',
          title: 'Discord',
          url: 'https://discord.gg/example2',
        },
      ],
    }

    const fetcher1 = vi.fn().mockResolvedValue(mockResponse1)
    const fetcher2 = vi.fn().mockResolvedValue(mockResponse2)
    await cachedContentSearch('app-1', { query: 'test' }, fetcher1)
    await cachedContentSearch('app-2', { query: 'test' }, fetcher2)

    // Verify cache is populated
    expect(getCachedQuickLinks('app-1')).not.toBeNull()
    expect(getCachedQuickLinks('app-2')).not.toBeNull()

    clearContentCache()

    // Verify cache is cleared
    expect(getCachedQuickLinks('app-1')).toBeNull()
    expect(getCachedQuickLinks('app-2')).toBeNull()

    // Fetcher should be called again
    await cachedContentSearch('app-1', { query: 'test' }, fetcher1)
    expect(fetcher1).toHaveBeenCalledTimes(2) // 1 initial + 1 after clear
  })
})

describe('clearAppCache', () => {
  beforeEach(() => {
    // Ensure clean state
    clearContentCache()
  })

  it('should clear only cache entries for specified app', async () => {
    const mockResponse1: ContentSearchResponse = {
      results: [],
      quickLinks: [
        {
          id: 'quick-1',
          type: 'social',
          title: 'Discord',
          url: 'https://discord.gg/example',
        },
      ],
    }
    const mockResponse2: ContentSearchResponse = {
      results: [],
      quickLinks: [
        {
          id: 'quick-2',
          type: 'social',
          title: 'Discord',
          url: 'https://discord.gg/example2',
        },
      ],
    }

    const fetcher1 = vi.fn().mockResolvedValue(mockResponse1)
    const fetcher2 = vi.fn().mockResolvedValue(mockResponse2)
    await cachedContentSearch('app-1', { query: 'test1' }, fetcher1)
    await cachedContentSearch('app-1', { query: 'test2' }, fetcher1)
    await cachedContentSearch('app-2', { query: 'test' }, fetcher2)

    // Verify cache is populated
    expect(getCachedQuickLinks('app-1')).not.toBeNull()
    expect(getCachedQuickLinks('app-2')).not.toBeNull()

    clearAppCache('app-1')

    // app-1 cache should be cleared
    expect(getCachedQuickLinks('app-1')).toBeNull()

    // app-2 cache should remain
    expect(getCachedQuickLinks('app-2')).not.toBeNull()

    // Verify app-1 fetcher is called again but app-2 is not
    await cachedContentSearch('app-1', { query: 'test1' }, fetcher1)
    await cachedContentSearch('app-2', { query: 'test' }, fetcher2)
    expect(fetcher1).toHaveBeenCalledTimes(3) // 2 initial + 1 refetch
    expect(fetcher2).toHaveBeenCalledTimes(1) // 1 initial, not called again
  })

  it('should handle clearing non-existent app gracefully', () => {
    expect(() => clearAppCache('non-existent-app')).not.toThrow()
  })
})
