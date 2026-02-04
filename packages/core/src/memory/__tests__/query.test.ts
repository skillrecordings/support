import { beforeEach, describe, expect, it, vi } from 'vitest'

// Type for the search results
interface MockSearchResult {
  memory: {
    id: string
    content: string
    metadata: Record<string, unknown>
  }
  score: number
  raw_score: number
  age_days: number
  decay_factor: number
}

// Use vi.hoisted for proper mock hoisting
const {
  mockFindSimilar,
  mockCite,
  mockRecordCitationOutcome,
  mockParseContent,
} = vi.hoisted(() => ({
  mockFindSimilar: vi.fn(() => Promise.resolve([] as MockSearchResult[])),
  mockCite: vi.fn(() => Promise.resolve()),
  mockRecordCitationOutcome: vi.fn(() => Promise.resolve()),
  mockParseContent: vi.fn((content: string) => ({
    situation: 'test situation',
    decision: 'test decision',
  })),
}))

vi.mock('@skillrecordings/memory/support-memory', () => ({
  SupportMemoryService: {
    findSimilar: mockFindSimilar,
    cite: mockCite,
    recordCitationOutcome: mockRecordCitationOutcome,
    parseContent: mockParseContent,
  },
}))

// Import after mocking
import {
  type RelevantMemory,
  citeMemories,
  formatMemoriesCompact,
  formatMemoriesForPrompt,
  formatMemoriesForValidation,
  queryCorrectedMemories,
  queryMemoriesForSituation,
  queryMemoriesForStage,
  recordCitationOutcome,
} from '../query'

