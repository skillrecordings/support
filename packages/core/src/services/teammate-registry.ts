/**
 * Teammate Registry Service
 *
 * Caches Front teammates for quick lookup during message processing.
 * Used to identify if a message is from an instructor vs customer.
 *
 * @see docs/prd-pipeline-v3-threads.md for full spec
 */

import {
  type Message as FrontMessage,
  type Teammate,
} from '@skillrecordings/front-sdk'
import { createInstrumentedFrontClient } from '../front/instrumented-client'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface MessageAuthorInfo {
  /** Who sent this message */
  type: 'customer' | 'teammate' | 'instructor'
  /** Email address */
  email: string
  /** Display name if available */
  name?: string
  /** Front teammate ID (only for teammates/instructors) */
  teammateId?: string
}

export interface TeammateRegistryConfig {
  /** Front API token */
  frontApiToken: string
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtlMs?: number
}

// -----------------------------------------------------------------------------
// Cache
// -----------------------------------------------------------------------------

interface CacheEntry {
  teammates: Map<string, Teammate> // email -> Teammate
  teammateIds: Set<string> // All teammate IDs
  expiresAt: number
}

let cache: CacheEntry | null = null

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

/**
 * Create a teammate registry instance.
 *
 * @example
 * ```ts
 * const registry = createTeammateRegistry({ frontApiToken: '...' })
 *
 * const author = await registry.getMessageAuthor(message, app)
 * if (author.type === 'instructor') {
 *   // Handle instructor message
 * }
 * ```
 */
export function createTeammateRegistry(config: TeammateRegistryConfig) {
  const front = createInstrumentedFrontClient({
    apiToken: config.frontApiToken,
  })
  const ttlMs = config.cacheTtlMs ?? DEFAULT_TTL_MS

  /**
   * Refresh the teammate cache if expired.
   */
  async function ensureCache(): Promise<CacheEntry> {
    if (cache && cache.expiresAt > Date.now()) {
      return cache
    }

    const response = await front.teammates.list()
    const teammates = new Map<string, Teammate>()
    const teammateIds = new Set<string>()

    for (const teammate of response._results) {
      teammates.set(teammate.email.toLowerCase(), teammate)
      teammateIds.add(teammate.id)
    }

    cache = {
      teammates,
      teammateIds,
      expiresAt: Date.now() + ttlMs,
    }

    return cache
  }

  return {
    /**
     * Check if an email belongs to a teammate.
     */
    async isTeammate(email: string): Promise<boolean> {
      const { teammates } = await ensureCache()
      return teammates.has(email.toLowerCase())
    },

    /**
     * Check if a teammate ID is the instructor for a given app.
     */
    async isInstructor(
      teammateId: string,
      instructorTeammateId: string | null | undefined
    ): Promise<boolean> {
      if (!instructorTeammateId) return false
      return teammateId === instructorTeammateId
    },

    /**
     * Get a teammate by email.
     */
    async getTeammateByEmail(email: string): Promise<Teammate | null> {
      const { teammates } = await ensureCache()
      return teammates.get(email.toLowerCase()) ?? null
    },

    /**
     * Determine who sent a Front message.
     *
     * @param message - The Front message
     * @param instructorTeammateId - The instructor's teammate ID for this app (from AppsTable)
     */
    async getMessageAuthor(
      message: FrontMessage,
      instructorTeammateId: string | null | undefined
    ): Promise<MessageAuthorInfo> {
      const { teammates } = await ensureCache()

      // OUTBOUND = sent by a teammate
      if (!message.is_inbound && message.author) {
        const isInstr = message.author.id === instructorTeammateId
        return {
          type: isInstr ? 'instructor' : 'teammate',
          email: message.author.email,
          name:
            [message.author.first_name, message.author.last_name]
              .filter(Boolean)
              .join(' ') || undefined,
          teammateId: message.author.id,
        }
      }

      // INBOUND = usually customer, but could be internal
      const fromRecipient = message.recipients?.find((r) => r.role === 'from')
      const email = fromRecipient?.handle || 'unknown'

      // Check if this "inbound" is from a teammate
      const teammate = teammates.get(email.toLowerCase())
      if (teammate) {
        const isInstr = teammate.id === instructorTeammateId
        return {
          type: isInstr ? 'instructor' : 'teammate',
          email,
          name: fromRecipient?.name ?? undefined,
          teammateId: teammate.id,
        }
      }

      return {
        type: 'customer',
        email,
        name: fromRecipient?.name ?? undefined,
      }
    },

    /**
     * List all cached teammates (for debugging).
     */
    async listTeammates(): Promise<Teammate[]> {
      const { teammates } = await ensureCache()
      return Array.from(teammates.values())
    },

    /**
     * Clear the cache (for testing).
     */
    clearCache(): void {
      cache = null
    },
  }
}

export type TeammateRegistry = ReturnType<typeof createTeammateRegistry>

// -----------------------------------------------------------------------------
// Singleton for common use
// -----------------------------------------------------------------------------

let defaultRegistry: TeammateRegistry | null = null

/**
 * Get the default teammate registry instance.
 * Initializes from FRONT_API_KEY env var if not already created.
 */
export function getTeammateRegistry(): TeammateRegistry {
  if (!defaultRegistry) {
    const token = process.env.FRONT_API_KEY
    if (!token) {
      throw new Error('FRONT_API_KEY environment variable required')
    }
    defaultRegistry = createTeammateRegistry({ frontApiToken: token })
  }
  return defaultRegistry
}

/**
 * Set a custom teammate registry (for testing).
 */
export function setTeammateRegistry(registry: TeammateRegistry | null): void {
  defaultRegistry = registry
}
