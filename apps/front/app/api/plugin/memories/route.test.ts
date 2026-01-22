import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

// Mock the memory and voting services
vi.mock('@skillrecordings/memory/memory', () => ({
  MemoryService: {
    find: vi.fn(),
    store: vi.fn(),
    validate: vi.fn(),
  },
}))

vi.mock('@skillrecordings/memory/voting', () => ({
  VotingService: {
    vote: vi.fn(),
    cite: vi.fn(),
    recordOutcome: vi.fn(),
    stats: vi.fn(),
  },
}))

vi.mock('@skillrecordings/core/observability/axiom', () => ({
  traceMemoryCite: vi.fn(),
  traceMemoryOutcome: vi.fn(),
}))

import {
  traceMemoryCite,
  traceMemoryOutcome,
} from '@skillrecordings/core/observability/axiom'
import { MemoryService } from '@skillrecordings/memory/memory'
import { VotingService } from '@skillrecordings/memory/voting'

/**
 * Helper to create a NextRequest with query parameters
 */
function createGetRequest(query?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/plugin/memories')
  if (query) {
    url.searchParams.set('query', query)
  }
  return new NextRequest(url, { method: 'GET' })
}

/**
 * Helper to create a NextRequest with JSON body
 */
function createPostRequest(body: any): NextRequest {
  const url = new URL('http://localhost:3000/api/plugin/memories')
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/plugin/memories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return search results when query is provided', async () => {
    const mockResults = [
      {
        memory: {
          id: 'mem-1',
          content: 'Test memory',
          metadata: {
            collection: 'learnings',
            source: 'human' as const,
            confidence: 0.95,
            tags: ['test'],
            created_at: '2025-01-19T00:00:00Z',
            votes: { upvotes: 5, downvotes: 0, citations: 0, success_rate: 0 },
          },
        },
        score: 0.92,
        raw_score: 0.92,
        age_days: 1,
        decay_factor: 0.98,
      },
    ]

    vi.mocked(MemoryService.find).mockResolvedValue(mockResults)

    const request = createGetRequest('test query')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.results).toHaveLength(1)
    expect(data.results[0]).toEqual({
      id: 'mem-1',
      content: 'Test memory',
      score: 0.92,
      raw_score: 0.92,
      age_days: 1,
      confidence: 0.95,
      tags: ['test'],
      created_at: '2025-01-19T00:00:00Z',
      votes: { upvotes: 5, downvotes: 0, citations: 0, success_rate: 0 },
    })
    expect(MemoryService.find).toHaveBeenCalledWith('test query', {
      collection: 'learnings',
      limit: 10,
      threshold: 0.5,
    })
  })

  it('should return 400 when query parameter is missing', async () => {
    const request = createGetRequest()
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Query parameter is required')
    expect(MemoryService.find).not.toHaveBeenCalled()
  })

  it('should handle empty search results', async () => {
    vi.mocked(MemoryService.find).mockResolvedValue([])

    const request = createGetRequest('nonexistent')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.results).toEqual([])
  })

  it('should handle search errors and return 500', async () => {
    const error = new Error('Database connection failed')
    vi.mocked(MemoryService.find).mockRejectedValue(error)

    const request = createGetRequest('test')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to search memories')
  })

  it('should handle multiple results correctly', async () => {
    const mockResults = [
      {
        memory: {
          id: 'mem-1',
          content: 'First memory',
          metadata: {
            collection: 'learnings',
            source: 'human' as const,
            confidence: 0.95,
            tags: ['tag1'],
            created_at: '2025-01-19T00:00:00Z',
            votes: { upvotes: 10, downvotes: 1, citations: 0, success_rate: 0 },
          },
        },
        score: 0.95,
        raw_score: 0.95,
        age_days: 1,
        decay_factor: 0.98,
      },
      {
        memory: {
          id: 'mem-2',
          content: 'Second memory',
          metadata: {
            collection: 'learnings',
            source: 'human' as const,
            confidence: 0.85,
            tags: ['tag1', 'tag2'],
            created_at: '2025-01-18T00:00:00Z',
            votes: { upvotes: 3, downvotes: 0, citations: 0, success_rate: 0 },
          },
        },
        score: 0.88,
        raw_score: 0.88,
        age_days: 2,
        decay_factor: 0.96,
      },
    ]

    vi.mocked(MemoryService.find).mockResolvedValue(mockResults)

    const request = createGetRequest('test')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toHaveLength(2)
    expect(data.results[0].id).toBe('mem-1')
    expect(data.results[1].id).toBe('mem-2')
  })
})

