import { getRedis } from '../redis/client'

/**
 * Hold information for a conversation
 */
export interface HoldInfo {
  conversationId: string
  until: Date
  reason: string
  createdAt: Date
}

/**
 * Internal representation stored in Redis
 */
interface StoredHoldInfo {
  conversationId: string
  until: number // Unix timestamp ms
  reason: string
  createdAt: number // Unix timestamp ms
}

/**
 * Get the Redis key for a conversation's hold state
 */
function getHoldKey(conversationId: string): string {
  return `hold:${conversationId}`
}

/**
 * Set a hold on a conversation until a specific time.
 * The hold will automatically expire at the specified time via Redis TTL.
 *
 * @param conversationId - The conversation to hold
 * @param until - When the hold should expire
 * @param reason - Why the conversation is being held
 */
export async function setHold(
  conversationId: string,
  until: Date,
  reason: string
): Promise<void> {
  const redis = getRedis()
  const key = getHoldKey(conversationId)

  const now = Date.now()
  const ttlMs = until.getTime() - now

  if (ttlMs <= 0) {
    // Hold time is in the past, don't set it
    return
  }

  const holdInfo: StoredHoldInfo = {
    conversationId,
    until: until.getTime(),
    reason,
    createdAt: now,
  }

  // Set with TTL in seconds (rounded up to ensure we don't expire early)
  const ttlSeconds = Math.ceil(ttlMs / 1000)
  await redis.set(key, JSON.stringify(holdInfo), { ex: ttlSeconds })
}

/**
 * Clear a hold on a conversation.
 *
 * @param conversationId - The conversation to release
 */
export async function clearHold(conversationId: string): Promise<void> {
  const redis = getRedis()
  const key = getHoldKey(conversationId)
  await redis.del(key)
}

/**
 * Check if a conversation is currently on hold.
 *
 * @param conversationId - The conversation to check
 * @returns true if the conversation is on hold, false otherwise
 */
export async function isOnHold(conversationId: string): Promise<boolean> {
  const redis = getRedis()
  const key = getHoldKey(conversationId)
  const exists = await redis.exists(key)
  return exists === 1
}

/**
 * Get full hold information for a conversation.
 *
 * @param conversationId - The conversation to get info for
 * @returns The hold info if the conversation is on hold, null otherwise
 */
export async function getHoldInfo(
  conversationId: string
): Promise<HoldInfo | null> {
  const redis = getRedis()
  const key = getHoldKey(conversationId)
  const data = await redis.get<string>(key)

  if (!data) {
    return null
  }

  // Handle both string and already-parsed object (Upstash auto-parses JSON)
  const stored: StoredHoldInfo =
    typeof data === 'string' ? JSON.parse(data) : data

  return {
    conversationId: stored.conversationId,
    until: new Date(stored.until),
    reason: stored.reason,
    createdAt: new Date(stored.createdAt),
  }
}
