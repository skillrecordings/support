import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Memory } from './schemas'

// Mock client module before importing MemoryService
vi.mock('./client', async () => {
  return {
    upsertMemory: vi.fn().mockResolvedValue({ success: true }),
    queryMemories: vi.fn().mockResolvedValue([]),
    fetchMemory: vi.fn().mockResolvedValue(null),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
  }
})

import * as client from './client'
import { MemoryService } from './memory'

// Get references to mocked functions
const mockUpsert = vi.mocked(client.upsertMemory)
const mockQuery = vi.mocked(client.queryMemories)
const mockFetch = vi.mocked(client.fetchMemory)
const mockDelete = vi.mocked(client.deleteMemory)

describe('MemoryService', () => {
  beforeEach(() => {
    // Use mockClear to preserve implementations, just clear call history
    mockUpsert.mockClear()
    mockQuery.mockClear()
    mockFetch.mockClear()
    mockDelete.mockClear()
  })

  describe('store()', () => {
    it('creates memory with UUID and default metadata', async () => {
      mockUpsert.mockResolvedValue({ success: true })

      const result = await MemoryService.store('test content', {
        collection: 'test',
        source: 'agent',
      })

      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
      expect(result.content).toBe('test content')
      expect(result.metadata.collection).toBe('test')
      expect(result.metadata.source).toBe('agent')
      expect(result.metadata.confidence).toBe(1)
      expect(result.metadata.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(result.metadata.votes).toEqual({
        upvotes: 0,
        downvotes: 0,
        citations: 0,
        success_rate: 0,
      })
      expect(mockUpsert).toHaveBeenCalledWith(result)
    })

    it('merges provided metadata with defaults', async () => {
      mockUpsert.mockResolvedValue({ success: true })

      const result = await MemoryService.store('test', {
        collection: 'custom',
        source: 'human',
        tags: ['tag1', 'tag2'],
        app_slug: 'test-app',
        confidence: 0.8,
      })

      expect(result.metadata.collection).toBe('custom')
      expect(result.metadata.source).toBe('human')
      expect(result.metadata.tags).toEqual(['tag1', 'tag2'])
      expect(result.metadata.app_slug).toBe('test-app')
      expect(result.metadata.confidence).toBe(0.8)
    })
  })

  describe('find()', () => {
    it('queries memories and returns SearchResults with decay scoring', async () => {
      // Use very recent date to minimize decay
      const createdAt = new Date().toISOString()

      const memory: Memory = {
        id: 'mem-1',
        content: 'test memory',
        metadata: {
          collection: 'test',
          source: 'agent',
          tags: [],
          confidence: 1,
          created_at: createdAt,
          votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
        },
      }

      mockQuery.mockResolvedValueOnce([
        {
          id: 'mem-1',
          score: 0.95, // High score to ensure it passes threshold
          metadata: memory.metadata,
        },
      ])

      // Mock fetchMemory to return the memory for this ID
      mockFetch.mockImplementation(async (id: string) => {
        if (id === 'mem-1') return memory
        return null
      })

      const results = await MemoryService.find('test query', {
        collection: 'test',
        limit: 10,
        threshold: 0.4, // Lower threshold to account for default 0.5 reputation
      })

      expect(results).toHaveLength(1)
      const result = results[0]
      if (!result) throw new Error('No result')
      expect(result.memory.id).toBe('mem-1')
      expect(result.raw_score).toBe(0.95)
      expect(result.score).toBeLessThan(0.95) // Decayed score
      expect(result.decay_factor).toBeGreaterThan(0)
      expect(result.age_days).toBeGreaterThanOrEqual(0)
      expect(mockQuery).toHaveBeenCalledWith({
        query: 'test query',
        collection: 'test',
        topK: 20, // Over-fetch by 2x to account for filtering
      })
    })

    it('applies metadata filters', async () => {
      mockQuery.mockResolvedValueOnce([])

      await MemoryService.find('test', {
        collection: 'test',
        app_slug: 'test-app',
        tags: ['tag1', 'tag2'],
      })

      expect(mockQuery).toHaveBeenCalledWith({
        query: 'test',
        collection: 'test',
        topK: 20, // Over-fetch by 2x
        filter:
          'app_slug = "test-app" AND tags[*] = "tag1" AND tags[*] = "tag2"',
      })
    })

    it('filters results by threshold', async () => {
      // Use recent date so confidence stays high
      const createdAt = new Date().toISOString()

      mockQuery.mockResolvedValueOnce([
        {
          id: 'mem-1',
          score: 0.9, // High raw score
          metadata: {
            collection: 'test',
            source: 'agent',
            tags: [],
            confidence: 1,
            created_at: createdAt,
            votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
          },
        },
        {
          id: 'mem-2',
          score: 0.3, // Low raw score
          metadata: {
            collection: 'test',
            source: 'agent',
            tags: [],
            confidence: 1,
            created_at: createdAt,
            votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
          },
        },
      ])

      mockFetch.mockImplementation(async (id: string) => ({
        id,
        content: `content ${id}`,
        metadata: {
          collection: 'test',
          source: 'agent' as const,
          tags: [],
          confidence: 1,
          created_at: createdAt,
          votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
        },
      }))

      const results = await MemoryService.find('test', {
        collection: 'test',
        threshold: 0.4, // Lower to account for 0.5 reputation
      })

      expect(results).toHaveLength(1)
      const result = results[0]
      if (!result) throw new Error('No result')
      expect(result.memory.id).toBe('mem-1')
    })

    it('excludes stale memories by default', async () => {
      const oldDate = new Date('2020-01-01T00:00:00Z').toISOString()

      mockQuery.mockResolvedValueOnce([
        {
          id: 'mem-stale',
          score: 0.9,
          metadata: {
            collection: 'test',
            source: 'agent',
            tags: [],
            confidence: 1,
            created_at: oldDate,
            votes: {
              upvotes: 0,
              downvotes: 10,
              citations: 0,
              success_rate: 0,
            },
          },
        },
      ])

      mockFetch.mockResolvedValueOnce({
        id: 'mem-stale',
        content: 'stale memory',
        metadata: {
          collection: 'test',
          source: 'agent',
          tags: [],
          confidence: 1,
          created_at: oldDate,
          votes: {
            upvotes: 0,
            downvotes: 10,
            citations: 0,
            success_rate: 0,
          },
        },
      })

      const results = await MemoryService.find('test', {
        collection: 'test',
        include_stale: false,
      })

      // Confidence should be very low due to age and downvotes
      expect(results).toHaveLength(0)
    })

    it('includes stale memories when requested', async () => {
      const oldDate = new Date('2020-01-01T00:00:00Z').toISOString()

      const memory: Memory = {
        id: 'mem-stale',
        content: 'stale memory',
        metadata: {
          collection: 'test',
          source: 'agent',
          tags: [],
          confidence: 1,
          created_at: oldDate,
          votes: {
            upvotes: 0,
            downvotes: 10,
            citations: 0,
            success_rate: 0,
          },
        },
      }

      mockQuery.mockResolvedValueOnce([
        {
          id: 'mem-stale',
          score: 0.9,
          metadata: memory.metadata,
        },
      ])

      mockFetch.mockImplementation(async (id: string) => {
        if (id === 'mem-stale') return memory
        return null
      })

      const results = await MemoryService.find('test', {
        collection: 'test',
        include_stale: true,
        threshold: 0, // Very low threshold to ensure stale memory passes
      })

      expect(results.length).toBeGreaterThan(0)
    })

    it('sorts results by final decayed score', async () => {
      const recentDate = new Date().toISOString()
      const oldDate = new Date('2024-01-01T00:00:00Z').toISOString()

      mockQuery.mockResolvedValueOnce([
        {
          id: 'mem-old-high',
          score: 0.95,
          metadata: {
            collection: 'test',
            source: 'agent',
            tags: [],
            confidence: 1,
            created_at: oldDate,
            votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
          },
        },
        {
          id: 'mem-recent-low',
          score: 0.8,
          metadata: {
            collection: 'test',
            source: 'agent',
            tags: [],
            confidence: 1,
            created_at: recentDate,
            votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
          },
        },
      ])

      mockFetch.mockImplementation(async (id: string, collection: string) => {
        const metadata =
          id === 'mem-old-high'
            ? {
                collection: 'test',
                source: 'agent' as const,
                tags: [],
                confidence: 1,
                created_at: oldDate,
                votes: {
                  upvotes: 0,
                  downvotes: 0,
                  citations: 0,
                  success_rate: 0,
                },
              }
            : {
                collection: 'test',
                source: 'agent' as const,
                tags: [],
                confidence: 1,
                created_at: recentDate,
                votes: {
                  upvotes: 0,
                  downvotes: 0,
                  citations: 0,
                  success_rate: 0,
                },
              }
        return {
          id,
          content: `content ${id}`,
          metadata,
        }
      })

      const results = await MemoryService.find('test', {
        collection: 'test',
        threshold: 0.3, // Lower threshold for this test
      })

      // Recent memory should rank higher despite lower raw score
      expect(results.length).toBeGreaterThan(0)
      const result = results[0]
      if (!result) throw new Error('No result')
      expect(result.memory.id).toBe('mem-recent-low')
    })
  })

  describe('get()', () => {
    it('fetches memory by ID', async () => {
      const memory: Memory = {
        id: 'mem-123',
        content: 'test content',
        metadata: {
          collection: 'test',
          source: 'agent',
          tags: [],
          confidence: 1,
          created_at: new Date().toISOString(),
          votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
        },
      }

      mockFetch.mockResolvedValue(memory)

      const result = await MemoryService.get('mem-123', 'test')

      expect(result).toEqual(memory)
      expect(mockFetch).toHaveBeenCalledWith('mem-123', 'test')
    })

    it('returns null if memory not found', async () => {
      mockFetch.mockResolvedValue(null)

      const result = await MemoryService.get('nonexistent', 'test')

      expect(result).toBeNull()
    })
  })

  describe('delete()', () => {
    it('deletes memory by ID', async () => {
      mockDelete.mockResolvedValue(undefined)

      await MemoryService.delete('mem-123', 'test')

      expect(mockDelete).toHaveBeenCalledWith('mem-123', 'test')
    })
  })

  describe('validate()', () => {
    it('updates last_validated_at timestamp', async () => {
      const memory: Memory = {
        id: 'mem-123',
        content: 'test content',
        metadata: {
          collection: 'test',
          source: 'agent',
          tags: [],
          confidence: 1,
          created_at: new Date('2025-01-01T00:00:00Z').toISOString(),
          votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
        },
      }

      mockFetch.mockResolvedValue(memory)
      mockUpsert.mockResolvedValue({ success: true })

      await MemoryService.validate('mem-123', 'test')

      expect(mockFetch).toHaveBeenCalledWith('mem-123', 'test')
      expect(mockUpsert).toHaveBeenCalled()

      const upsertCall = mockUpsert.mock.calls[0]?.[0]
      if (!upsertCall) throw new Error('No upsert call')
      expect(upsertCall.id).toBe('mem-123')
      expect(upsertCall.metadata.last_validated_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T/
      )
    })

    it('throws if memory not found', async () => {
      mockFetch.mockResolvedValue(null)

      await expect(
        MemoryService.validate('nonexistent', 'test')
      ).rejects.toThrow('Memory not found')
    })
  })
})
