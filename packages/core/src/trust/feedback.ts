/**
 * Trust score feedback loop for recording approval/rejection outcomes
 */

import { getTrustScore, upsertTrustScore } from './repository'
import { updateTrustScore } from './score'

/**
 * Record an approval/rejection outcome and update trust score
 *
 * Uses exponential moving average (EMA) to update the trust score:
 * - Fetches current trust score from database
 * - Applies EMA calculation via updateTrustScore()
 * - Persists updated score back to database
 *
 * If no trust score exists for the app/category pair, initializes with:
 * - Default score: 0.5
 * - Sample count: 0
 *
 * @param db - Drizzle database instance
 * @param appId - Application identifier
 * @param category - Message category
 * @param success - Whether the outcome was successful (approval = true, rejection = false)
 *
 * @example
 * // Record successful approval
 * await recordOutcome(db, 'total-typescript', 'refund-simple', true)
 *
 * @example
 * // Record rejection
 * await recordOutcome(db, 'total-typescript', 'refund-simple', false)
 */
export async function recordOutcome(
  db: any,
  appId: string,
  category: string,
  success: boolean
): Promise<void> {
  // Fetch current trust score (or default if none exists)
  const currentTrust = await getTrustScore(db, appId, category)
  const currentScore = currentTrust?.trustScore ?? 0.5
  const currentSampleCount = currentTrust?.sampleCount ?? 0

  // Calculate new score using EMA
  const updated = updateTrustScore(currentScore, currentSampleCount, success)

  // Persist updated score
  await upsertTrustScore(db, appId, category, updated)
}
