/**
 * Trust score repository tests (Redis-backed)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Redis client
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
  mget: vi.fn(),
}

vi.mock('../redis/client', () => ({
  getRedis: () => mockRedis,
}))

import { deleteTrustScore, getTrustScore, upsertTrustScore } from './repository'

describe('Trust Score Repository (Redis)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getTrustScore', () => {
    it('should return null when no trust score exists', async () => {
      mockRedis.get.mockResolvedValue(null)

      const result = await getTrustScore('app-1', 'refund-simple')

      expect(result).toBeNull()
      expect(mockRedis.get).toHaveBeenCalledWith('trust:app-1:refund-simple')
    })

    it('should return trust score with decay applied', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      mockRedis.get.mockResolvedValue({
        appId: 'app-1',
        category: 'refund-simple',
        trustScore: 0.9,
        sampleCount: 100,
        lastUpdatedAt: thirtyDaysAgo.toISOString(),
        decayHalfLifeDays: 30,
      })

      const result = await getTrustScore('app-1', 'refund-simple')

      expect(result).not.toBeNull()
      expect(result?.appId).toBe('app-1')
      expect(result?.category).toBe('refund-simple')
      expect(result?.sampleCount).toBe(100)
      // After 30 days with 30-day half-life, score should be ~0.45 (0.9 * 0.5)
      expect(result?.trustScore).toBeCloseTo(0.45, 2)
    })

    it('should handle deprecated 3-arg signature for backwards compatibility', async () => {
      mockRedis.get.mockResolvedValue({
        appId: 'app-1',
        category: 'refund-simple',
        trustScore: 0.8,
        sampleCount: 50,
        lastUpdatedAt: new Date().toISOString(),
        decayHalfLifeDays: 30,
      })

      // Old signature: (db, appId, category)
      const result = await getTrustScore({} as any, 'app-1', 'refund-simple')

      expect(result).not.toBeNull()
      expect(result?.trustScore).toBeCloseTo(0.8, 2)
      expect(mockRedis.get).toHaveBeenCalledWith('trust:app-1:refund-simple')
    })
  })

  describe('upsertTrustScore', () => {
    it('should set trust score in Redis', async () => {
      mockRedis.set.mockResolvedValue('OK')

      await upsertTrustScore('app-1', 'refund-simple', {
        trustScore: 0.85,
        sampleCount: 1,
      })

      expect(mockRedis.set).toHaveBeenCalledWith(
        'trust:app-1:refund-simple',
        expect.objectContaining({
          appId: 'app-1',
          category: 'refund-simple',
          trustScore: 0.85,
          sampleCount: 1,
        })
      )
    })

    it('should handle deprecated 4-arg signature for backwards compatibility', async () => {
      mockRedis.set.mockResolvedValue('OK')

      // Old signature: (db, appId, category, update)
      await upsertTrustScore({} as any, 'app-2', 'transfer', {
        trustScore: 0.92,
        sampleCount: 150,
      })

      expect(mockRedis.set).toHaveBeenCalledWith(
        'trust:app-2:transfer',
        expect.objectContaining({
          appId: 'app-2',
          category: 'transfer',
          trustScore: 0.92,
          sampleCount: 150,
        })
      )
    })
  })

  describe('deleteTrustScore', () => {
    it('should delete trust score from Redis', async () => {
      mockRedis.del.mockResolvedValue(1)

      await deleteTrustScore('app-1', 'refund-simple')

      expect(mockRedis.del).toHaveBeenCalledWith('trust:app-1:refund-simple')
    })
  })
})
