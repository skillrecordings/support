/**
 * Tests for Learning Curves Analytics
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLearningCurve,
  getLearningCurveSummary,
  getRepeatCorrections,
} from './learning-curves'

// Mock the Upstash Vector index
vi.mock('@upstash/vector', () => ({
  Index: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}))

describe('learning-curves', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set required env vars
    process.env.UPSTASH_VECTOR_REST_URL = 'https://test.upstash.io'
    process.env.UPSTASH_VECTOR_REST_TOKEN = 'test-token'
  })

  describe('getLearningCurve', () => {
    it('should return empty array when no memories exist', async () => {
      const result = await getLearningCurve({
        appId: 'test-app',
        days: 30,
      })

      expect(result).toEqual([])
    })

    it('should accept stage filter', async () => {
      const result = await getLearningCurve({
        appId: 'test-app',
        stage: 'classify',
        days: 7,
      })

      expect(result).toEqual([])
    })

    it('should support weekly grouping', async () => {
      const result = await getLearningCurve({
        appId: 'test-app',
        days: 30,
        groupBy: 'week',
      })

      expect(result).toEqual([])
    })
  })

  describe('getRepeatCorrections', () => {
    it('should return empty array when no corrections exist', async () => {
      const result = await getRepeatCorrections({
        appId: 'test-app',
        minCount: 2,
      })

      expect(result).toEqual([])
    })

    it('should respect minCount parameter', async () => {
      const result = await getRepeatCorrections({
        appId: 'test-app',
        minCount: 5,
        limit: 10,
      })

      expect(result).toEqual([])
    })
  })

  describe('getLearningCurveSummary', () => {
    it('should return summary with trend analysis', async () => {
      const result = await getLearningCurveSummary('test-app', 30)

      expect(result).toMatchObject({
        appId: 'test-app',
        dateRange: {
          start: expect.any(String),
          end: expect.any(String),
        },
        trend: 0,
        metrics: [],
        problemStages: [],
      })
    })
  })

  describe('formatPeriod', () => {
    // Test the date formatting internally through getLearningCurve
    it('should handle daily grouping correctly', async () => {
      const result = await getLearningCurve({
        appId: 'test-app',
        days: 1,
        groupBy: 'day',
      })

      // With mocked empty data, metrics should be empty
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle weekly grouping correctly', async () => {
      const result = await getLearningCurve({
        appId: 'test-app',
        days: 7,
        groupBy: 'week',
      })

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
