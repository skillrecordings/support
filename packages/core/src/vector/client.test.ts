import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks - create the mocks at module scope
const mockUpsert = vi.fn().mockResolvedValue({ success: true })
const mockQuery = vi.fn().mockResolvedValue([
  {
    id: 'test-1',
    score: 0.95,
    data: 'Matched content',
    metadata: {
      type: 'conversation',
      appId: 'total-typescript',
    },
  },
])

vi.mock('@upstash/vector', () => ({
  Index: vi.fn().mockImplementation(() => ({
    upsert: mockUpsert,
    query: mockQuery,
  })),
}))

// Mock environment variables
const originalEnv = process.env
beforeEach(() => {
  process.env = {
    ...originalEnv,
    UPSTASH_VECTOR_REST_URL: 'https://test-vector.upstash.io',
    UPSTASH_VECTOR_REST_TOKEN: 'test-token',
  }
  // Reset mocks between tests
  mockUpsert.mockClear()
  mockQuery.mockClear()
})

afterEach(() => {
  process.env = originalEnv
})

describe('Vector Client', () => {
  describe('getVectorIndex', () => {
    it('should create and return an Index instance', async () => {
      const { getVectorIndex } = await import('./client')
      const index = getVectorIndex()

      expect(index).toBeDefined()
      expect(typeof index).toBe('object')
    })

    it('should return the same instance on subsequent calls (singleton)', async () => {
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

  describe('upsertVector', () => {
    it('should upsert a vector document', async () => {
      const { upsertVector } = await import('./client')

      await upsertVector({
        id: 'test-1',
        data: 'Test conversation content',
        metadata: {
          type: 'conversation',
          appId: 'total-typescript',
          category: 'refund',
        },
      })

      expect(mockUpsert).toHaveBeenCalledWith({
        id: 'test-1',
        data: 'Test conversation content',
        metadata: {
          type: 'conversation',
          appId: 'total-typescript',
          category: 'refund',
        },
      })
    })
  })

  describe('queryVectors', () => {
    it('should query vectors and return results', async () => {
      const { queryVectors } = await import('./client')

      const results = await queryVectors({
        data: 'search query',
        topK: 5,
        includeMetadata: true,
        includeData: true,
      })

      expect(mockQuery).toHaveBeenCalledWith({
        data: 'search query',
        topK: 5,
        includeMetadata: true,
        includeData: true,
      })
      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('test-1')
      expect(results[0]!.score).toBe(0.95)
    })

    it('should filter by metadata when provided', async () => {
      mockQuery.mockResolvedValueOnce([])
      const { queryVectors } = await import('./client')

      await queryVectors({
        data: 'search query',
        topK: 5,
        filter: 'type = "conversation" AND appId = "total-typescript"',
      })

      expect(mockQuery).toHaveBeenCalledWith({
        data: 'search query',
        topK: 5,
        filter: 'type = "conversation" AND appId = "total-typescript"',
      })
    })
  })
})
