/**
 * FAQ Review Module
 *
 * Manages the review queue for FAQ candidates mined from conversations.
 * Supports approve/reject/edit workflows with persistence to Redis.
 *
 * @module faq/review
 */

import { storeKnowledgeArticle } from '../knowledge/search'
import { getRedis } from '../redis/client'
import type { FaqCandidate } from './types'

/**
 * Redis key patterns for FAQ candidates
 */
const FAQ_KEYS = {
  /** Prefix for all FAQ candidate data */
  PREFIX: 'faq:candidate:',
  /** Set of pending candidate IDs per app */
  PENDING_SET: (appId: string) => `faq:pending:${appId}`,
  /** Set of approved candidate IDs per app */
  APPROVED_SET: (appId: string) => `faq:approved:${appId}`,
  /** Set of rejected candidate IDs per app */
  REJECTED_SET: (appId: string) => `faq:rejected:${appId}`,
  /** Individual candidate data */
  CANDIDATE: (id: string) => `faq:candidate:${id}`,
} as const

/**
 * Candidate stored in Redis with additional tracking fields
 */
export interface StoredFaqCandidate extends FaqCandidate {
  /** App this candidate belongs to */
  appId: string
  /** When candidate was stored */
  storedAt: string
  /** When candidate was reviewed (if reviewed) */
  reviewedAt?: string
  /** Who reviewed (if tracked) */
  reviewedBy?: string
  /** Edit notes (if edited before approval) */
  editNotes?: string
}

/**
 * Stats for the review queue
 */
export interface ReviewQueueStats {
  /** Number of pending candidates */
  pending: number
  /** Number of approved candidates */
  approved: number
  /** Number of rejected candidates */
  rejected: number
  /** Total candidates */
  total: number
}

/**
 * Result of a review action
 */
export interface ReviewResult {
  success: boolean
  candidateId: string
  action: 'approved' | 'rejected' | 'skipped' | 'edited'
  /** Knowledge article ID if published */
  articleId?: string
  error?: string
}

/**
 * Save FAQ candidates to the review queue.
 *
 * @param candidates - Candidates from mining
 * @param appId - App these candidates belong to
 * @returns Number of candidates saved (skips duplicates)
 */
export async function saveCandidatesToQueue(
  candidates: FaqCandidate[],
  appId: string
): Promise<number> {
  const redis = getRedis()
  let saved = 0

  for (const candidate of candidates) {
    // Check if already exists
    const existing = await redis.exists(FAQ_KEYS.CANDIDATE(candidate.id))
    if (existing) {
      continue // Skip duplicates
    }

    const stored: StoredFaqCandidate = {
      ...candidate,
      appId,
      status: 'pending',
      storedAt: new Date().toISOString(),
    }

    // Store candidate data
    await redis.set(FAQ_KEYS.CANDIDATE(candidate.id), JSON.stringify(stored))

    // Add to pending set
    await redis.sadd(FAQ_KEYS.PENDING_SET(appId), candidate.id)

    saved++
  }

  return saved
}

/**
 * Get candidates in the pending review queue.
 *
 * @param appId - App to get candidates for
 * @param limit - Maximum number to return (default: 50)
 * @returns Array of pending candidates sorted by confidence (highest first)
 */
export async function getPendingCandidates(
  appId: string,
  limit = 50
): Promise<StoredFaqCandidate[]> {
  const redis = getRedis()

  // Get all pending IDs
  const pendingIds = await redis.smembers(FAQ_KEYS.PENDING_SET(appId))

  if (pendingIds.length === 0) {
    return []
  }

  // Fetch all candidate data
  const candidates: StoredFaqCandidate[] = []

  for (const id of pendingIds) {
    const data = await redis.get(FAQ_KEYS.CANDIDATE(id))
    if (data) {
      try {
        const candidate = JSON.parse(data as string) as StoredFaqCandidate
        candidates.push(candidate)
      } catch {
        // Skip malformed data
      }
    }
  }

  // Sort by confidence (highest first), then by cluster size
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence
    }
    return b.clusterSize - a.clusterSize
  })

  return candidates.slice(0, limit)
}

/**
 * Get a single candidate by ID.
 *
 * @param candidateId - Candidate ID
 * @returns The candidate or null if not found
 */
export async function getCandidate(
  candidateId: string
): Promise<StoredFaqCandidate | null> {
  const redis = getRedis()
  const data = await redis.get(FAQ_KEYS.CANDIDATE(candidateId))

  if (!data) {
    return null
  }

  try {
    return JSON.parse(data as string) as StoredFaqCandidate
  } catch {
    return null
  }
}

/**
 * Approve a candidate and publish to the knowledge base.
 *
 * @param candidateId - Candidate ID to approve
 * @param options - Optional customizations
 * @returns Review result with article ID if successful
 */
