/**
 * Trust scoring functions for auto-send decision making
 */

import {
  NEVER_AUTO_SEND_CATEGORIES,
  TRUST_THRESHOLDS,
  type TrustScoreUpdate,
} from './types'

/**
 * Calculate decayed trust score using exponential decay
 *
 * @param baseScore - Original trust score (0-1)
 * @param lastUpdatedAt - When the score was last updated
 * @param halfLifeDays - Number of days for score to decay to 50%
 * @returns Decayed trust score (0-1)
 *
 * @example
 * // Score decays to 0.45 after 30 days with 30-day half-life
 * calculateTrustScore(0.9, thirtyDaysAgo, 30) // ~0.45
 */
export function calculateTrustScore(
  baseScore: number,
  lastUpdatedAt: Date,
  halfLifeDays: number = TRUST_THRESHOLDS.DEFAULT_HALF_LIFE_DAYS
): number {
  const daysSinceUpdate =
    (Date.now() - lastUpdatedAt.getTime()) / (1000 * 60 * 60 * 24)
  const decayFactor = Math.pow(0.5, daysSinceUpdate / halfLifeDays)
  return baseScore * decayFactor
}

/**
 * Update trust score using exponential moving average
 *
 * Uses EMA to smooth score updates:
 * - alpha = 1 / (sampleCount + 1)
 * - newScore = oldScore + alpha * (outcome - oldScore)
 *
 * @param currentScore - Current trust score (0-1)
 * @param sampleCount - Number of samples so far
 * @param success - Whether this sample was successful
 * @returns Updated score and sample count
 *
 * @example
 * // Update score after successful response
 * updateTrustScore(0.8, 100, true) // { trustScore: 0.802, sampleCount: 101 }
 */
export function updateTrustScore(
  currentScore: number,
  sampleCount: number,
  success: boolean
): TrustScoreUpdate {
  const outcome = success ? 1.0 : 0.0
  const newSampleCount = sampleCount + 1
  const alpha = 1 / newSampleCount
  const newScore = currentScore + alpha * (outcome - currentScore)

  return {
    trustScore: Math.max(0, Math.min(1, newScore)),
    sampleCount: newSampleCount,
  }
}

/**
 * Determine if an agent response should be auto-sent
 *
 * Checks:
 * 1. Category is not in never-auto-send list
 * 2. Sample count meets minimum threshold
 * 3. Trust score exceeds threshold
 * 4. Confidence score exceeds threshold
 *
 * @param category - Message category
 * @param trustScore - Trust score for this category (0-1)
 * @param confidence - Classifier confidence for this category (0-1)
 * @param sampleCount - Number of samples in trust score
 * @returns Whether to auto-send
 *
 * @example
 * shouldAutoSend('refund-simple', 0.86, 0.91, 50) // true
 * shouldAutoSend('angry-customer', 0.95, 0.95, 100) // false
 */
export function shouldAutoSend(
  category: string,
  trustScore: number,
  confidence: number,
  sampleCount: number
): boolean {
  // Never auto-send for specific categories
  if (NEVER_AUTO_SEND_CATEGORIES.includes(category as any)) {
    return false
  }

  // Require minimum samples
  if (sampleCount < TRUST_THRESHOLDS.MIN_SAMPLES) {
    return false
  }

  // Both trust and confidence must exceed thresholds
  return (
    trustScore > TRUST_THRESHOLDS.TRUST_SCORE &&
    confidence > TRUST_THRESHOLDS.CONFIDENCE
  )
}
