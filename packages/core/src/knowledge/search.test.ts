import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VectorQueryResult } from '../vector/types'
import type { KnowledgeSearchOptions } from './types'
import {
  KNOWLEDGE_NAMESPACE,
  getKnowledgeNamespace,
  getKnowledgeRedisKey,
} from './types'

// Mock the redis and vector clients
vi.mock('../redis/client', () => ({
  getRedis: vi.fn(() => ({
    hgetall: vi.fn(),
    hset: vi.fn(),
    del: vi.fn(),
  })),
}))

vi.mock('../vector/client', () => ({
  queryVectors: vi.fn(),
  upsertVector: vi.fn(),
}))

// Import after mocking
import { getRedis } from '../redis/client'
import { queryVectors, upsertVector } from '../vector/client'
import {
  getKnowledgeArticle,
  searchKnowledge,
  storeKnowledgeArticle,
} from './search'

describe('Knowledge Types', () => {
  describe('getKnowledgeNamespace', () => {
    it('returns app-specific namespace for app ID', () => {
      expect(getKnowledgeNamespace('testing-javascript')).toBe(
        'knowledge:testing-javascript'
      )
    })

    it('returns different namespaces for different apps', () => {
      expect(getKnowledgeNamespace('total-typescript')).toBe(
        'knowledge:total-typescript'
      )
      expect(getKnowledgeNamespace('epic-web')).toBe('knowledge:epic-web')
    })
  })

  describe('getKnowledgeRedisKey', () => {
    it('returns correct Redis key format', () => {
      const key = getKnowledgeRedisKey('article-123', 'knowledge:my-app')
      expect(key).toBe('knowledge:my-app:article:article-123')
    })

    it('works with shared namespace', () => {
      const key = getKnowledgeRedisKey(
        'article-456',
        KNOWLEDGE_NAMESPACE.SHARED
      )
      expect(key).toBe('knowledge:shared:article:article-456')
    })
  })

  describe('KNOWLEDGE_NAMESPACE', () => {
    it('has correct app prefix', () => {
      expect(KNOWLEDGE_NAMESPACE.APP_PREFIX).toBe('knowledge:')
    })

    it('has correct shared namespace', () => {
      expect(KNOWLEDGE_NAMESPACE.SHARED).toBe('knowledge:shared')
    })
  })
})

describe('searchKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searches app-specific namespace', async () => {
    const mockVectorResults: VectorQueryResult[] = [
      {
        id: 'article-1',
        score: 0.85,
        data: 'How to reset password\n\nI forgot my password',
        metadata: {
          type: 'knowledge',
          appId: 'my-app',
          source: 'faq',
        },
      },
    ]

    const mockRedisArticle = {
      id: 'article-1',
      title: 'How to reset password',
      question: 'I forgot my password',
      answer: 'Go to the login page and click "Forgot Password".',
      appId: 'my-app',
      metadata: JSON.stringify({
        source: 'faq',
        created_at: '2024-01-01T00:00:00Z',
        tags: ['password', 'auth'],
      }),
    }

    // Return results only for first call (app namespace), empty for shared
    vi.mocked(queryVectors)
      .mockResolvedValueOnce(mockVectorResults)
      .mockResolvedValueOnce([])
    const mockHgetall = vi.fn().mockResolvedValue(mockRedisArticle)
    vi.mocked(getRedis).mockReturnValue({
      hgetall: mockHgetall,
      hset: vi.fn(),
      del: vi.fn(),
    } as any)

    const options: KnowledgeSearchOptions = {
      appId: 'my-app',
      limit: 3,
    }

    const results = await searchKnowledge('password reset', options)

    expect(queryVectors).toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'article-1',
      text: 'Go to the login page and click "Forgot Password".',
      score: 0.85,
    })
  })

  it('filters results below minScore', async () => {
    const mockVectorResults: VectorQueryResult[] = [
      {
        id: 'article-1',
        score: 0.8,
        data: 'Good match',
        metadata: { type: 'knowledge', appId: 'my-app' },
      },
      {
        id: 'article-2',
        score: 0.5,
        data: 'Bad match',
        metadata: { type: 'knowledge', appId: 'my-app' },
      },
    ]

    // Return results only for app namespace, empty for shared
    vi.mocked(queryVectors)
      .mockResolvedValueOnce(mockVectorResults)
      .mockResolvedValueOnce([])
    vi.mocked(getRedis).mockReturnValue({
      hgetall: vi.fn().mockResolvedValue({
        id: 'article-1',
        title: 'Good match',
        question: 'Q',
        answer: 'A',
        appId: 'my-app',
        metadata: JSON.stringify({
          source: 'faq',
          created_at: '2024-01-01',
          tags: [],
        }),
      }),
      hset: vi.fn(),
      del: vi.fn(),
    } as any)

    const results = await searchKnowledge('query', {
      appId: 'my-app',
      minScore: 0.65,
    })

    // Only the high-score result should pass
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it('respects includeShared option', async () => {
    vi.mocked(queryVectors).mockResolvedValue([])

    await searchKnowledge('query', {
      appId: 'my-app',
      includeShared: false,
    })

    // Should only query once (app namespace), not twice
    expect(queryVectors).toHaveBeenCalledTimes(1)
  })

  it('queries both namespaces by default', async () => {
    vi.mocked(queryVectors).mockResolvedValue([])

    await searchKnowledge('query', {
      appId: 'my-app',
    })

    // Should query both app and shared namespaces
    expect(queryVectors).toHaveBeenCalledTimes(2)
  })
})

