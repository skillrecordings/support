import { describe, expect, it } from 'vitest'
import { calculateTrustScore, shouldAutoSend, updateTrustScore } from './score'

describe('calculateTrustScore', () => {
  it('returns base score when no time has passed', () => {
    const baseScore = 0.9
    const now = new Date()
    const result = calculateTrustScore(baseScore, now, 30)
    expect(result).toBeCloseTo(0.9, 5)
  })

  it('applies exponential decay over time', () => {
    const baseScore = 0.9
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const result = calculateTrustScore(baseScore, thirtyDaysAgo, 30)
    // After 30 days (1 half-life), score should be 0.45
    expect(result).toBeCloseTo(0.45, 2)
  })

  it('applies multiple half-lives correctly', () => {
    const baseScore = 0.8
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const result = calculateTrustScore(baseScore, sixtyDaysAgo, 30)
    // After 60 days (2 half-lives), score should be 0.2
    expect(result).toBeCloseTo(0.2, 2)
  })

  it('respects custom half-life', () => {
    const baseScore = 0.9
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    const result = calculateTrustScore(baseScore, tenDaysAgo, 10)
    // After 10 days with 10-day half-life, score should be 0.45
    expect(result).toBeCloseTo(0.45, 2)
  })
})

describe('shouldAutoSend', () => {
  it('returns false for angry-customer category', () => {
    expect(shouldAutoSend('angry-customer', 0.95, 0.95, 100)).toBe(false)
  })

  it('returns false for legal category', () => {
    expect(shouldAutoSend('legal', 0.95, 0.95, 100)).toBe(false)
  })

  it('returns false for team-license category', () => {
    expect(shouldAutoSend('team-license', 0.95, 0.95, 100)).toBe(false)
  })

  it('returns false for other category', () => {
    expect(shouldAutoSend('other', 0.95, 0.95, 100)).toBe(false)
  })

  it('returns false when trust score is below threshold', () => {
    expect(shouldAutoSend('refund-simple', 0.84, 0.95, 100)).toBe(false)
  })

  it('returns false when confidence is below threshold', () => {
    expect(shouldAutoSend('refund-simple', 0.9, 0.89, 100)).toBe(false)
  })

  it('returns false when sample count is below minimum', () => {
    expect(shouldAutoSend('refund-simple', 0.9, 0.95, 49)).toBe(false)
  })

  it('returns true when all conditions are met', () => {
    expect(shouldAutoSend('refund-simple', 0.86, 0.91, 50)).toBe(true)
  })

  it('handles edge case at exact thresholds', () => {
    expect(shouldAutoSend('refund-simple', 0.85, 0.9, 50)).toBe(false)
    expect(shouldAutoSend('refund-simple', 0.851, 0.901, 50)).toBe(true)
  })
})

describe('updateTrustScore', () => {
  it('increases score on success', () => {
    const result = updateTrustScore(0.8, 100, true)
    expect(result.trustScore).toBeGreaterThan(0.8)
    expect(result.sampleCount).toBe(101)
  })

  it('decreases score on failure', () => {
    const result = updateTrustScore(0.8, 100, false)
    expect(result.trustScore).toBeLessThan(0.8)
    expect(result.sampleCount).toBe(101)
  })

  it('caps score at 1.0', () => {
    const result = updateTrustScore(0.95, 100, true)
    expect(result.trustScore).toBeLessThanOrEqual(1.0)
  })

  it('floors score at 0.0', () => {
    const result = updateTrustScore(0.05, 100, false)
    expect(result.trustScore).toBeGreaterThanOrEqual(0.0)
  })

  it('handles first sample correctly', () => {
    const result = updateTrustScore(0.5, 0, true)
    expect(result.sampleCount).toBe(1)
    expect(result.trustScore).toBeGreaterThan(0.5)
  })

  it('uses exponential moving average', () => {
    // Starting score 0.8 with 100 samples
    // Success should move toward 1.0 but smoothly
    const result = updateTrustScore(0.8, 100, true)
    // EMA with alpha ~0.01 (1/(100+1))
    // New score ≈ 0.8 + 0.01 * (1.0 - 0.8) = 0.802
    expect(result.trustScore).toBeCloseTo(0.802, 2)
  })
})
