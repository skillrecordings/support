/**
 * Tests for FAQ Review Module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approveCandidate,
  clearQueue,
  getCandidate,
  getPendingCandidates,
  getQueueStats,
  rejectCandidate,
  saveCandidatesToQueue,
} from './review'
import type { FaqCandidate } from './types'

// Mock Redis
const mockRedis = {
  exists: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
  sadd: vi.fn(),
  srem: vi.fn(),
  smembers: vi.fn(),
  scard: vi.fn(),
  del: vi.fn(),
}

vi.mock('../redis/client', () => ({
  getRedis: () => mockRedis,
}))

// Mock knowledge store
const mockStoreArticle = vi.fn()

vi.mock('../knowledge/search', () => ({
  storeKnowledgeArticle: (input: unknown) => mockStoreArticle(input),
}))

describe('FAQ Review Module', () => {
  const testAppId = 'test-app'

  const mockCandidate: FaqCandidate = {
    id: 'faq-123',
    question: 'How do I reset my password?',
    answer: 'Click the "Forgot Password" link on the login page.',
    clusterId: 'cluster-1',
    clusterSize: 5,
    unchangedRate: 0.8,
    confidence: 0.85,
    tags: ['account', 'password'],
    subjectPatterns: ['password reset'],
    sourceConversationIds: ['conv-1', 'conv-2'],
    generatedAt: new Date(),
    suggestedCategory: 'account',
    status: 'pending',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreArticle.mockResolvedValue({
      id: 'article-123',
      title: 'Password Reset',
      question: mockCandidate.question,
      answer: mockCandidate.answer,
      appId: testAppId,
      metadata: {},
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('saveCandidatesToQueue', () => {
    it('saves new candidates to queue', async () => {
      mockRedis.exists.mockResolvedValue(0) // Doesn't exist

      const saved = await saveCandidatesToQueue([mockCandidate], testAppId)

      expect(saved).toBe(1)
      expect(mockRedis.set).toHaveBeenCalledWith(
        `faq:candidate:${mockCandidate.id}`,
        expect.stringContaining(mockCandidate.question)
      )
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        `faq:pending:${testAppId}`,
        mockCandidate.id
      )
    })

    it('skips existing candidates', async () => {
      mockRedis.exists.mockResolvedValue(1) // Already exists

      const saved = await saveCandidatesToQueue([mockCandidate], testAppId)

      expect(saved).toBe(0)
      expect(mockRedis.set).not.toHaveBeenCalled()
    })
  })

  describe('getPendingCandidates', () => {
    it('returns pending candidates sorted by confidence', async () => {
      const highConfCandidate = {
        ...mockCandidate,
        id: 'high',
        confidence: 0.95,
      }
      const lowConfCandidate = { ...mockCandidate, id: 'low', confidence: 0.7 }

      mockRedis.smembers.mockResolvedValue(['low', 'high'])
      mockRedis.get
        .mockResolvedValueOnce(
          JSON.stringify({
            ...lowConfCandidate,
            appId: testAppId,
            storedAt: new Date().toISOString(),
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            ...highConfCandidate,
            appId: testAppId,
            storedAt: new Date().toISOString(),
          })
        )

      const candidates = await getPendingCandidates(testAppId)

      expect(candidates).toHaveLength(2)
      expect(candidates[0]?.confidence).toBe(0.95) // High confidence first
      expect(candidates[1]?.confidence).toBe(0.7)
    })

    it('returns empty array when no pending candidates', async () => {
      mockRedis.smembers.mockResolvedValue([])

      const candidates = await getPendingCandidates(testAppId)

      expect(candidates).toHaveLength(0)
    })
  })

  describe('approveCandidate', () => {
    it('publishes to knowledge base and updates status', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          ...mockCandidate,
          appId: testAppId,
          storedAt: new Date().toISOString(),
        })
      )

      const result = await approveCandidate(mockCandidate.id)

      expect(result.success).toBe(true)
      expect(result.articleId).toBe('article-123')
      expect(mockStoreArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          question: mockCandidate.question,
          answer: mockCandidate.answer,
          appId: testAppId,
          source: 'faq',
        })
      )
      expect(mockRedis.srem).toHaveBeenCalledWith(
        `faq:pending:${testAppId}`,
        mockCandidate.id
      )
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        `faq:approved:${testAppId}`,
        mockCandidate.id
      )
    })

    it('allows editing before approval', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          ...mockCandidate,
          appId: testAppId,
          storedAt: new Date().toISOString(),
        })
      )

      const newQuestion = 'How do I change my password?'
      const newAnswer = 'Use the account settings page.'

      const result = await approveCandidate(mockCandidate.id, {
        question: newQuestion,
        answer: newAnswer,
      })

      expect(result.success).toBe(true)
      expect(result.action).toBe('edited')
      expect(mockStoreArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          question: newQuestion,
          answer: newAnswer,
        })
      )
    })

    it('returns error for non-existent candidate', async () => {
      mockRedis.get.mockResolvedValue(null)

      const result = await approveCandidate('non-existent')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Candidate not found')
    })
  })

  describe('rejectCandidate', () => {
    it('moves candidate to rejected set', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          ...mockCandidate,
          appId: testAppId,
          storedAt: new Date().toISOString(),
        })
      )

      const result = await rejectCandidate(
        mockCandidate.id,
        'Duplicate content'
      )

      expect(result.success).toBe(true)
      expect(result.action).toBe('rejected')
      expect(mockRedis.srem).toHaveBeenCalledWith(
        `faq:pending:${testAppId}`,
        mockCandidate.id
      )
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        `faq:rejected:${testAppId}`,
        mockCandidate.id
      )
    })
  })

  describe('getQueueStats', () => {
    it('returns queue statistics', async () => {
      mockRedis.scard
        .mockResolvedValueOnce(10) // pending
        .mockResolvedValueOnce(25) // approved
        .mockResolvedValueOnce(5) // rejected

      const stats = await getQueueStats(testAppId)

      expect(stats).toEqual({
        pending: 10,
        approved: 25,
        rejected: 5,
        total: 40,
      })
    })
  })

  describe('clearQueue', () => {
    it('clears all candidates for an app', async () => {
      mockRedis.smembers
        .mockResolvedValueOnce(['id1', 'id2'])
        .mockResolvedValueOnce(['id3'])
        .mockResolvedValueOnce([])

      const cleared = await clearQueue(testAppId)

      expect(cleared).toBe(3)
      expect(mockRedis.del).toHaveBeenCalledTimes(6) // 3 candidates + 3 sets
    })

    it('clears only specified status', async () => {
      mockRedis.smembers.mockResolvedValue(['id1'])

      const cleared = await clearQueue(testAppId, 'rejected')

      expect(cleared).toBe(1)
      expect(mockRedis.del).toHaveBeenCalledTimes(2) // 1 candidate + 1 set
    })
  })
})