export async function approveCandidate(
  candidateId: string,
  options?: {
    /** Override the question */
    question?: string
    /** Override the answer */
    answer?: string
    /** Override the title */
    title?: string
    /** Edit notes */
    editNotes?: string
    /** Category override */
    category?: string
    /** Who is reviewing */
    reviewedBy?: string
  }
): Promise<ReviewResult> {
  const redis = getRedis()

  // Get candidate
  const candidate = await getCandidate(candidateId)
  if (!candidate) {
    return {
      success: false,
      candidateId,
      action: 'approved',
      error: 'Candidate not found',
    }
  }

  try {
    // Determine final values (with optional edits)
    const question = options?.question ?? candidate.question
    const answer = options?.answer ?? candidate.answer
    const title = options?.title ?? candidate.question.slice(0, 100)

    // Publish to knowledge base
    const article = await storeKnowledgeArticle({
      title,
      question,
      answer,
      appId: candidate.appId,
      source: 'faq',
      category: (options?.category ??
        candidate.suggestedCategory ??
        'general') as any,
      tags: candidate.tags,
      trust_score: candidate.confidence,
    })

    // Update candidate status
    const updated: StoredFaqCandidate = {
      ...candidate,
      question,
      answer,
      status: 'approved',
      reviewedAt: new Date().toISOString(),
      reviewedBy: options?.reviewedBy,
      editNotes: options?.editNotes,
    }
    await redis.set(FAQ_KEYS.CANDIDATE(candidateId), JSON.stringify(updated))

    // Move from pending to approved set
    await redis.srem(FAQ_KEYS.PENDING_SET(candidate.appId), candidateId)
    await redis.sadd(FAQ_KEYS.APPROVED_SET(candidate.appId), candidateId)

    return {
      success: true,
      candidateId,
      action: options?.question || options?.answer ? 'edited' : 'approved',
      articleId: article.id,
    }
  } catch (error) {
    return {
      success: false,
      candidateId,
      action: 'approved',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Reject a candidate.
 *
 * @param candidateId - Candidate ID to reject
 * @param reason - Optional rejection reason
 * @returns Review result
 */
export async function rejectCandidate(
  candidateId: string,
  reason?: string,
  reviewedBy?: string
): Promise<ReviewResult> {
  const redis = getRedis()

  // Get candidate
  const candidate = await getCandidate(candidateId)
  if (!candidate) {
    return {
      success: false,
      candidateId,
      action: 'rejected',
      error: 'Candidate not found',
    }
  }

  try {
    // Update candidate status
    const updated: StoredFaqCandidate = {
      ...candidate,
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
      reviewedBy,
      editNotes: reason,
    }
    await redis.set(FAQ_KEYS.CANDIDATE(candidateId), JSON.stringify(updated))

    // Move from pending to rejected set
    await redis.srem(FAQ_KEYS.PENDING_SET(candidate.appId), candidateId)
    await redis.sadd(FAQ_KEYS.REJECTED_SET(candidate.appId), candidateId)

    return {
      success: true,
      candidateId,
      action: 'rejected',
    }
  } catch (error) {
    return {
      success: false,
      candidateId,
      action: 'rejected',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get review queue statistics for an app.
 *
 * @param appId - App ID
 * @returns Queue stats
 */
export async function getQueueStats(appId: string): Promise<ReviewQueueStats> {
  const redis = getRedis()

  const [pending, approved, rejected] = await Promise.all([
    redis.scard(FAQ_KEYS.PENDING_SET(appId)),
    redis.scard(FAQ_KEYS.APPROVED_SET(appId)),
    redis.scard(FAQ_KEYS.REJECTED_SET(appId)),
  ])

  return {
    pending,
    approved,
    rejected,
    total: pending + approved + rejected,
  }
}

/**
 * Clear the entire queue for an app.
 * USE WITH CAUTION - primarily for testing.
 *
 * @param appId - App ID
 * @param status - Optional status to clear ('pending', 'approved', 'rejected', or all)
 * @returns Number of candidates cleared
 */
export async function clearQueue(
  appId: string,
  status?: 'pending' | 'approved' | 'rejected'
): Promise<number> {
  const redis = getRedis()
  let cleared = 0

  const statusSets = status
    ? [status]
    : (['pending', 'approved', 'rejected'] as const)

  for (const s of statusSets) {
    const setKey =
      s === 'pending'
        ? FAQ_KEYS.PENDING_SET(appId)
        : s === 'approved'
          ? FAQ_KEYS.APPROVED_SET(appId)
          : FAQ_KEYS.REJECTED_SET(appId)

    const ids = await redis.smembers(setKey)

    // Delete each candidate's data
    for (const id of ids) {
      await redis.del(FAQ_KEYS.CANDIDATE(id))
      cleared++
    }

    // Clear the set
    await redis.del(setKey)
  }

  return cleared
}
