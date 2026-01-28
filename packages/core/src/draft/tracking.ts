/**
 * Draft Tracking Functions
 *
 * Utilities for embedding action IDs in Front drafts and storing
 * tracking data in Redis for RL loop correlation.
 *
 * Flow:
 * 1. embedDraftId() - Add hidden marker to draft content before sending to Front
 * 2. storeDraftTracking() - Store metadata in Redis after draft creation
 * 3. extractDraftId() - Parse marker from sent email content (called by outbound webhook)
 * 4. getDraftTracking() - Retrieve metadata for RL signal processing
 */

import { getRedis } from '../redis/client'
import {
  DRAFT_ID_MARKER_PREFIX,
  DRAFT_ID_MARKER_SUFFIX,
  type DraftTrackingData,
} from './types'

/** Redis key prefix for draft tracking */
const DRAFT_TRACKING_KEY_PREFIX = 'draft:tracking:'

/** TTL for draft tracking data (48 hours in seconds) */
const DRAFT_TRACKING_TTL_SECONDS = 48 * 60 * 60

/**
 * Embed action ID in draft content as an invisible HTML comment.
 *
 * The marker is appended to the end of the content and will be
 * invisible when the email is rendered but preserved in the raw HTML.
 *
 * @param content - Original draft content (HTML)
 * @param actionId - Action ID to embed
 * @returns Content with embedded action ID marker
 */
export function embedDraftId(content: string, actionId: string): string {
  return `${content}${DRAFT_ID_MARKER_PREFIX}${actionId}${DRAFT_ID_MARKER_SUFFIX}`
}

/**
 * Extract action ID from content containing the hidden marker.
 *
 * Used by the outbound webhook handler to correlate sent emails
 * back to their originating actions.
 *
 * @param content - Email content (HTML) that may contain marker
 * @returns Action ID if found, null otherwise
 */
export function extractDraftId(content: string): string | null {
  if (!content) return null

  const prefixIndex = content.indexOf(DRAFT_ID_MARKER_PREFIX)
  if (prefixIndex === -1) return null

  const startIndex = prefixIndex + DRAFT_ID_MARKER_PREFIX.length
  const endIndex = content.indexOf(DRAFT_ID_MARKER_SUFFIX, startIndex)
  if (endIndex === -1) return null

  const actionId = content.substring(startIndex, endIndex).trim()
  return actionId || null
}

/**
 * Store draft tracking data in Redis with TTL.
 *
 * Data is stored as a JSON blob with 48-hour expiry. This gives
 * sufficient time for the email to be sent and feedback collected,
 * while not accumulating stale data indefinitely.
 *
 * @param actionId - Action ID (used as key)
 * @param data - Tracking metadata to store
 */
export async function storeDraftTracking(
  actionId: string,
  data: DraftTrackingData
): Promise<void> {
  const redis = getRedis()
  const key = `${DRAFT_TRACKING_KEY_PREFIX}${actionId}`

  await redis.set(key, JSON.stringify(data), { ex: DRAFT_TRACKING_TTL_SECONDS })
}

/**
 * Retrieve draft tracking data from Redis.
 *
 * @param actionId - Action ID to look up
 * @returns Tracking data if found, null otherwise
 */
export async function getDraftTracking(
  actionId: string
): Promise<DraftTrackingData | null> {
  const redis = getRedis()
  const key = `${DRAFT_TRACKING_KEY_PREFIX}${actionId}`

  const data = await redis.get<string>(key)
  if (!data) return null

  try {
    // Redis client may return parsed object or string depending on config
    if (typeof data === 'object') {
      return data as unknown as DraftTrackingData
    }
    return JSON.parse(data) as DraftTrackingData
  } catch {
    return null
  }
}

/**
 * Remove draft tracking data from Redis.
 * Used for cleanup after RL processing or testing.
 *
 * @param actionId - Action ID to remove
 */
export async function removeDraftTracking(actionId: string): Promise<void> {
  const redis = getRedis()
  const key = `${DRAFT_TRACKING_KEY_PREFIX}${actionId}`
  await redis.del(key)
}
