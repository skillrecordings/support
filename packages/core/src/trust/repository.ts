/**
 * Trust score repository using Redis for storage
 */

import { getRedis } from '../redis/client'
import type { DraftOutcome } from '../rl/types'
import { calculateTrustScore } from './score'
import { TRUST_THRESHOLDS, type TrustScore } from './types'

/** Redis key pattern for trust scores */
const TRUST_KEY_PREFIX = 'trust'

/** Redis key pattern for outcome history */
const OUTCOME_HISTORY_PREFIX = 'outcome-history'

/** Maximum number of outcomes to store per category */
const MAX_OUTCOME_HISTORY = 200

/** Build Redis key for trust score */
function trustKey(appId: string, category: string): string {
  return `${TRUST_KEY_PREFIX}:${appId}:${category}`
}

/** Build Redis key for outcome history */
function outcomeHistoryKey(appId: string, category: string): string {
  return `${OUTCOME_HISTORY_PREFIX}:${appId}:${category}`
}

/** Stored trust score data in Redis */
interface StoredTrustScore {
  appId: string
  category: string
  trustScore: number
  sampleCount: number
  lastUpdatedAt: string // ISO string
  decayHalfLifeDays: number
}

/**
 * Get trust score for an app/category pair with decay applied
 *
 * @param appId - Application identifier
 * @param category - Message category
 * @returns Trust score with decay applied, or null if not found
 *
 * @example
 * const trust = await getTrustScore('total-typescript', 'refund-simple')
 * if (trust && trust.trustScore > 0.85) { ... }
 */
export async function getTrustScore(
  appId: string,
  category: string
): Promise<TrustScore | null>

/**
 * @deprecated Use the 2-argument version. The db parameter is ignored (using Redis now).
 */
export async function getTrustScore(
  db: unknown,
  appId: string,
  category: string
): Promise<TrustScore | null>

export async function getTrustScore(
  dbOrAppId: unknown,
  appIdOrCategory: string,
  categoryOrUndefined?: string
): Promise<TrustScore | null> {
  // Handle both old (db, appId, category) and new (appId, category) signatures
  const appId =
    categoryOrUndefined !== undefined
      ? (appIdOrCategory as string)
      : (dbOrAppId as string)
  const category = categoryOrUndefined ?? appIdOrCategory

  const redis = getRedis()
  const key = trustKey(appId, category)

  const stored = await redis.get<StoredTrustScore>(key)
  if (!stored) {
    return null
  }

  // Apply exponential decay
  const lastUpdatedAt = new Date(stored.lastUpdatedAt)
  const halfLifeDays =
    stored.decayHalfLifeDays ?? TRUST_THRESHOLDS.DEFAULT_HALF_LIFE_DAYS
  const decayedScore = calculateTrustScore(
    stored.trustScore,
    lastUpdatedAt,
    halfLifeDays
  )

  return {
    appId: stored.appId,
    category: stored.category,
    trustScore: decayedScore,
    sampleCount: stored.sampleCount,
    lastUpdatedAt,
    decayHalfLifeDays: halfLifeDays,
  }
}

/**
 * Insert or update trust score for an app/category pair
 *
 * @param appId - Application identifier
 * @param category - Message category
 * @param update - New trust score and sample count
 *
 * @example
 * await upsertTrustScore('total-typescript', 'refund-simple', {
 *   trustScore: 0.92,
 *   sampleCount: 151
 * })
 */
export async function upsertTrustScore(
  appId: string,
  category: string,
  update: { trustScore: number; sampleCount: number }
): Promise<void>

/**
 * @deprecated Use the 3-argument version. The db parameter is ignored (using Redis now).
 */
export async function upsertTrustScore(
  db: unknown,
  appId: string,
  category: string,
  update: { trustScore: number; sampleCount: number }
): Promise<void>

export async function upsertTrustScore(
  dbOrAppId: unknown,
  appIdOrCategory: string,
  categoryOrUpdate: string | { trustScore: number; sampleCount: number },
  updateOrUndefined?: { trustScore: number; sampleCount: number }
): Promise<void> {
  // Handle both old (db, appId, category, update) and new (appId, category, update) signatures
  let appId: string
  let category: string
  let update: { trustScore: number; sampleCount: number }

  if (updateOrUndefined !== undefined) {
    // Old signature: (db, appId, category, update)
    appId = appIdOrCategory
    category = categoryOrUpdate as string
    update = updateOrUndefined
  } else {
    // New signature: (appId, category, update)
    appId = dbOrAppId as string
    category = appIdOrCategory
    update = categoryOrUpdate as { trustScore: number; sampleCount: number }
  }

  const redis = getRedis()
  const key = trustKey(appId, category)

  const stored: StoredTrustScore = {
    appId,
    category,
    trustScore: update.trustScore,
    sampleCount: update.sampleCount,
    lastUpdatedAt: new Date().toISOString(),
    decayHalfLifeDays: TRUST_THRESHOLDS.DEFAULT_HALF_LIFE_DAYS,
  }

  await redis.set(key, stored)
}

/**
 * Delete trust score for an app/category pair
 *
 * @param appId - Application identifier
 * @param category - Message category
 */
