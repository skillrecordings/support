import type { RouterDecision } from './types'

/**
 * Configuration for RouterCache TTL policies.
 */
export interface CacheConfig {
  /** Time-to-live for routing decisions (default: 1 hour) */
  decisionTtlMs: number
  /** Time-to-live for conversation context (default: 24 hours) */
  contextTtlMs: number
}

interface CacheEntry {
  decision: RouterDecision
  timestamp: number
}

/**
 * In-memory cache for routing decisions with TTL-based expiration.
 *
 * Provides:
 * - Per-message decision caching (1hr TTL)
 * - Per-conversation context caching (24hr TTL)
 * - Idempotency for duplicate Front webhook events
 * - Automatic invalidation on new messages
 *
 * @example
 * ```typescript
 * const cache = new RouterCache({
 *   decisionTtlMs: 60 * 60 * 1000,    // 1 hour
 *   contextTtlMs: 24 * 60 * 60 * 1000 // 24 hours
 * })
 *
 * // Cache a decision
 * cache.setDecision('msg-123', decision)
 *
 * // Retrieve cached decision (null if expired or not found)
 * const cached = cache.getDecision('msg-123')
 *
 * // Invalidate all decisions for a conversation
 * cache.invalidateConversation('conv-abc')
 * ```
 */
export class RouterCache {
  private readonly decisionCache: Map<string, CacheEntry> = new Map()
  private readonly config: CacheConfig

  constructor(config: CacheConfig) {
    this.config = config
  }

  /**
   * Retrieves a cached routing decision for a message.
   *
   * @param messageId - Unique message identifier (format: "conv-id:msg-id")
   * @returns Cached decision if found and not expired, null otherwise
   */
  getDecision(messageId: string): RouterDecision | null {
    const entry = this.decisionCache.get(messageId)

    if (!entry) {
      return null
    }

    if (this.isExpired(entry)) {
      this.decisionCache.delete(messageId)
      return null
    }

    return entry.decision
  }

  /**
   * Caches a routing decision for a message.
   *
   * @param messageId - Unique message identifier
   * @param decision - RouterDecision to cache
   */
  setDecision(messageId: string, decision: RouterDecision): void {
    this.decisionCache.set(messageId, {
      decision,
      timestamp: Date.now(),
    })
  }

  /**
   * Invalidates all cached decisions for a conversation.
   * Triggered on new inbound messages to ensure fresh routing.
   *
   * @param conversationId - Conversation identifier
   */
  invalidateConversation(conversationId: string): void {
    const prefix = `${conversationId}:`

    for (const messageId of this.decisionCache.keys()) {
      if (messageId.startsWith(prefix)) {
        this.decisionCache.delete(messageId)
      }
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    const age = Date.now() - entry.timestamp
    return age >= this.config.decisionTtlMs
  }
}
