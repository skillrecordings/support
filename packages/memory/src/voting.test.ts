import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Memory } from './schemas'

// Shared mock store
const mockMemories = new Map<string, Memory>()

// Mock client module before imports
vi.mock('./client', () => {
  return {
    getVectorIndex: vi.fn().mockReturnValue({
      query: vi.fn().mockImplementation(async (options: any, config: any) => {
        // Return all memories in the specified collection
        const collection = config?.namespace || 'default'
        const results: any[] = []

        mockMemories.forEach((memory, key) => {
          if (key.endsWith(`:${collection}`)) {
            results.push({
              id: memory.id,
              score: 1.0,
              data: memory.content,
              metadata: memory.metadata,
            })
          }
        })

        return results
      }),
    }),
    upsertMemory: vi.fn().mockImplementation(async (memory: Memory) => {
      mockMemories.set(`${memory.id}:${memory.metadata.collection}`, memory)
      return { success: true }
    }),
    fetchMemory: vi
      .fn()
      .mockImplementation(async (id: string, collection: string) => {
        return mockMemories.get(`${id}:${collection}`) || null
      }),
    queryMemories: vi.fn().mockResolvedValue([]),
    deleteMemory: vi
      .fn()
      .mockImplementation(async (id: string, collection: string) => {
        mockMemories.delete(`${id}:${collection}`)
      }),
  }
})

import { MemoryService } from './memory'
import { VotingService } from './voting'