export async function deleteTrustScore(
  appId: string,
  category: string
): Promise<void> {
  const redis = getRedis()
  const key = trustKey(appId, category)
  await redis.del(key)
}

/**
 * List all trust scores for an app
 *
 * @param appId - Application identifier
 * @returns Array of trust scores for all categories
 */
export async function listTrustScores(appId: string): Promise<TrustScore[]> {
  const redis = getRedis()
  const pattern = `${TRUST_KEY_PREFIX}:${appId}:*`

  // Scan for matching keys
  const keys: string[] = []
  let cursor = 0
  do {
    const result = await redis.scan(cursor, {
      match: pattern,
      count: 100,
    })
    cursor = Number(result[0])
    keys.push(...result[1])
  } while (cursor !== 0)

  if (keys.length === 0) {
    return []
  }

  // Fetch all values
  const values = await redis.mget<StoredTrustScore[]>(...keys)

  return values
    .filter((v): v is StoredTrustScore => v !== null)
    .map((stored) => {
      const lastUpdatedAt = new Date(stored.lastUpdatedAt)
      const halfLifeDays =
        stored.decayHalfLifeDays ?? TRUST_THRESHOLDS.DEFAULT_HALF_LIFE_DAYS
      const decayedScore = calculateTrustScore(
        stored.trustScore,
        lastUpdatedAt,
        halfLifeDays
      )

      return {
        appId: stored.appId,
        category: stored.category,
        trustScore: decayedScore,
        sampleCount: stored.sampleCount,
        lastUpdatedAt,
        decayHalfLifeDays: halfLifeDays,
      }
    })
}

// =============================================================================
// Outcome History Storage (for confidence calculation)
// =============================================================================

/**
 * Outcome record with timestamp for confidence calculation.
 */
export interface OutcomeRecord {
  /** Draft outcome type */
  outcome: DraftOutcome
  /** When the outcome was recorded */
  recordedAt: Date
  /** Optional: original similarity score */
  similarity?: number
}

/** Stored outcome record in Redis (ISO strings for dates) */
interface StoredOutcomeRecord {
  outcome: DraftOutcome
  recordedAt: string
  similarity?: number
}

/**
 * Record a draft outcome for confidence tracking.
 *
 * Stores outcome in a list, trimmed to MAX_OUTCOME_HISTORY entries.
 * Uses Redis list with LPUSH + LTRIM for efficient storage.
 *
 * @param appId - Application identifier
 * @param category - Message category
 * @param outcome - Draft outcome type
 * @param similarity - Optional similarity score
 *
 * @example
 * await recordOutcomeHistory('total-typescript', 'refund-simple', 'unchanged', 0.98)
 */
export async function recordOutcomeHistory(
  appId: string,
  category: string,
  outcome: DraftOutcome,
  similarity?: number
): Promise<void> {
  // Don't record no_draft - it's not a learning signal
  if (outcome === 'no_draft') {
    return
  }

  const redis = getRedis()
  const key = outcomeHistoryKey(appId, category)

  const record: StoredOutcomeRecord = {
    outcome,
    recordedAt: new Date().toISOString(),
    similarity,
  }

  // LPUSH adds to front, LTRIM keeps list bounded
  await redis.lpush(key, JSON.stringify(record))
  await redis.ltrim(key, 0, MAX_OUTCOME_HISTORY - 1)
}

/**
 * Get outcome history for an app/category pair.
 *
 * Returns outcomes sorted newest-first (as stored).
 *
 * @param appId - Application identifier
 * @param category - Message category
 * @param limit - Optional limit on results (default: all)
 * @returns Array of outcome records
 *
 * @example
 * const history = await getOutcomeHistory('total-typescript', 'refund-simple')
 * console.log(`${history.length} outcomes recorded`)
 */
export async function getOutcomeHistory(
  appId: string,
  category: string,
  limit?: number
): Promise<OutcomeRecord[]> {
  const redis = getRedis()
  const key = outcomeHistoryKey(appId, category)

  const end = limit ? limit - 1 : -1
  const stored = await redis.lrange(key, 0, end)

  return stored.map((item) => {
    // Redis returns strings, need to parse
    const parsed: StoredOutcomeRecord =
      typeof item === 'string' ? JSON.parse(item) : item
    return {
      outcome: parsed.outcome,
      recordedAt: new Date(parsed.recordedAt),
      similarity: parsed.similarity,
    }
  })
}

/**
 * Delete outcome history for an app/category pair.
 *
 * @param appId - Application identifier
 * @param category - Message category
 */
export async function deleteOutcomeHistory(
  appId: string,
  category: string
): Promise<void> {
  const redis = getRedis()
  const key = outcomeHistoryKey(appId, category)
  await redis.del(key)
}

/**
 * Get count of recorded outcomes for an app/category pair.
 *
 * @param appId - Application identifier
 * @param category - Message category
 * @returns Number of outcomes recorded
 */
export async function getOutcomeHistoryCount(
  appId: string,
  category: string
): Promise<number> {
  const redis = getRedis()
  const key = outcomeHistoryKey(appId, category)
  return redis.llen(key)
}
