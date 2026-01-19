import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks - create the mocks at module scope
const mockUpsert = vi.fn().mockResolvedValue({ success: true })
const mockQuery = vi.fn().mockResolvedValue([
  {
    id: 'mem-1',
    score: 0.95,
    metadata: {
      collection: 'test',
      source: 'agent',
      tags: [],
      confidence: 0.9,
      created_at: '2024-01-01T00:00:00Z',
      votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
    },
  },
])
const mockDelete = vi.fn().mockResolvedValue({ success: true })
const mockFetch = vi.fn().mockResolvedValue([
  {
    id: 'mem-123',
    data: 'Test content',
    metadata: {
      collection: 'test',
      source: 'agent',
      tags: [],
      confidence: 0.9,
      created_at: '2024-01-01T00:00:00Z',
      votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
    },
  },
])

vi.mock('@upstash/vector', () => ({
  Index: vi.fn().mockImplementation(() => ({
    upsert: mockUpsert,
    query: mockQuery,
    delete: mockDelete,
    fetch: mockFetch,
  })),
}))

// Mock environment variables
const originalEnv = process.env
beforeEach(() => {
  process.env = {
    ...originalEnv,
    UPSTASH_VECTOR_REST_URL: 'https://test.upstash.io',
    UPSTASH_VECTOR_REST_TOKEN: 'test-token',
  }
  // Reset mocks between tests
  mockUpsert.mockClear()
  mockQuery.mockClear()
  mockDelete.mockClear()
  mockFetch.mockClear()
})

afterEach(() => {
  process.env = originalEnv
})

describe('getVectorIndex', () => {
  it('should create and return an Index instance', async () => {
    const { getVectorIndex } = await import('./client')
    const index = getVectorIndex()

    expect(index).toBeDefined()
    expect(typeof index).toBe('object')
  })

  it('should return the same instance on subsequent calls (lazy singleton)', async () => {
    const { getVectorIndex } = await import('./client')
    const index1 = getVectorIndex()
    const index2 = getVectorIndex()

    expect(index1).toBe(index2)
  })

  it('should throw if UPSTASH_VECTOR_REST_URL is missing', async () => {
    delete process.env.UPSTASH_VECTOR_REST_URL
    vi.resetModules()

    const { getVectorIndex } = await import('./client')

    expect(() => getVectorIndex()).toThrow(
      'UPSTASH_VECTOR_REST_URL environment variable is required'
    )
  })

  it('should throw if UPSTASH_VECTOR_REST_TOKEN is missing', async () => {
    delete process.env.UPSTASH_VECTOR_REST_TOKEN
    vi.resetModules()

    const { getVectorIndex } = await import('./client')

    expect(() => getVectorIndex()).toThrow(
      'UPSTASH_VECTOR_REST_TOKEN environment variable is required'
    )
  })
})

describe('upsertMemory', () => {
  it('should upsert memory with data string and namespace', async () => {
    const { upsertMemory } = await import('./client')

    const memory = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      content: 'Test memory content',
      metadata: {
        collection: 'test-collection',
        tags: ['test'],
        source: 'agent' as const,
        confidence: 0.9,
        created_at: new Date().toISOString(),
        votes: {
          upvotes: 0,
          downvotes: 0,
          citations: 0,
          success_rate: 0,
        },
      },
    }

    await upsertMemory(memory)

    expect(mockUpsert).toHaveBeenCalledWith(
      {
        id: memory.id,
        data: memory.content,
        metadata: memory.metadata,
      },
      { namespace: 'test-collection' }
    )
  })
})

describe('queryMemories', () => {
  it('should query with data string, topK, and namespace', async () => {
    const { queryMemories } = await import('./client')

    const results = await queryMemories({
      query: 'test query',
      collection: 'test',
      topK: 5,
    })

    expect(mockQuery).toHaveBeenCalledWith(
      {
        data: 'test query',
        topK: 5,
        includeMetadata: true,
      },
      { namespace: 'test' }
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      id: 'mem-1',
      score: 0.95,
      metadata: {
        collection: 'test',
        source: 'agent',
        tags: [],
        confidence: 0.9,
        created_at: '2024-01-01T00:00:00Z',
        votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
      },
    })
  })

  it('should apply metadata filter when provided', async () => {
    mockQuery.mockResolvedValueOnce([])
    const { queryMemories } = await import('./client')

    await queryMemories({
      query: 'test query',
      collection: 'test',
      topK: 10,
      filter: 'tags IN ["important"]',
    })

    expect(mockQuery).toHaveBeenCalledWith(
      {
        data: 'test query',
        topK: 10,
        includeMetadata: true,
        filter: 'tags IN ["important"]',
      },
      { namespace: 'test' }
    )
  })

  it('should use default topK of 10 when not provided', async () => {
    const { queryMemories } = await import('./client')

    await queryMemories({
      query: 'test query',
      collection: 'test',
    })

    expect(mockQuery).toHaveBeenCalledWith(
      {
        data: 'test query',
        topK: 10,
        includeMetadata: true,
      },
      { namespace: 'test' }
    )
  })
})

describe('deleteMemory', () => {
  it('should delete memory by ID in correct namespace', async () => {
    const { deleteMemory } = await import('./client')

    await deleteMemory('mem-123', 'test-collection')

    expect(mockDelete).toHaveBeenCalledWith('mem-123', {
      namespace: 'test-collection',
    })
  })
})

describe('fetchMemory', () => {
  it('should fetch memory by ID from correct namespace', async () => {
    const { fetchMemory } = await import('./client')

    const result = await fetchMemory('mem-123', 'test')

    expect(mockFetch).toHaveBeenCalledWith(['mem-123'], {
      namespace: 'test',
      includeMetadata: true,
      includeData: true,
    })

    expect(result).toEqual({
      id: 'mem-123',
      content: 'Test content',
      metadata: {
        collection: 'test',
        source: 'agent',
        tags: [],
        confidence: 0.9,
        created_at: '2024-01-01T00:00:00Z',
        votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
      },
    })
  })

  it('should return null when memory not found', async () => {
    mockFetch.mockResolvedValueOnce([])
    const { fetchMemory } = await import('./client')

    const result = await fetchMemory('nonexistent', 'test')

    expect(result).toBeNull()
  })
})
