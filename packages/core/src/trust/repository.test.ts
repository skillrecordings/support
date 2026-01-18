/**
 * Trust score repository tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTrustScore, upsertTrustScore } from './repository'

describe('Trust Score Repository', () => {
  describe('getTrustScore', () => {
    it('should return null when no trust score exists', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      }

      const result = await getTrustScore(
        mockDb as any,
        'app-1',
        'refund-simple'
      )

      expect(result).toBeNull()
    })

    it('should return trust score with decay applied', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              {
                id: 'ts-1',
                app_id: 'app-1',
                category: 'refund-simple',
                trust_score: 0.9,
                sample_count: 100,
                decay_half_life_days: 30,
                last_updated_at: thirtyDaysAgo,
                created_at: new Date(),
              },
            ]),
          }),
        }),
      }

      const result = await getTrustScore(
        mockDb as any,
        'app-1',
        'refund-simple'
      )

      expect(result).not.toBeNull()
      expect(result?.appId).toBe('app-1')
      expect(result?.category).toBe('refund-simple')
      expect(result?.sampleCount).toBe(100)
      // After 30 days with 30-day half-life, score should be ~0.45 (0.9 * 0.5)
      expect(result?.trustScore).toBeCloseTo(0.45, 2)
    })

    it('should use default half-life when not set in database', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              {
                id: 'ts-1',
                app_id: 'app-1',
                category: 'refund-simple',
                trust_score: 0.8,
                sample_count: 50,
                decay_half_life_days: null,
                last_updated_at: new Date(),
                created_at: new Date(),
              },
            ]),
          }),
        }),
      }

      const result = await getTrustScore(
        mockDb as any,
        'app-1',
        'refund-simple'
      )

      expect(result).not.toBeNull()
      // No decay applied since just updated, should be same as base score
      expect(result?.trustScore).toBeCloseTo(0.8, 2)
    })
  })

  describe('upsertTrustScore', () => {
    it('should insert new trust score when none exists', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }

      await upsertTrustScore(mockDb as any, 'app-1', 'refund-simple', {
        trustScore: 0.85,
        sampleCount: 1,
      })

      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('should update existing trust score on conflict', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }

      await upsertTrustScore(mockDb as any, 'app-2', 'transfer', {
        trustScore: 0.92,
        sampleCount: 150,
      })

      const insertCall = mockDb.insert().values
      const values = insertCall.mock.calls[0][0]

      expect(values).toMatchObject({
        app_id: 'app-2',
        category: 'transfer',
        trust_score: 0.92,
        sample_count: 150,
      })
    })

    it('should generate unique ID for new records', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }

      await upsertTrustScore(mockDb as any, 'app-1', 'refund-simple', {
        trustScore: 0.75,
        sampleCount: 25,
      })

      const insertCall = mockDb.insert().values
      const values = insertCall.mock.calls[0][0]

      expect(values.id).toMatch(/^ts-/)
    })
  })
})
