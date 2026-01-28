/**
 * Tests for the per-category confidence calculator
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftOutcome } from '../rl/types'
import {
  CONFIDENCE_THRESHOLDS,
  type ConfidenceResult,
  calculateConfidenceFromHistory,
  calculateDecayWeight,
  outcomeToSignal,
} from './calculator'
import type { OutcomeRecord } from './repository'

describe('outcomeToSignal', () => {
  it('maps unchanged to 1.0', () => {
    expect(outcomeToSignal('unchanged')).toBe(1.0)
  })

  it('maps minor_edit to 0.5', () => {
    expect(outcomeToSignal('minor_edit')).toBe(0.5)
  })

  it('maps major_rewrite to 0.0', () => {
    expect(outcomeToSignal('major_rewrite')).toBe(0.0)
  })

  it('maps deleted to 0.0', () => {
    expect(outcomeToSignal('deleted')).toBe(0.0)
  })

  it('maps no_draft to 0.5 (fallback)', () => {
    expect(outcomeToSignal('no_draft')).toBe(0.5)
  })
})

describe('calculateDecayWeight', () => {
  it('returns 1.0 for age 0', () => {
    expect(calculateDecayWeight(0, 30 * 24 * 60 * 60 * 1000)).toBe(1.0)
  })

  it('returns approximately 0.368 after one half-life (e^-1)', () => {
    const halfLifeMs = 30 * 24 * 60 * 60 * 1000 // 30 days
    const weight = calculateDecayWeight(halfLifeMs, halfLifeMs)
    expect(weight).toBeCloseTo(Math.exp(-1), 5)
  })

  it('returns approximately 0.135 after two half-lives (e^-2)', () => {
    const halfLifeMs = 30 * 24 * 60 * 60 * 1000 // 30 days
    const weight = calculateDecayWeight(halfLifeMs * 2, halfLifeMs)
    expect(weight).toBeCloseTo(Math.exp(-2), 5)
  })

  it('approaches 0 for very old outcomes', () => {
    const halfLifeMs = 30 * 24 * 60 * 60 * 1000
    const veryOld = halfLifeMs * 10 // 300 days
    expect(calculateDecayWeight(veryOld, halfLifeMs)).toBeLessThan(0.001)
  })
})

describe('calculateConfidenceFromHistory', () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  // Helper to create outcome records
  function createOutcome(
    outcome: DraftOutcome,
    daysAgo: number,
    referenceTime: Date
  ): OutcomeRecord {
    return {
      outcome,
      recordedAt: new Date(referenceTime.getTime() - daysAgo * MS_PER_DAY),
    }
  }

  describe('empty history', () => {
    it('returns 0 confidence with empty history', () => {
      const result = calculateConfidenceFromHistory([])
      expect(result.confidence).toBe(0)
      expect(result.sampleCount).toBe(0)
      expect(result.meetsAutoSendThreshold).toBe(false)
      expect(result.totalWeight).toBe(0)
    })
  })

  describe('single outcome', () => {
    const now = new Date('2024-01-15T12:00:00Z')

    it('returns 1.0 for single recent unchanged outcome', () => {
      const outcomes = [createOutcome('unchanged', 0, now)]
      const result = calculateConfidenceFromHistory(outcomes, 30, now)
      expect(result.confidence).toBe(1.0)
      expect(result.sampleCount).toBe(1)
    })

    it('returns 0.5 for single recent minor_edit outcome', () => {
      const outcomes = [createOutcome('minor_edit', 0, now)]
      const result = calculateConfidenceFromHistory(outcomes, 30, now)
      expect(result.confidence).toBe(0.5)
    })

    it('returns 0.0 for single recent major_rewrite outcome', () => {
      const outcomes = [createOutcome('major_rewrite', 0, now)]
      const result = calculateConfidenceFromHistory(outcomes, 30, now)
      expect(result.confidence).toBe(0.0)
    })

    it('returns 0.0 for single recent deleted outcome', () => {
      const outcomes = [createOutcome('deleted', 0, now)]
      const result = calculateConfidenceFromHistory(outcomes, 30, now)
      expect(result.confidence).toBe(0.0)
    })
  })

  describe('weighted averaging', () => {
    const now = new Date('2024-01-15T12:00:00Z')

    it('weights recent outcomes higher than old ones', () => {
      // Recent unchanged (1.0) + old major_rewrite (0.0)
      // With 30-day half-life, the recent one should dominate
      const outcomes = [
        createOutcome('unchanged', 0, now), // weight ~1.0
        createOutcome('major_rewrite', 60, now), // weight ~0.135 (e^-2)
      ]

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      // confidence = (1.0 * 1.0 + 0.0 * 0.135) / (1.0 + 0.135) ≈ 0.88
      expect(result.confidence).toBeGreaterThan(0.8)
      expect(result.confidence).toBeLessThan(1.0)
    })

    it('values old outcomes less than recent ones', () => {
      // Old unchanged (1.0) + recent major_rewrite (0.0)
      const outcomes = [
        createOutcome('major_rewrite', 0, now), // weight ~1.0
        createOutcome('unchanged', 60, now), // weight ~0.135
      ]

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      // confidence = (0.0 * 1.0 + 1.0 * 0.135) / (1.0 + 0.135) ≈ 0.12
      expect(result.confidence).toBeLessThan(0.2)
    })

    it('calculates correct average for equal-aged outcomes', () => {
      // Two outcomes at same time: unchanged (1.0) + major_rewrite (0.0)
      const outcomes = [
        createOutcome('unchanged', 0, now),
        createOutcome('major_rewrite', 0, now),
      ]

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      // Same weights, so simple average: (1.0 + 0.0) / 2 = 0.5
      expect(result.confidence).toBe(0.5)
    })

    it('handles mixed outcomes correctly', () => {
      // 3 unchanged, 1 minor_edit, 1 major_rewrite - all recent
      const outcomes = [
        createOutcome('unchanged', 0, now),
        createOutcome('unchanged', 0, now),
        createOutcome('unchanged', 0, now),
        createOutcome('minor_edit', 0, now),
        createOutcome('major_rewrite', 0, now),
      ]

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      // (1.0 + 1.0 + 1.0 + 0.5 + 0.0) / 5 = 3.5 / 5 = 0.7
      expect(result.confidence).toBe(0.7)
    })
  })

  describe('auto-send threshold', () => {
    const now = new Date('2024-01-15T12:00:00Z')

    it('does not meet threshold with too few samples', () => {
      // 19 samples, all unchanged (100% confidence)
      const outcomes = Array.from({ length: 19 }, () =>
        createOutcome('unchanged', 0, now)
      )

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      expect(result.confidence).toBe(1.0)
      expect(result.sampleCount).toBe(19)
      expect(result.meetsAutoSendThreshold).toBe(false) // < 20 samples
    })

    it('meets threshold with sufficient samples and confidence', () => {
      // 20 samples, all unchanged (100% confidence)
      const outcomes = Array.from({ length: 20 }, () =>
        createOutcome('unchanged', 0, now)
      )

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      expect(result.confidence).toBe(1.0)
      expect(result.sampleCount).toBe(20)
      expect(result.meetsAutoSendThreshold).toBe(true)
    })

    it('does not meet threshold when confidence too low', () => {
      // 20 samples: 17 unchanged (85%), 3 major_rewrite
      // confidence = 17/20 = 0.85, which is < 0.9
      const outcomes = [
        ...Array.from({ length: 17 }, () => createOutcome('unchanged', 0, now)),
        ...Array.from({ length: 3 }, () =>
          createOutcome('major_rewrite', 0, now)
        ),
      ]

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      expect(result.confidence).toBe(0.85)
      expect(result.sampleCount).toBe(20)
      expect(result.meetsAutoSendThreshold).toBe(false) // < 90%
    })

    it('meets threshold at exactly 90% with 20+ samples', () => {
      // 20 samples: 18 unchanged (90%), 2 major_rewrite
      const outcomes = [
        ...Array.from({ length: 18 }, () => createOutcome('unchanged', 0, now)),
        ...Array.from({ length: 2 }, () =>
          createOutcome('major_rewrite', 0, now)
        ),
      ]

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      expect(result.confidence).toBe(0.9)
      expect(result.sampleCount).toBe(20)
      expect(result.meetsAutoSendThreshold).toBe(true)
    })
  })

  describe('configurable half-life', () => {
    const now = new Date('2024-01-15T12:00:00Z')

    it('shorter half-life gives more weight to recent outcomes', () => {
      const outcomes = [
        createOutcome('unchanged', 0, now),
        createOutcome('major_rewrite', 15, now),
      ]

      // With 7-day half-life, 15-day-old outcome has very low weight
      const shortHalfLife = calculateConfidenceFromHistory(outcomes, 7, now)
      // With 60-day half-life, 15-day-old outcome still has decent weight
      const longHalfLife = calculateConfidenceFromHistory(outcomes, 60, now)

      expect(shortHalfLife.confidence).toBeGreaterThan(longHalfLife.confidence)
    })

    it('longer half-life preserves historical signal better', () => {
      // Many old good outcomes, one recent bad one
      const outcomes = [
        createOutcome('major_rewrite', 0, now),
        ...Array.from({ length: 10 }, (_, i) =>
          createOutcome('unchanged', 30 + i, now)
        ),
      ]

      const shortHalfLife = calculateConfidenceFromHistory(outcomes, 7, now)
      const longHalfLife = calculateConfidenceFromHistory(outcomes, 90, now)

      // Longer half-life should value the historical good outcomes more
      expect(longHalfLife.confidence).toBeGreaterThan(shortHalfLife.confidence)
    })
  })

  describe('effective samples', () => {
    const now = new Date('2024-01-15T12:00:00Z')

    it('effective samples equals sample count for all-recent outcomes', () => {
      const outcomes = Array.from({ length: 10 }, () =>
        createOutcome('unchanged', 0, now)
      )

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      // All outcomes have weight 1.0, so effectiveSamples ≈ 10
      expect(result.effectiveSamples).toBeCloseTo(10, 1)
    })

    it('effective samples decreases for old outcomes', () => {
      // 10 outcomes, all 60 days old (2 half-lives)
      const outcomes = Array.from({ length: 10 }, () =>
        createOutcome('unchanged', 60, now)
      )

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      // Each has weight e^-2 ≈ 0.135, so effectiveSamples ≈ 1.35
      expect(result.effectiveSamples).toBeLessThan(2)
    })
  })

  describe('edge cases', () => {
    const now = new Date('2024-01-15T12:00:00Z')

    it('handles outcomes from the future gracefully', () => {
      // Future outcome (negative age) - should still work, weight > 1
      const futureOutcome: OutcomeRecord = {
        outcome: 'unchanged',
        recordedAt: new Date(now.getTime() + MS_PER_DAY),
      }

      const result = calculateConfidenceFromHistory([futureOutcome], 30, now)

      // Weight will be e^(1/30) > 1, confidence still 1.0
      expect(result.confidence).toBe(1.0)
    })

    it('handles very old outcomes without overflow', () => {
      // 10 years old - weight should be essentially 0
      const veryOldOutcome: OutcomeRecord = {
        outcome: 'unchanged',
        recordedAt: new Date(now.getTime() - 365 * 10 * MS_PER_DAY),
      }

      const result = calculateConfidenceFromHistory([veryOldOutcome], 30, now)

      // Weight is tiny but non-zero
      expect(result.confidence).toBe(1.0) // Still unchanged
      expect(result.totalWeight).toBeGreaterThan(0)
      expect(result.totalWeight).toBeLessThan(0.0001)
    })

    it('handles large number of outcomes', () => {
      const outcomes = Array.from({ length: 1000 }, (_, i) =>
        createOutcome(i % 2 === 0 ? 'unchanged' : 'minor_edit', i, now)
      )

      const result = calculateConfidenceFromHistory(outcomes, 30, now)

      // Should complete without error
      expect(result.sampleCount).toBe(1000)
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.confidence).toBeLessThan(1)
    })
  })
})

describe('confidence threshold constants', () => {
  it('has correct auto-send thresholds', () => {
    expect(CONFIDENCE_THRESHOLDS.MIN_CONFIDENCE).toBe(0.9)
    expect(CONFIDENCE_THRESHOLDS.MIN_SAMPLES).toBe(20)
  })
})
