import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SupportMemoryService } from './support-memory'
import type { StoreSupportMemoryInput, SupportMemory } from './support-schemas'

// Mock the client module
vi.mock('./client', () => ({
  upsertMemory: vi.fn().mockResolvedValue(undefined),
  fetchMemory: vi.fn(),
  queryMemories: vi.fn().mockResolvedValue([]),
  deleteMemory: vi.fn().mockResolvedValue(undefined),
}))

// Mock voting service
vi.mock('./voting', () => ({
  VotingService: {
    vote: vi.fn().mockResolvedValue(undefined),
    cite: vi.fn().mockResolvedValue(undefined),
    recordOutcome: vi.fn().mockResolvedValue(undefined),
  },
}))

import { fetchMemory, queryMemories, upsertMemory } from './client'
import { VotingService } from './voting'

describe('SupportMemoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('store', () => {
    it('should store a support memory with formatted content', async () => {
      const input: StoreSupportMemoryInput = {
        situation: 'Customer requested refund after 3 days',
        decision: 'Approved immediate refund',
        stage: 'draft',
        category: 'refund',
        app_slug: 'epic-web',
        conversation_id: 'cnv_123',
        tags: ['urgent'],
      }

      const memory = await SupportMemoryService.store(input)

      expect(memory.id).toBeDefined()
      expect(memory.content).toContain('SITUATION: Customer requested refund')
      expect(memory.content).toContain('DECISION: Approved immediate refund')
      expect(memory.metadata.stage).toBe('draft')
      expect(memory.metadata.outcome).toBe('success')
      expect(memory.metadata.category).toBe('refund')
      expect(memory.metadata.collection).toBe('support:epic-web')
      expect(memory.metadata.conversation_id).toBe('cnv_123')
      expect(memory.metadata.tags).toContain('urgent')

      expect(upsertMemory).toHaveBeenCalledWith(memory)
    })

    it('should use global collection when no app_slug provided', async () => {
      const input: StoreSupportMemoryInput = {
        situation: 'General situation',
        decision: 'General decision',
        stage: 'classify',
      }

      const memory = await SupportMemoryService.store(input)

      expect(memory.metadata.collection).toBe('support:global')
    })

    it('should default outcome to success', async () => {
      const input: StoreSupportMemoryInput = {
        situation: 'Test',
        decision: 'Test',
        stage: 'validate',
      }

      const memory = await SupportMemoryService.store(input)

      expect(memory.metadata.outcome).toBe('success')
    })
  })

  describe('findSimilar', () => {
    it('should query with correct collection', async () => {
      await SupportMemoryService.findSimilar('refund request', {
        app_slug: 'epic-web',
      })

      expect(queryMemories).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'support:epic-web',
          query: 'refund request',
        })
      )
    })

    it('should build filter from options', async () => {
      await SupportMemoryService.findSimilar('test', {
        app_slug: 'test-app',
        stage: 'draft',
        outcome: 'success',
        category: 'refund',
      })

      expect(queryMemories).toHaveBeenCalledWith(
        expect.objectContaining({
          filter:
            'stage = "draft" AND outcome = "success" AND category = "refund"',
        })
      )
    })

    it('should return empty array when no matches', async () => {
      vi.mocked(queryMemories).mockResolvedValue([])

      const results = await SupportMemoryService.findSimilar('nonexistent')

      expect(results).toEqual([])
    })
  })

  describe('correct', () => {
    it('should update memory with correction and record downvote', async () => {
      const mockMemory: SupportMemory = {
        id: 'mem-123',
        content: 'SITUATION: Test\n\nDECISION: Test',
        metadata: {
          collection: 'support:epic-web',
          source: 'agent',
          confidence: 1,
          created_at: new Date().toISOString(),
          tags: [],
          votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
          stage: 'draft',
          outcome: 'success',
        },
      }

      vi.mocked(fetchMemory).mockResolvedValue(mockMemory)

      await SupportMemoryService.correct('mem-123', 'epic-web', {
        correction: 'Should have escalated',
        category: 'escalation',
      })

      expect(upsertMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            outcome: 'corrected',
            correction: 'Should have escalated',
            category: 'escalation',
          }),
        })
      )

      expect(VotingService.vote).toHaveBeenCalledWith(
        'mem-123',
        'support:epic-web',
        'downvote'
      )
    })

    it('should throw if memory not found', async () => {
      vi.mocked(fetchMemory).mockResolvedValue(null)

      await expect(
        SupportMemoryService.correct('nonexistent', 'app', {
          correction: 'test',
        })
      ).rejects.toThrow('Memory not found')
    })
  })

  describe('recordSuccess', () => {
    it('should update outcome to success and record upvote', async () => {
      const mockMemory: SupportMemory = {
        id: 'mem-123',
        content: 'SITUATION: Test\n\nDECISION: Test',
        metadata: {
          collection: 'support:epic-web',
          source: 'agent',
          confidence: 1,
          created_at: new Date().toISOString(),
          tags: [],
          votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
          stage: 'draft',
          outcome: 'success',
        },
      }

      vi.mocked(fetchMemory).mockResolvedValue(mockMemory)

      await SupportMemoryService.recordSuccess('mem-123', 'epic-web')

      expect(upsertMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            outcome: 'success',
          }),
        })
      )

      expect(VotingService.vote).toHaveBeenCalledWith(
        'mem-123',
        'support:epic-web',
        'upvote'
      )
    })
  })

  describe('cite', () => {
    it('should delegate to VotingService.cite', async () => {
      await SupportMemoryService.cite(['mem-1', 'mem-2'], 'run-123', 'epic-web')

      expect(VotingService.cite).toHaveBeenCalledWith(
        ['mem-1', 'mem-2'],
        'run-123',
        'support:epic-web'
      )
    })
  })

  describe('recordCitationOutcome', () => {
    it('should delegate to VotingService.recordOutcome', async () => {
      await SupportMemoryService.recordCitationOutcome(
        ['mem-1'],
        'run-123',
        'success',
        'epic-web'
      )

      expect(VotingService.recordOutcome).toHaveBeenCalledWith(
        ['mem-1'],
        'run-123',
        'success',
        'support:epic-web'
      )
    })
  })

  describe('parseContent', () => {
    it('should parse formatted content back to parts', () => {
      const content =
        'SITUATION: Customer requested help\n\nDECISION: Provided documentation link'

      const { situation, decision } = SupportMemoryService.parseContent(content)

      expect(situation).toBe('Customer requested help')
      expect(decision).toBe('Provided documentation link')
    })

    it('should handle content without decision marker', () => {
      const content = 'SITUATION: Just a situation'

      const { situation, decision } = SupportMemoryService.parseContent(content)

      expect(situation).toBe('Just a situation')
      expect(decision).toBe('')
    })
  })

  describe('formatContent', () => {
    it('should format situation and decision', () => {
      const content = SupportMemoryService.formatContent(
        'Customer needs help',
        'Helped them'
      )

      expect(content).toBe(
        'SITUATION: Customer needs help\n\nDECISION: Helped them'
      )
    })

    it('should trim whitespace', () => {
      const content = SupportMemoryService.formatContent(
        '  situation with spaces  ',
        '  decision with spaces  '
      )

      expect(content).toBe(
        'SITUATION: situation with spaces\n\nDECISION: decision with spaces'
      )
    })
  })

  describe('getCollection', () => {
    it('should return app-specific collection', () => {
      expect(SupportMemoryService.getCollection('epic-web')).toBe(
        'support:epic-web'
      )
    })

    it('should return global collection when no app provided', () => {
      expect(SupportMemoryService.getCollection()).toBe('support:global')
      expect(SupportMemoryService.getCollection(undefined)).toBe(
        'support:global'
      )
    })
  })
})
