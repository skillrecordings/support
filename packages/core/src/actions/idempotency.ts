import { createHash } from 'crypto'
import {
  IdempotencyKeysTable,
  eq,
  getDb,
  and,
  gt,
  lt,
} from '@skillrecordings/database'
import { log } from '../observability/axiom'

/**
 * Default TTL for idempotency keys: 24 hours
 * After this time, a duplicate operation will be allowed to execute again
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Result of an idempotency check
 */
export interface IdempotencyCheckResult {
  /** Whether this is a duplicate operation */
  isDuplicate: boolean
  /** The idempotency key used */
  key: string
  /** If duplicate, the cached result from the previous execution */
  cachedResult?: {
    result?: Record<string, unknown>
    error?: string
  }
  /** Status of the previous execution (if duplicate) */
  status?: 'pending' | 'completed' | 'failed'
}

/**
 * Options for generating an idempotency key
 */
export interface IdempotencyKeyOptions {
  conversationId: string
  toolName: string
  args: Record<string, unknown>
  actionId?: string
  ttlMs?: number
}

/**
 * Generate a deterministic idempotency key from operation parameters
 *
 * Key format: {conversationId}:{toolName}:{argsHash}
 * The args are sorted to ensure consistent hashing regardless of property order
 */
export function generateIdempotencyKey(
  conversationId: string,
  toolName: string,
  args: Record<string, unknown>
): string {
  // Sort args for consistent hashing
  const sortedArgs = JSON.stringify(args, Object.keys(args).sort())
  const argsHash = createHash('sha256').update(sortedArgs).digest('hex').slice(0, 16)

  return `${conversationId}:${toolName}:${argsHash}`
}

/**
 * Check if an operation has already been executed (idempotency check)
 *
 * This function attempts to insert an idempotency key atomically.
 * If the key already exists and hasn't expired, it returns the cached result.
 *
 * @returns IdempotencyCheckResult indicating whether this is a duplicate
 */
