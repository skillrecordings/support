import type {
  ContentSearchRequest,
  ContentSearchResponse,
} from '@skillrecordings/sdk/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentTools } from './config'

// Mock the cache module
vi.mock('../cache/content-cache', () => ({
  cachedContentSearch: vi.fn(),
}))

// Import after mocking
import { cachedContentSearch } from '../cache/content-cache'

// Helper to call the tool execute function with proper typing
async function executeSearchTool(
  params: {
    query: string
    types?: ContentSearchRequest['types']
    limit?: number
  },
  context: Record<string, unknown>
): Promise<ContentSearchResponse | { error: string; results: never[] }> {
  const tool = agentTools.searchProductContent
  if (!tool.execute) throw new Error('Tool execute not defined')
  // Add default limit if not provided
  const paramsWithLimit = { ...params, limit: params.limit ?? 5 }
  // AI SDK v6: context must be wrapped in experimental_context
  const fullContext = {
    toolCallId: 'test-tool-call-id',
    messages: [],
    experimental_context: context,
  }
  return (await tool.execute(paramsWithLimit, fullContext as any)) as
    | ContentSearchResponse
    | { error: string; results: never[] }
}

describe('searchProductContent tool', () => {
  const mockIntegrationClient = {
    searchContent: vi.fn(),
    lookupUser: vi.fn(),
    getPurchases: vi.fn(),
    revokeAccess: vi.fn(),
    transferPurchase: vi.fn(),
    updateUser: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validation', () => {
    it('returns error when appId missing from context', async () => {
      const context = {
        integrationClient: mockIntegrationClient,
      }

      const result = await executeSearchTool({ query: 'test query' }, context)

      expect(result).toEqual({
        error: 'Missing appId or integrationClient in context',
        results: [],
      })
    })

    it('returns error when integrationClient missing from context', async () => {
      const context = {
        appId: 'total-typescript',
      }

      const result = await executeSearchTool({ query: 'test query' }, context)

      expect(result).toEqual({
        error: 'Missing appId or integrationClient in context',
        results: [],
      })
    })

    it('returns error when both appId and integrationClient missing', async () => {
      const result = await executeSearchTool({ query: 'test query' }, {})

      expect(result).toEqual({
        error: 'Missing appId or integrationClient in context',
        results: [],
      })
    })
  })

  describe('caching', () => {
    const appId = 'total-typescript'
    const context = {
      appId,
      integrationClient: mockIntegrationClient,
    }

    it('calls cachedContentSearch with correct arguments', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [
          {
            id: '1',
            type: 'lesson',
            title: 'TypeScript Basics',
            url: 'https://example.com/lesson-1',
          },
        ],
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      const request = {
        query: 'typescript basics',
        types: ['lesson' as const],
        limit: 5,
      }

      await executeSearchTool(request, context)

      expect(cachedContentSearch).toHaveBeenCalledWith(
        appId,
        request,
        expect.any(Function)
      )
    })

    it('passes fetcher function that calls integrationClient.searchContent', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [
          {
            id: '1',
            type: 'lesson',
            title: 'TypeScript Basics',
            url: 'https://example.com/lesson-1',
          },
        ],
      }

      // Capture the fetcher function
      let capturedFetcher: (() => Promise<ContentSearchResponse>) | undefined
      vi.mocked(cachedContentSearch).mockImplementation(
        async (_appId, _request, fetcher) => {
          capturedFetcher = fetcher
          return mockResponse
        }
      )

      const request = {
        query: 'typescript basics',
        limit: 5,
      }

      await executeSearchTool(request, context)

      // Verify fetcher was captured
      expect(capturedFetcher).toBeDefined()

      // Call the fetcher and verify it calls integrationClient
      mockIntegrationClient.searchContent.mockResolvedValue(mockResponse)
      await capturedFetcher!()

      expect(mockIntegrationClient.searchContent).toHaveBeenCalledWith(request)
    })
  })

  describe('successful search', () => {
    const appId = 'total-typescript'
    const context = {
      appId,
      integrationClient: mockIntegrationClient,
    }

    it('returns response from cachedContentSearch', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [
          {
            id: '1',
            type: 'lesson',
            title: 'TypeScript Basics',
            url: 'https://example.com/lesson-1',
            description: 'Learn TypeScript basics',
            score: 0.95,
          },
          {
            id: '2',
            type: 'article',
            title: 'Advanced TypeScript',
            url: 'https://example.com/article-1',
            score: 0.85,
          },
        ],
        quickLinks: [
          {
            id: 'quick-1',
            type: 'social',
            title: 'Discord Community',
            url: 'https://discord.gg/example',
          },
        ],
        meta: {
          totalResults: 2,
          searchTimeMs: 45,
        },
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      const result = await executeSearchTool(
        { query: 'typescript', limit: 5 },
        context
      )

      expect(result).toEqual(mockResponse)
    })

    it('handles query with types filter', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [
          {
            id: '1',
            type: 'course',
            title: 'TypeScript Course',
            url: 'https://example.com/course-1',
          },
        ],
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      const request = {
        query: 'typescript',
        types: ['course' as const, 'module' as const],
        limit: 5,
      }

      const result = await executeSearchTool(request, context)

      expect(result).toEqual(mockResponse)
      expect(cachedContentSearch).toHaveBeenCalledWith(
        appId,
        request,
        expect.any(Function)
      )
    })

    it('handles query with limit parameter', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [
          {
            id: '1',
            type: 'lesson',
            title: 'Lesson 1',
            url: 'https://example.com/1',
          },
        ],
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      const request = {
        query: 'typescript',
        limit: 3,
      }

      const result = await executeSearchTool(request, context)

      expect(result).toEqual(mockResponse)
      expect(cachedContentSearch).toHaveBeenCalledWith(
        appId,
        request,
        expect.any(Function)
      )
    })

    it('returns empty results when no matches found', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [],
        quickLinks: [
          {
            id: 'quick-1',
            type: 'social',
            title: 'Support',
            url: 'https://example.com/support',
          },
        ],
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      const result = (await executeSearchTool(
        { query: 'nonexistent topic', limit: 5 },
        context
      )) as ContentSearchResponse

      expect(result).toEqual(mockResponse)
      expect(result.results).toHaveLength(0)
      expect(result.quickLinks).toBeDefined()
    })
  })

  describe('content type filtering', () => {
    const appId = 'total-typescript'
    const context = {
      appId,
      integrationClient: mockIntegrationClient,
    }

    it('handles single content type filter', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [
          {
            id: '1',
            type: 'exercise',
            title: 'TypeScript Exercise',
            url: 'https://example.com/exercise-1',
          },
        ],
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      const result = await executeSearchTool(
        {
          query: 'typescript',
          types: ['exercise'],
          limit: 5,
        },
        context
      )

      expect(result).toEqual(mockResponse)
    })

    it('handles all available content types', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [
          {
            id: '1',
            type: 'course',
            title: 'Course',
            url: 'https://example.com/1',
          },
          {
            id: '2',
            type: 'module',
            title: 'Module',
            url: 'https://example.com/2',
          },
          {
            id: '3',
            type: 'lesson',
            title: 'Lesson',
            url: 'https://example.com/3',
          },
          {
            id: '4',
            type: 'article',
            title: 'Article',
            url: 'https://example.com/4',
          },
          {
            id: '5',
            type: 'exercise',
            title: 'Exercise',
            url: 'https://example.com/5',
          },
          {
            id: '6',
            type: 'resource',
            title: 'Resource',
            url: 'https://example.com/6',
          },
          {
            id: '7',
            type: 'social',
            title: 'Social',
            url: 'https://example.com/7',
          },
        ],
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      const result = await executeSearchTool(
        {
          query: 'all content',
          types: [
            'course',
            'module',
            'lesson',
            'article',
            'exercise',
            'resource',
            'social',
          ],
          limit: 10,
        },
        context
      )

      expect(result).toEqual(mockResponse)
    })
  })

  describe('metadata handling', () => {
    const appId = 'total-typescript'
    const context = {
      appId,
      integrationClient: mockIntegrationClient,
    }

    it('returns results with rich metadata', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [
          {
            id: '1',
            type: 'lesson',
            title: 'Advanced TypeScript',
            description: 'Deep dive into advanced TypeScript concepts',
            url: 'https://example.com/lesson-1',
            score: 0.95,
            metadata: {
              duration: 45,
              difficulty: 'advanced',
              tags: ['typescript', 'generics', 'advanced'],
              author: 'Matt Pocock',
              updatedAt: '2024-01-15',
              accessLevel: 'paid',
              customField: 'custom value',
            },
          },
        ],
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      const result = (await executeSearchTool(
        { query: 'advanced typescript', limit: 5 },
        context
      )) as ContentSearchResponse

      expect(result).toEqual(mockResponse)
      expect(result.results[0]?.metadata).toBeDefined()
      expect(result.results[0]?.metadata?.duration).toBe(45)
      expect(result.results[0]?.metadata?.difficulty).toBe('advanced')
    })

    it('handles results without metadata', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [
          {
            id: '1',
            type: 'lesson',
            title: 'Simple Lesson',
            url: 'https://example.com/lesson-1',
          },
        ],
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      const result = (await executeSearchTool(
        { query: 'simple', limit: 5 },
        context
      )) as ContentSearchResponse

      expect(result).toEqual(mockResponse)
      expect(result.results[0]?.metadata).toBeUndefined()
    })
  })

  describe('integration with different apps', () => {
    it('works with different appId values', async () => {
      const apps = ['total-typescript', 'pro-tailwind', 'epic-react']

      for (const appId of apps) {
        const context = {
          appId,
          integrationClient: mockIntegrationClient,
        }

        const mockResponse: ContentSearchResponse = {
          results: [
            {
              id: '1',
              type: 'lesson',
              title: `${appId} Lesson`,
              url: `https://example.com/${appId}/lesson-1`,
            },
          ],
        }

        vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

        const result = await executeSearchTool(
          { query: 'test', limit: 5 },
          context
        )

        expect(result).toEqual(mockResponse)
        expect(cachedContentSearch).toHaveBeenCalledWith(
          appId,
          { query: 'test', limit: 5 },
          expect.any(Function)
        )
      }
    })
  })

  describe('default values', () => {
    const appId = 'total-typescript'
    const context = {
      appId,
      integrationClient: mockIntegrationClient,
    }

    it('allows specifying custom limit', async () => {
      const mockResponse: ContentSearchResponse = {
        results: [],
      }

      vi.mocked(cachedContentSearch).mockResolvedValue(mockResponse)

      await executeSearchTool({ query: 'test', limit: 20 }, context)

      expect(cachedContentSearch).toHaveBeenCalledWith(
        appId,
        { query: 'test', limit: 20 },
        expect.any(Function)
      )
    })
  })
})