describe('VotingService', () => {
  let testMemory: Memory

  beforeEach(async () => {
    // Clear mock store
    mockMemories.clear()

    // Create a test memory to vote on
    testMemory = await MemoryService.store('Test memory for voting', {
      collection: 'test',
      source: 'agent',
      tags: ['test'],
    })
  })

  describe('vote', () => {
    it('should increment upvotes when voting upvote', async () => {
      await VotingService.vote(testMemory.id, 'test', 'upvote')

      const updated = await MemoryService.get(testMemory.id, 'test')
      expect(updated?.metadata.votes.upvotes).toBe(1)
      expect(updated?.metadata.votes.downvotes).toBe(0)
    })

    it('should increment downvotes when voting downvote', async () => {
      await VotingService.vote(testMemory.id, 'test', 'downvote')

      const updated = await MemoryService.get(testMemory.id, 'test')
      expect(updated?.metadata.votes.upvotes).toBe(0)
      expect(updated?.metadata.votes.downvotes).toBe(1)
    })

    it('should allow multiple votes on same memory', async () => {
      await VotingService.vote(testMemory.id, 'test', 'upvote')
      await VotingService.vote(testMemory.id, 'test', 'upvote')
      await VotingService.vote(testMemory.id, 'test', 'downvote')

      const updated = await MemoryService.get(testMemory.id, 'test')
      expect(updated?.metadata.votes.upvotes).toBe(2)
      expect(updated?.metadata.votes.downvotes).toBe(1)
    })

    it('should throw error if memory not found', async () => {
      await expect(
        VotingService.vote(randomUUID(), 'test', 'upvote')
      ).rejects.toThrow('Memory not found')
    })
  })

  describe('cite', () => {
    it('should increment citations when memory is cited', async () => {
      await VotingService.cite([testMemory.id], 'run-123', 'test')

      const updated = await MemoryService.get(testMemory.id, 'test')
      expect(updated?.metadata.votes.citations).toBe(1)
    })

    it('should allow multiple citations', async () => {
      await VotingService.cite([testMemory.id], 'run-123', 'test')
      await VotingService.cite([testMemory.id], 'run-124', 'test')
      await VotingService.cite([testMemory.id], 'run-125', 'test')

      const updated = await MemoryService.get(testMemory.id, 'test')
      expect(updated?.metadata.votes.citations).toBe(3)
    })

    it('should handle batch citations for multiple memories', async () => {
      const memory2 = await MemoryService.store('Test memory 2', {
        collection: 'test',
        source: 'agent',
        tags: ['test'],
      })
      const memory3 = await MemoryService.store('Test memory 3', {
        collection: 'test',
        source: 'agent',
        tags: ['test'],
      })

      await VotingService.cite(
        [testMemory.id, memory2.id, memory3.id],
        'run-123',
        'test'
      )

      const updated1 = await MemoryService.get(testMemory.id, 'test')
      const updated2 = await MemoryService.get(memory2.id, 'test')
      const updated3 = await MemoryService.get(memory3.id, 'test')

      expect(updated1?.metadata.votes.citations).toBe(1)
      expect(updated2?.metadata.votes.citations).toBe(1)
      expect(updated3?.metadata.votes.citations).toBe(1)
    })

    it('should throw error if any memory not found', async () => {
      await expect(
        VotingService.cite([randomUUID()], 'run-123', 'test')
      ).rejects.toThrow('Memory not found')
    })

    it('should throw error if memoryIds is empty', async () => {
      await expect(VotingService.cite([], 'run-123', 'test')).rejects.toThrow(
        'memoryIds cannot be empty'
      )
    })
  })

  describe('recordOutcome', () => {
    beforeEach(async () => {
      // Add some citations first
      await VotingService.cite([testMemory.id], 'run-123', 'test')
    })

    it('should update success_rate to 1.0 after first success', async () => {
      await VotingService.recordOutcome(
        [testMemory.id],
        'run-123',
        'success',
        'test'
      )

      const updated = await MemoryService.get(testMemory.id, 'test')
      expect(updated?.metadata.votes.success_rate).toBe(1.0)
    })

    it('should update success_rate to 0.0 after first failure', async () => {
      await VotingService.recordOutcome(
        [testMemory.id],
        'run-123',
        'failure',
        'test'
      )

      const updated = await MemoryService.get(testMemory.id, 'test')
      expect(updated?.metadata.votes.success_rate).toBe(0.0)
    })

    it('should calculate success_rate correctly for mixed outcomes', async () => {
      // 2 citations total
      await VotingService.cite([testMemory.id], 'run-124', 'test')

      // 1 success, 1 failure = 50%
      await VotingService.recordOutcome(
        [testMemory.id],
        'run-123',
        'success',
        'test'
      )
      await VotingService.recordOutcome(
        [testMemory.id],
        'run-124',
        'failure',
        'test'
      )

      const updated = await MemoryService.get(testMemory.id, 'test')
      expect(updated?.metadata.votes.success_rate).toBe(0.5)
    })

    it('should handle multiple outcomes correctly', async () => {
      // 4 citations total
      await VotingService.cite([testMemory.id], 'run-124', 'test')
      await VotingService.cite([testMemory.id], 'run-125', 'test')
      await VotingService.cite([testMemory.id], 'run-126', 'test')

      // 3 successes, 1 failure = 75%
      await VotingService.recordOutcome(
        [testMemory.id],
        'run-123',
        'success',
        'test'
      )
      await VotingService.recordOutcome(
        [testMemory.id],
        'run-124',
        'success',
        'test'
      )
      await VotingService.recordOutcome(
        [testMemory.id],
        'run-125',
        'success',
        'test'
      )
      await VotingService.recordOutcome(
        [testMemory.id],
        'run-126',
        'failure',
        'test'
      )

      const updated = await MemoryService.get(testMemory.id, 'test')
      expect(updated?.metadata.votes.success_rate).toBe(0.75)
    })

    it('should handle batch outcomes for multiple memories', async () => {
      const memory2 = await MemoryService.store('Test memory 2', {
        collection: 'test',
        source: 'agent',
        tags: ['test'],
      })

      // Cite both memories
      await VotingService.cite([memory2.id], 'run-123', 'test')

      // Record success for both
      await VotingService.recordOutcome(
        [testMemory.id, memory2.id],
        'run-123',
        'success',
        'test'
      )

      const updated1 = await MemoryService.get(testMemory.id, 'test')
      const updated2 = await MemoryService.get(memory2.id, 'test')

      expect(updated1?.metadata.votes.success_rate).toBe(1.0)
      expect(updated2?.metadata.votes.success_rate).toBe(1.0)
    })

    it('should throw error if any memory not found', async () => {
      await expect(
        VotingService.recordOutcome(
          [randomUUID()],
          'run-123',
          'success',
          'test'
        )
      ).rejects.toThrow('Memory not found')
    })

    it('should throw error if memoryIds is empty', async () => {
      await expect(
        VotingService.recordOutcome([], 'run-123', 'success', 'test')
      ).rejects.toThrow('memoryIds cannot be empty')
    })
  })

  describe('stats', () => {
    beforeEach(async () => {
      // Create multiple test memories in different collections
      await MemoryService.store('Memory 1', {
        collection: 'test',
        source: 'agent',
      })
      await MemoryService.store('Memory 2', {
        collection: 'test',
        source: 'agent',
      })
      await MemoryService.store('Memory 3', {
        collection: 'other',
        source: 'human',
      })
    })

    it('should return stats for all collections when no filter provided', async () => {
      const stats = await VotingService.stats()

      expect(stats).toHaveProperty('test')
      expect(stats).toHaveProperty('other')
    })

    it('should return stats for specific collection', async () => {
      const stats = await VotingService.stats('test')

      expect(stats).toHaveProperty('test')
      expect(stats).not.toHaveProperty('other')
    })

    it('should include count and average confidence', async () => {
      const stats = await VotingService.stats('test')

      expect(stats.test).toBeDefined()
      expect(stats.test!.count).toBeGreaterThanOrEqual(3) // At least our 3 test memories
      expect(stats.test!.avg_confidence).toBeGreaterThan(0)
      expect(stats.test!.avg_confidence).toBeLessThanOrEqual(1)
    })
  })

  describe('prune', () => {
    let oldMemory: Memory
    let recentMemory: Memory
    let heavilyDownvotedMemory: Memory

    beforeEach(async () => {
      // Create an old memory (120 days old, will have decay of 0.0625)
      // With neutral reputation (0.5), confidence = 0.0625 * 0.5 = 0.03125 < 0.1
      oldMemory = await MemoryService.store('Old memory', {
        collection: 'test',
        source: 'agent',
        created_at: new Date(
          Date.now() - 120 * 24 * 60 * 60 * 1000
        ).toISOString(), // 120 days ago
      })

      // Create a recent memory - even though calculateConfidence ignores metadata.confidence
      // this will have recent date, so high decay factor and won't be pruned
      recentMemory = await MemoryService.store('Recent low confidence', {
        collection: 'test',
        source: 'agent',
      })

      // Create a heavily downvoted memory
      heavilyDownvotedMemory = await MemoryService.store('Heavily downvoted', {
        collection: 'test',
        source: 'agent',
      })

      // Add 6 downvotes
      for (let i = 0; i < 6; i++) {
        await VotingService.vote(heavilyDownvotedMemory.id, 'test', 'downvote')
      }
    })

    it('should remove memories with low confidence and sufficient age', async () => {
      const result = await VotingService.prune({
        min_confidence: 0.1,
        min_age_days: 30,
      })

      expect(result.deleted_count).toBeGreaterThan(0)

      // Old low-confidence memory should be gone
      const oldCheck = await MemoryService.get(oldMemory.id, 'test')
      expect(oldCheck).toBeNull()

      // Recent low-confidence memory should still exist
      const recentCheck = await MemoryService.get(recentMemory.id, 'test')
      expect(recentCheck).not.toBeNull()
    })

    it('should remove heavily downvoted memories regardless of age', async () => {
      const result = await VotingService.prune({
        max_downvotes: 5,
      })

      expect(result.deleted_count).toBeGreaterThan(0)

      // Heavily downvoted memory should be gone
      const check = await MemoryService.get(heavilyDownvotedMemory.id, 'test')
      expect(check).toBeNull()
    })

    it('should respect collection filter', async () => {
      // Create memory in different collection
      const otherMemory = await MemoryService.store('Other collection', {
        collection: 'other',
        source: 'agent',
        confidence: 0.05,
        created_at: new Date(
          Date.now() - 60 * 24 * 60 * 60 * 1000
        ).toISOString(),
      })

      const result = await VotingService.prune({
        collection: 'test',
        min_confidence: 0.1,
        min_age_days: 30,
      })

      // Other collection memory should not be deleted
      const check = await MemoryService.get(otherMemory.id, 'other')
      expect(check).not.toBeNull()
    })

    it('should return deleted count and IDs', async () => {
      const result = await VotingService.prune({
        min_confidence: 0.1,
        min_age_days: 30,
      })

      expect(result.deleted_count).toBeGreaterThan(0)
      expect(Array.isArray(result.deleted_ids)).toBe(true)
      expect(result.deleted_ids.length).toBe(result.deleted_count)
    })
  })
})