export async function checkIdempotency(
  options: IdempotencyKeyOptions
): Promise<IdempotencyCheckResult> {
  const { conversationId, toolName, args, actionId, ttlMs = DEFAULT_TTL_MS } = options
  const key = generateIdempotencyKey(conversationId, toolName, args)

  await log('debug', 'idempotency check', {
    key,
    conversationId,
    toolName,
    actionId,
  })

  const db = getDb()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlMs)

  // Check for existing non-expired key (expires_at > now means not expired)
  const [existing] = await db
    .select()
    .from(IdempotencyKeysTable)
    .where(
      and(
        eq(IdempotencyKeysTable.id, key),
        gt(IdempotencyKeysTable.expires_at, now)
      )
    )

  if (existing) {
    await log('info', 'idempotency key exists - duplicate operation', {
      key,
      conversationId,
      toolName,
      actionId,
      existingActionId: existing.action_id,
      status: existing.status,
    })

    return {
      isDuplicate: true,
      key,
      cachedResult: {
        result: existing.result ?? undefined,
        error: existing.error ?? undefined,
      },
      status: existing.status as 'pending' | 'completed' | 'failed',
    }
  }

  // Try to insert new key (atomic operation)
  try {
    await db.insert(IdempotencyKeysTable).values({
      id: key,
      conversation_id: conversationId,
      tool_name: toolName,
      action_id: actionId,
      status: 'pending',
      expires_at: expiresAt,
    })

    await log('debug', 'idempotency key created', {
      key,
      conversationId,
      toolName,
      actionId,
      expiresAt: expiresAt.toISOString(),
    })

    return {
      isDuplicate: false,
      key,
    }
  } catch (error) {
    // If insert fails due to duplicate key (race condition), treat as duplicate
    if (error instanceof Error && error.message.includes('Duplicate entry')) {
      await log('warn', 'idempotency race condition - treating as duplicate', {
        key,
        conversationId,
        toolName,
        actionId,
        error: error.message,
      })

      // Fetch the existing record
      const [existing] = await db
        .select()
        .from(IdempotencyKeysTable)
        .where(eq(IdempotencyKeysTable.id, key))

      return {
        isDuplicate: true,
        key,
        cachedResult: existing
          ? {
              result: existing.result ?? undefined,
              error: existing.error ?? undefined,
            }
          : undefined,
        status: existing?.status as 'pending' | 'completed' | 'failed' | undefined,
      }
    }

    // For other errors, log and allow execution (fail-open)
    await log('error', 'idempotency check failed - allowing execution', {
      key,
      conversationId,
      toolName,
      actionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return {
      isDuplicate: false,
      key,
    }
  }
}

/**
 * Mark an idempotency key as completed with its result
 *
 * Call this after successful tool execution to cache the result
 */
export async function completeIdempotencyKey(
  key: string,
  result: Record<string, unknown>
): Promise<void> {
  const db = getDb()

  await db
    .update(IdempotencyKeysTable)
    .set({
      status: 'completed',
      result,
      completed_at: new Date(),
    })
    .where(eq(IdempotencyKeysTable.id, key))

  await log('debug', 'idempotency key completed', {
    key,
    resultKeys: Object.keys(result),
  })
}

/**
 * Mark an idempotency key as failed with error message
 *
 * Call this after failed tool execution to cache the error
 */
export async function failIdempotencyKey(
  key: string,
  error: string
): Promise<void> {
  const db = getDb()

  await db
    .update(IdempotencyKeysTable)
    .set({
      status: 'failed',
      error,
      completed_at: new Date(),
    })
    .where(eq(IdempotencyKeysTable.id, key))

  await log('debug', 'idempotency key failed', {
    key,
    error,
  })
}

/**
 * Clean up expired idempotency keys
 *
 * Should be run periodically (e.g., via cron) to prevent table bloat
 */
export async function cleanupExpiredKeys(): Promise<number> {
  const db = getDb()
  const now = new Date()

  // lt(expires_at, now) means expires_at < now, i.e., expired
  const expired = await db
    .select({ id: IdempotencyKeysTable.id })
    .from(IdempotencyKeysTable)
    .where(lt(IdempotencyKeysTable.expires_at, now))

  if (expired.length > 0) {
    await db
      .delete(IdempotencyKeysTable)
      .where(lt(IdempotencyKeysTable.expires_at, now))
  }

  if (expired.length > 0) {
    await log('info', 'cleaned up expired idempotency keys', {
      deletedCount: expired.length,
    })
  }

  return expired.length
}

/**
 * Wrapper function for executing a tool with idempotency protection
 *
 * Usage:
 * ```ts
 * const result = await withIdempotency(
 *   { conversationId, toolName: 'processRefund', args, actionId },
 *   async () => {
 *     // Execute the actual tool
 *     return await processRefund(args)
 *   }
 * )
 * ```
 */
export async function withIdempotency<T extends Record<string, unknown>>(
  options: IdempotencyKeyOptions,
  execute: () => Promise<T>
): Promise<{ result: T; wasCached: boolean }> {
  const check = await checkIdempotency(options)

  if (check.isDuplicate) {
    if (check.status === 'pending') {
      // Previous execution still in progress - wait a bit and check again
      await log('warn', 'idempotency key pending - execution in progress', {
        key: check.key,
        conversationId: options.conversationId,
        toolName: options.toolName,
      })
      // For pending operations, we should NOT execute again
      // Instead, return a special result indicating the operation is in progress
      throw new Error(`Operation ${check.key} is already in progress`)
    }

    if (check.status === 'failed' && check.cachedResult?.error) {
      // Re-throw the cached error
      throw new Error(check.cachedResult.error)
    }

    // Return cached result
    return {
      result: (check.cachedResult?.result ?? {}) as T,
      wasCached: true,
    }
  }

  // Execute the operation
  try {
    const result = await execute()
    await completeIdempotencyKey(check.key, result)
    return { result, wasCached: false }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await failIdempotencyKey(check.key, errorMessage)
    throw error
  }
}