describe('Memory Query Layer', () => {
  beforeEach(() => {
    mockFindSimilar.mockClear()
    mockCite.mockClear()
    mockRecordCitationOutcome.mockClear()
  })

  describe('queryMemoriesForStage', () => {
    it('calls SupportMemoryService.findSimilar with correct params', async () => {
      mockFindSimilar.mockResolvedValueOnce([])

      await queryMemoriesForStage({
        appId: 'total-typescript',
        stage: 'classify',
        situation: 'Customer wants a refund',
        category: 'refund',
        limit: 3,
      })

      expect(mockFindSimilar).toHaveBeenCalledWith(
        'Customer wants a refund',
        expect.objectContaining({
          app_slug: 'total-typescript',
          stage: 'classify',
          category: 'refund',
          limit: 3,
          threshold: 0.6,
          include_stale: false,
        })
      )
    })

    it('transforms results to RelevantMemory format', async () => {
      mockFindSimilar.mockResolvedValueOnce([
        {
          memory: {
            id: 'mem-123',
            content: 'SITUATION: test\n\nDECISION: approved',
            metadata: {
              outcome: 'success',
              category: 'refund',
              confidence: 0.9,
            },
          },
          score: 0.85,
          raw_score: 0.9,
          age_days: 5,
          decay_factor: 0.9,
        },
      ])

      const results = await queryMemoriesForStage({
        appId: 'total-typescript',
        stage: 'classify',
        situation: 'test',
      })

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        id: 'mem-123',
        score: 0.85,
        rawScore: 0.9,
        ageDays: 5,
        outcome: 'success',
        category: 'refund',
        confidence: 0.9,
      })
    })
  })

  describe('queryMemoriesForSituation', () => {
    it('queries without stage filter', async () => {
      mockFindSimilar.mockResolvedValueOnce([])

      await queryMemoriesForSituation({
        appId: 'total-typescript',
        situation: 'General context query',
      })

      expect(mockFindSimilar).toHaveBeenCalledWith(
        'General context query',
        expect.objectContaining({
          app_slug: 'total-typescript',
          // stage should NOT be present
        })
      )

      // biome-ignore lint/suspicious/noExplicitAny: test assertion on mock call args
      const callArgs = (mockFindSimilar.mock.calls as any)[0]?.[1]
      expect(callArgs?.stage).toBeUndefined()
    })
  })

  describe('queryCorrectedMemories', () => {
    it('filters for corrected outcome', async () => {
      mockFindSimilar.mockResolvedValueOnce([])

      await queryCorrectedMemories({
        appId: 'total-typescript',
        situation: 'Similar to past mistake',
        stage: 'validate',
      })

      expect(mockFindSimilar).toHaveBeenCalledWith(
        'Similar to past mistake',
        expect.objectContaining({
          outcome: 'corrected',
          include_stale: true,
        })
      )
    })
  })

  describe('formatMemoriesForPrompt', () => {
    it('returns empty string for no memories', () => {
      const result = formatMemoriesForPrompt([])
      expect(result).toBe('')
    })

    it('formats memories with headers and content', () => {
      const memories: RelevantMemory[] = [
        {
          id: 'mem-1',
          situation: 'Customer requested refund after 2 days',
          decision: 'Approved the refund per policy',
          score: 0.9,
          rawScore: 0.95,
          ageDays: 3,
          outcome: 'success',
          confidence: 0.9,
        },
      ]

      const result = formatMemoriesForPrompt(memories)

      expect(result).toContain('## Relevant Past Decisions')
      expect(result).toContain('✅ Successful Decision')
      expect(result).toContain('Customer requested refund after 2 days')
      expect(result).toContain('Approved the refund per policy')
      expect(result).toContain('90% match')
    })

    it('includes correction info for corrected memories', () => {
      const memories: RelevantMemory[] = [
        {
          id: 'mem-2',
          situation: 'Confusing edge case',
          decision: 'Made wrong call',
          score: 0.8,
          rawScore: 0.85,
          ageDays: 10,
          outcome: 'corrected',
          correction: 'Should have escalated to human',
          confidence: 0.5,
        },
      ]

      const result = formatMemoriesForPrompt(memories)

      expect(result).toContain('🔄 Corrected Decision')
      expect(result).toContain('⚠️ Correction')
      expect(result).toContain('Should have escalated to human')
    })
  })

  describe('formatMemoriesCompact', () => {
    it('returns empty string for no memories', () => {
      const result = formatMemoriesCompact([])
      expect(result).toBe('')
    })

    it('formats memories in compact form', () => {
      const memories: RelevantMemory[] = [
        {
          id: 'mem-1',
          situation: 'Test situation',
          decision: 'Test decision',
          score: 0.9,
          rawScore: 0.95,
          ageDays: 1,
          outcome: 'success',
          confidence: 0.9,
        },
      ]

      const result = formatMemoriesCompact(memories)

      expect(result).toContain('## Prior Decisions')
      expect(result).toContain('✅')
      expect(result).toContain('**Situation**')
      expect(result).toContain('**Decision**')
    })
  })

  describe('formatMemoriesForValidation', () => {
    it('returns empty string when no corrections or failures', () => {
      const memories: RelevantMemory[] = [
        {
          id: 'mem-1',
          situation: 'Good decision',
          decision: 'Success',
          score: 0.9,
          rawScore: 0.95,
          ageDays: 1,
          outcome: 'success',
          confidence: 0.9,
        },
      ]

      const result = formatMemoriesForValidation(memories)
      expect(result).toBe('')
    })

    it('formats corrections and failures for validation', () => {
      const memories: RelevantMemory[] = [
        {
          id: 'mem-1',
          situation: 'Bad decision case',
          decision: 'Wrong action',
          score: 0.8,
          rawScore: 0.85,
          ageDays: 5,
          outcome: 'corrected',
          correction: 'Should have done X instead',
          confidence: 0.5,
        },
        {
          id: 'mem-2',
          situation: 'Another bad case',
          decision: 'Failed action',
          score: 0.7,
          rawScore: 0.75,
          ageDays: 10,
          outcome: 'failed',
          confidence: 0.3,
        },
      ]

      const result = formatMemoriesForValidation(memories)

      expect(result).toContain('⚠️ Learned Corrections')
      expect(result).toContain('Bad decision case')
      expect(result).toContain('Should have done X instead')
      expect(result).toContain('Another bad case')
      expect(result).toContain('Failed')
    })
  })

  describe('citation tracking', () => {
    it('citeMemories calls service with correct params', async () => {
      await citeMemories(['mem-1', 'mem-2'], 'run-123', 'total-typescript')

      expect(mockCite).toHaveBeenCalledWith(
        ['mem-1', 'mem-2'],
        'run-123',
        'total-typescript'
      )
    })

    it('citeMemories skips empty array', async () => {
      await citeMemories([], 'run-123', 'total-typescript')
      expect(mockCite).not.toHaveBeenCalled()
    })

    it('recordCitationOutcome calls service with correct params', async () => {
      await recordCitationOutcome(
        ['mem-1'],
        'run-123',
        'success',
        'total-typescript'
      )

      expect(mockRecordCitationOutcome).toHaveBeenCalledWith(
        ['mem-1'],
        'run-123',
        'success',
        'total-typescript'
      )
    })
  })
})