describe('storeKnowledgeArticle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores article in vector and Redis', async () => {
    const mockHset = vi.fn().mockResolvedValue('OK')
    vi.mocked(getRedis).mockReturnValue({
      hgetall: vi.fn(),
      hset: mockHset,
      del: vi.fn(),
    } as any)
    vi.mocked(upsertVector).mockResolvedValue(undefined)

    const article = await storeKnowledgeArticle({
      title: 'Test Article',
      question: 'How do I test?',
      answer: 'Write tests with vitest.',
      appId: 'my-app',
      source: 'manual',
      tags: ['testing'],
    })

    expect(article).toMatchObject({
      title: 'Test Article',
      question: 'How do I test?',
      answer: 'Write tests with vitest.',
      appId: 'my-app',
    })
    expect(article.id).toBeDefined()
    expect(article.metadata.source).toBe('manual')
    expect(article.metadata.tags).toEqual(['testing'])

    // Should upsert to vector
    expect(upsertVector).toHaveBeenCalledTimes(1)

    // Should store in Redis
    expect(mockHset).toHaveBeenCalledTimes(1)
  })

  it('stores shared articles in shared namespace', async () => {
    const mockHset = vi.fn().mockResolvedValue('OK')
    vi.mocked(getRedis).mockReturnValue({
      hgetall: vi.fn(),
      hset: mockHset,
      del: vi.fn(),
    } as any)
    vi.mocked(upsertVector).mockResolvedValue(undefined)

    await storeKnowledgeArticle({
      title: 'Shared Article',
      question: 'Q',
      answer: 'A',
      appId: 'my-app',
      source: 'policy',
      shared: true,
    })

    // Vector upsert should use 'shared' as appId
    expect(upsertVector).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          appId: 'shared',
        }),
      })
    )

    // Redis key should use shared namespace
    expect(mockHset).toHaveBeenCalled()
    const redisCall = mockHset.mock.calls[0]
    expect(redisCall?.[0]).toContain('knowledge:shared')
  })
})

describe('getKnowledgeArticle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns article from Redis', async () => {
    const mockArticle = {
      id: 'article-123',
      title: 'Test',
      question: 'Q',
      answer: 'A',
      appId: 'my-app',
      metadata: JSON.stringify({
        source: 'faq',
        created_at: '2024-01-01',
        tags: [],
      }),
    }

    vi.mocked(getRedis).mockReturnValue({
      hgetall: vi.fn().mockResolvedValue(mockArticle),
      hset: vi.fn(),
      del: vi.fn(),
    } as any)

    const article = await getKnowledgeArticle('article-123', 'my-app')

    expect(article).toMatchObject({
      id: 'article-123',
      title: 'Test',
      question: 'Q',
      answer: 'A',
      appId: 'my-app',
    })
    expect(article?.metadata.source).toBe('faq')
  })

  it('returns null when article not found', async () => {
    vi.mocked(getRedis).mockReturnValue({
      hgetall: vi.fn().mockResolvedValue({}),
      hset: vi.fn(),
      del: vi.fn(),
    } as any)

    const article = await getKnowledgeArticle('nonexistent', 'my-app')

    expect(article).toBeNull()
  })

  it('looks in shared namespace when specified', async () => {
    const mockHgetall = vi.fn().mockResolvedValue({
      id: 'shared-123',
      title: 'Shared',
      question: 'Q',
      answer: 'A',
      appId: 'shared',
      metadata: JSON.stringify({
        source: 'policy',
        created_at: '2024-01-01',
        tags: [],
      }),
    })

    vi.mocked(getRedis).mockReturnValue({
      hgetall: mockHgetall,
      hset: vi.fn(),
      del: vi.fn(),
    } as any)

    await getKnowledgeArticle('shared-123', 'my-app', true)

    // Should query shared namespace
    expect(mockHgetall).toHaveBeenCalledWith(
      expect.stringContaining('knowledge:shared')
    )
  })
})
