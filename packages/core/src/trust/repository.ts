/**
 * Trust score repository for persistent storage and retrieval
 */

import { TrustScoresTable } from '@skillrecordings/database'
import { and, eq } from 'drizzle-orm'
import { calculateTrustScore } from './score'
import { TRUST_THRESHOLDS, type TrustScore } from './types'

/**
 * Database record from TrustScoresTable (snake_case from MySQL)
 */
interface TrustScoreRecord {
  id: string
  app_id: string
  category: string
  trust_score: number
  sample_count: number
  decay_half_life_days: number | null
  last_updated_at: Date
  created_at: Date
}

/**
 * Get trust score for an app/category pair with decay applied
 *
 * @param db - Drizzle database instance
 * @param appId - Application identifier
 * @param category - Message category
 * @returns Trust score with decay applied, or null if not found
 *
 * @example
 * const trust = await getTrustScore(db, 'total-typescript', 'refund-simple')
 * if (trust && trust.trustScore > 0.85) { ... }
 */
export async function getTrustScore(
  db: any,
  appId: string,
  category: string
): Promise<TrustScore | null> {
  const results = await db
    .select()
    .from(TrustScoresTable)
    .where(
      and(
        eq(TrustScoresTable.app_id, appId),
        eq(TrustScoresTable.category, category)
      )
    )

  if (results.length === 0) {
    return null
  }

  const record: TrustScoreRecord = results[0]

  // Apply exponential decay using existing calculateTrustScore
  const halfLifeDays =
    record.decay_half_life_days ?? TRUST_THRESHOLDS.DEFAULT_HALF_LIFE_DAYS
  const decayedScore = calculateTrustScore(
    record.trust_score,
    record.last_updated_at,
    halfLifeDays
  )

  return {
    appId: record.app_id,
    category: record.category,
    trustScore: decayedScore,
    sampleCount: record.sample_count,
    lastUpdatedAt: record.last_updated_at,
    decayHalfLifeDays: halfLifeDays,
  }
}

/**
 * Insert or update trust score for an app/category pair
 *
 * Uses MySQL ON DUPLICATE KEY UPDATE for atomic upsert.
 * Composite unique constraint on (app_id, category) prevents duplicates.
 *
 * @param db - Drizzle database instance
 * @param appId - Application identifier
 * @param category - Message category
 * @param update - New trust score and sample count
 *
 * @example
 * await upsertTrustScore(db, 'total-typescript', 'refund-simple', {
 *   trustScore: 0.92,
 *   sampleCount: 151
 * })
 */
export async function upsertTrustScore(
  db: any,
  appId: string,
  category: string,
  update: { trustScore: number; sampleCount: number }
): Promise<void> {
  const now = new Date()
  const id = `ts-${appId}-${category}-${Date.now()}`

  await db
    .insert(TrustScoresTable)
    .values({
      id,
      app_id: appId,
      category,
      trust_score: update.trustScore,
      sample_count: update.sampleCount,
      decay_half_life_days: TRUST_THRESHOLDS.DEFAULT_HALF_LIFE_DAYS,
      last_updated_at: now,
      created_at: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        trust_score: update.trustScore,
        sample_count: update.sampleCount,
        last_updated_at: now,
      },
    })
}