describe('POST /api/plugin/memories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('store action', () => {
    it('should store a memory with content', async () => {
      const mockMemory = {
        id: 'mem-123',
        content: 'Learned something important',
        metadata: {
          collection: 'learnings',
          source: 'human' as const,
          confidence: 1,
          tags: ['learning'],
          created_at: '2025-01-19T00:00:00Z',
          votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
        },
      }

      vi.mocked(MemoryService.store).mockResolvedValue(mockMemory)

      const request = createPostRequest({
        action: 'store',
        content: 'Learned something important',
        tags: ['learning'],
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.memory).toEqual({
        id: 'mem-123',
        content: 'Learned something important',
        tags: ['learning'],
        created_at: '2025-01-19T00:00:00Z',
      })
      expect(MemoryService.store).toHaveBeenCalledWith(
        'Learned something important',
        {
          collection: 'learnings',
          source: 'human',
          tags: ['learning'],
        }
      )
    })

    it('should store a memory without tags', async () => {
      const mockMemory = {
        id: 'mem-456',
        content: 'Another memory',
        metadata: {
          collection: 'learnings',
          source: 'human' as const,
          confidence: 1,
          tags: [],
          created_at: '2025-01-19T00:00:00Z',
          votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
        },
      }

      vi.mocked(MemoryService.store).mockResolvedValue(mockMemory)

      const request = createPostRequest({
        action: 'store',
        content: 'Another memory',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(MemoryService.store).toHaveBeenCalledWith('Another memory', {
        collection: 'learnings',
        source: 'human',
        tags: [],
      })
    })

    it('should return 400 when content is missing', async () => {
      const request = createPostRequest({
        action: 'store',
        tags: ['test'],
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Content is required and must be a string')
      expect(MemoryService.store).not.toHaveBeenCalled()
    })

    it('should return 400 when content is not a string', async () => {
      const request = createPostRequest({
        action: 'store',
        content: 123,
        tags: ['test'],
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Content is required and must be a string')
      expect(MemoryService.store).not.toHaveBeenCalled()
    })

    it('should return 400 when content is empty string', async () => {
      const request = createPostRequest({
        action: 'store',
        content: '',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Content is required and must be a string')
      expect(MemoryService.store).not.toHaveBeenCalled()
    })

    it('should handle store errors and return 500', async () => {
      const error = new Error('Storage failed')
      vi.mocked(MemoryService.store).mockRejectedValue(error)

      const request = createPostRequest({
        action: 'store',
        content: 'Test memory',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Storage failed')
    })
  })

  describe('upvote action', () => {
    it('should upvote a memory', async () => {
      vi.mocked(VotingService.vote).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'upvote',
        memory_id: 'mem-123',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toBe('Memory upvoted successfully')
      expect(VotingService.vote).toHaveBeenCalledWith(
        'mem-123',
        'learnings',
        'upvote'
      )
    })

    it('should upvote a memory with custom collection', async () => {
      vi.mocked(VotingService.vote).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'upvote',
        memory_id: 'mem-123',
        collection: 'sessions',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(VotingService.vote).toHaveBeenCalledWith(
        'mem-123',
        'sessions',
        'upvote'
      )
    })

    it('should return 400 when memory_id is missing', async () => {
      const request = createPostRequest({
        action: 'upvote',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('memory_id is required and must be a string')
      expect(VotingService.vote).not.toHaveBeenCalled()
    })

    it('should return 400 when memory_id is not a string', async () => {
      const request = createPostRequest({
        action: 'upvote',
        memory_id: 123,
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('memory_id is required and must be a string')
      expect(VotingService.vote).not.toHaveBeenCalled()
    })

    it('should handle voting errors and return 500', async () => {
      const error = new Error('Vote not recorded')
      vi.mocked(VotingService.vote).mockRejectedValue(error)

      const request = createPostRequest({
        action: 'upvote',
        memory_id: 'mem-123',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Vote not recorded')
    })
  })

  describe('downvote action', () => {
    it('should downvote a memory', async () => {
      vi.mocked(VotingService.vote).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'downvote',
        memory_id: 'mem-123',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toBe('Memory downvoted successfully')
      expect(VotingService.vote).toHaveBeenCalledWith(
        'mem-123',
        'learnings',
        'downvote'
      )
    })

    it('should downvote a memory with custom collection', async () => {
      vi.mocked(VotingService.vote).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'downvote',
        memory_id: 'mem-456',
        collection: 'sessions',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(VotingService.vote).toHaveBeenCalledWith(
        'mem-456',
        'sessions',
        'downvote'
      )
    })

    it('should return 400 when memory_id is missing for downvote', async () => {
      const request = createPostRequest({
        action: 'downvote',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('memory_id is required and must be a string')
      expect(VotingService.vote).not.toHaveBeenCalled()
    })
  })

  describe('validate action', () => {
    it('should validate a memory', async () => {
      vi.mocked(MemoryService.validate).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'validate',
        memory_id: 'mem-123',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toBe('Memory validated successfully')
      expect(MemoryService.validate).toHaveBeenCalledWith(
        'mem-123',
        'learnings'
      )
    })

    it('should validate a memory with custom collection', async () => {
      vi.mocked(MemoryService.validate).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'validate',
        memory_id: 'mem-123',
        collection: 'sessions',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(MemoryService.validate).toHaveBeenCalledWith('mem-123', 'sessions')
    })

    it('should return 400 when memory_id is missing for validate', async () => {
      const request = createPostRequest({
        action: 'validate',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('memory_id is required and must be a string')
      expect(MemoryService.validate).not.toHaveBeenCalled()
    })

    it('should return 400 when memory_id is not a string for validate', async () => {
      const request = createPostRequest({
        action: 'validate',
        memory_id: null,
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('memory_id is required and must be a string')
      expect(MemoryService.validate).not.toHaveBeenCalled()
    })

    it('should handle validate errors and return 500', async () => {
      const error = new Error('Validation failed')
      vi.mocked(MemoryService.validate).mockRejectedValue(error)

      const request = createPostRequest({
        action: 'validate',
        memory_id: 'mem-123',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Validation failed')
    })
  })

  describe('cite action', () => {
    it('should cite memories successfully', async () => {
      vi.mocked(VotingService.cite).mockResolvedValue(undefined)
      vi.mocked(traceMemoryCite).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'cite',
        memory_ids: ['mem-1', 'mem-2'],
        run_id: 'run-123',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toBe('2 memories cited successfully')
      expect(VotingService.cite).toHaveBeenCalledWith(
        ['mem-1', 'mem-2'],
        'run-123',
        'learnings'
      )
      expect(traceMemoryCite).toHaveBeenCalledTimes(2)
    })

    it('should cite memories with custom collection', async () => {
      vi.mocked(VotingService.cite).mockResolvedValue(undefined)
      vi.mocked(traceMemoryCite).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'cite',
        memory_ids: ['mem-1'],
        run_id: 'run-456',
        collection: 'sessions',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(VotingService.cite).toHaveBeenCalledWith(
        ['mem-1'],
        'run-456',
        'sessions'
      )
    })

    it('should return 400 when memory_ids is missing', async () => {
      const request = createPostRequest({
        action: 'cite',
        run_id: 'run-123',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe(
        'memory_ids is required and must be a non-empty array'
      )
      expect(VotingService.cite).not.toHaveBeenCalled()
    })

    it('should return 400 when memory_ids is empty', async () => {
      const request = createPostRequest({
        action: 'cite',
        memory_ids: [],
        run_id: 'run-123',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe(
        'memory_ids is required and must be a non-empty array'
      )
      expect(VotingService.cite).not.toHaveBeenCalled()
    })

    it('should return 400 when run_id is missing', async () => {
      const request = createPostRequest({
        action: 'cite',
        memory_ids: ['mem-1'],
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('run_id is required and must be a string')
      expect(VotingService.cite).not.toHaveBeenCalled()
    })

    it('should handle cite errors and trace them', async () => {
      const error = new Error('Citation failed')
      vi.mocked(VotingService.cite).mockRejectedValue(error)
      vi.mocked(traceMemoryCite).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'cite',
        memory_ids: ['mem-1', 'mem-2'],
        run_id: 'run-123',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Citation failed')
      expect(traceMemoryCite).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Citation failed',
        })
      )
    })
  })

  describe('recordOutcome action', () => {
    it('should record outcome successfully', async () => {
      vi.mocked(VotingService.recordOutcome).mockResolvedValue(undefined)
      vi.mocked(traceMemoryOutcome).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'recordOutcome',
        memory_ids: ['mem-1', 'mem-2'],
        run_id: 'run-123',
        outcome: 'success',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toBe('Outcome recorded for 2 memories')
      expect(VotingService.recordOutcome).toHaveBeenCalledWith(
        ['mem-1', 'mem-2'],
        'run-123',
        'success',
        'learnings'
      )
      expect(traceMemoryOutcome).toHaveBeenCalledTimes(2)
    })

    it('should record failure outcome', async () => {
      vi.mocked(VotingService.recordOutcome).mockResolvedValue(undefined)
      vi.mocked(traceMemoryOutcome).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'recordOutcome',
        memory_ids: ['mem-1'],
        run_id: 'run-456',
        outcome: 'failure',
        collection: 'sessions',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(VotingService.recordOutcome).toHaveBeenCalledWith(
        ['mem-1'],
        'run-456',
        'failure',
        'sessions'
      )
    })

    it('should return 400 when memory_ids is missing', async () => {
      const request = createPostRequest({
        action: 'recordOutcome',
        run_id: 'run-123',
        outcome: 'success',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe(
        'memory_ids is required and must be a non-empty array'
      )
      expect(VotingService.recordOutcome).not.toHaveBeenCalled()
    })

    it('should return 400 when run_id is missing', async () => {
      const request = createPostRequest({
        action: 'recordOutcome',
        memory_ids: ['mem-1'],
        outcome: 'success',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('run_id is required and must be a string')
      expect(VotingService.recordOutcome).not.toHaveBeenCalled()
    })

    it('should return 400 when outcome is invalid', async () => {
      const request = createPostRequest({
        action: 'recordOutcome',
        memory_ids: ['mem-1'],
        run_id: 'run-123',
        outcome: 'invalid',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('outcome must be "success" or "failure"')
      expect(VotingService.recordOutcome).not.toHaveBeenCalled()
    })

    it('should handle recordOutcome errors and trace them', async () => {
      const error = new Error('Outcome recording failed')
      vi.mocked(VotingService.recordOutcome).mockRejectedValue(error)
      vi.mocked(traceMemoryOutcome).mockResolvedValue(undefined)

      const request = createPostRequest({
        action: 'recordOutcome',
        memory_ids: ['mem-1'],
        run_id: 'run-123',
        outcome: 'success',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Outcome recording failed')
      expect(traceMemoryOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Outcome recording failed',
        })
      )
    })
  })

  describe('stats action', () => {
    it('should return stats for all collections', async () => {
      const mockStats = {
        learnings: {
          count: 10,
          avg_confidence: 0.85,
          total_upvotes: 25,
          total_downvotes: 3,
          total_citations: 15,
          avg_success_rate: 0.75,
        },
        sessions: {
          count: 5,
          avg_confidence: 0.9,
          total_upvotes: 10,
          total_downvotes: 1,
          total_citations: 8,
          avg_success_rate: 0.8,
        },
      }

      vi.mocked(VotingService.stats).mockResolvedValue(mockStats)

      const request = createPostRequest({
        action: 'stats',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.stats).toEqual(mockStats)
      expect(VotingService.stats).toHaveBeenCalledWith(undefined)
    })

    it('should return stats for specific collection', async () => {
      const mockStats = {
        learnings: {
          count: 10,
          avg_confidence: 0.85,
          total_upvotes: 25,
          total_downvotes: 3,
          total_citations: 15,
          avg_success_rate: 0.75,
        },
      }

      vi.mocked(VotingService.stats).mockResolvedValue(mockStats)

      const request = createPostRequest({
        action: 'stats',
        collection: 'learnings',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.stats).toEqual(mockStats)
      expect(VotingService.stats).toHaveBeenCalledWith('learnings')
    })

    it('should handle stats errors and return 500', async () => {
      const error = new Error('Stats retrieval failed')
      vi.mocked(VotingService.stats).mockRejectedValue(error)

      const request = createPostRequest({
        action: 'stats',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Stats retrieval failed')
    })
  })

  describe('general POST behavior', () => {
    it('should return 400 when action is missing', async () => {
      const request = createPostRequest({
        content: 'test',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Action is required')
    })

    it('should return 400 for unknown action', async () => {
      const request = createPostRequest({
        action: 'unknown_action',
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Unknown action: unknown_action')
    })

    it('should handle malformed JSON and return 500', async () => {
      const url = new URL('http://localhost:3000/api/plugin/memories')
      const request = new NextRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid json}',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBeDefined()
    })
  })
})
