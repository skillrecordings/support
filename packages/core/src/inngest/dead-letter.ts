import { randomUUID } from 'crypto'
import {
  DeadLetterQueueTable,
  desc,
  eq,
  getDb,
} from '@skillrecordings/database'

import { initializeAxiom, log } from '../observability/axiom'
import { inngest } from './client'
import { SUPPORT_DEAD_LETTER } from './events'

/**
 * Dead letter queue options for failed event processing.
 */
export interface DeadLetterOptions {
  /** Maximum retry attempts before DLQ routing */
  maxRetries?: number
  /** Retry backoff strategy */
  backoff?: {
    type: 'exponential' | 'linear'
    base: number
  }
  /** Alert threshold for consecutive failures */
  alertThreshold?: number
}

/**
 * Failure event metadata for alerting.
 */
export interface FailureEvent {
  name: string
  data: Record<string, unknown>
  error: Error
}

/**
 * Default DLQ configuration
 */
export const DEFAULT_DLQ_OPTIONS: Required<DeadLetterOptions> = {
  maxRetries: 3,
  backoff: { type: 'exponential', base: 1000 },
  alertThreshold: 3,
}

/**
 * Calculates backoff delay for retry attempt.
 */
export function calculateBackoff(
  attempt: number,
  strategy: DeadLetterOptions['backoff']
): number {
  const { type, base } = strategy || DEFAULT_DLQ_OPTIONS.backoff

  if (type === 'exponential') {
    return base * Math.pow(2, attempt)
  }

  return base * (attempt + 1)
}

/**
 * Records a failed event to the DLQ table.
 */
export async function recordFailedEvent(
  event: FailureEvent,
  retryCount: number
): Promise<{ id: string; consecutiveFailures: number }> {
  const db = getDb()

  const existingFailures = await db
    .select()
    .from(DeadLetterQueueTable)
    .where(eq(DeadLetterQueueTable.event_name, event.name))
    .orderBy(desc(DeadLetterQueueTable.last_failed_at))
    .limit(1)

  const consecutiveFailures =
    existingFailures.length > 0 && existingFailures[0]
      ? (existingFailures[0].consecutive_failures ?? 0) + 1
      : 1

  const id = randomUUID()
  const now = new Date()

  await db.insert(DeadLetterQueueTable).values({
    id,
    event_name: event.name,
    event_data: event.data,
    error_message: event.error.message,
    error_stack: event.error.stack || null,
    retry_count: retryCount,
    consecutive_failures: consecutiveFailures,
    first_failed_at: now,
    last_failed_at: now,
  })

  return { id, consecutiveFailures }
}

/**
 * Creates an `onFailure` handler for use in Inngest function config.
 *
 * This is the primary DLQ mechanism. When an Inngest function exhausts all
 * retries, this handler:
 *   1. Logs the failure to Axiom with structured metadata
 *   2. Records the failure in the dead letter queue table
 *   3. Emits a `support/dead-letter` event for downstream processing/alerting
 *   4. Alerts on consecutive failures (via `alertOnFailure`)
 *
 * Usage:
 * ```typescript
 * inngest.createFunction(
 *   {
 *     id: 'my-function',
 *     retries: 3,
 *     onFailure: createDeadLetterHandler('my-function'),
 *   },
 *   { event: MY_EVENT },
 *   async ({ event, step }) => { ... }
 * )
 * ```
 *
 * @param fnName - Name of the Inngest function (for logging/identification)
 * @param options - Optional DLQ configuration overrides
 * @returns An `onFailure` callback compatible with Inngest function config
 */
export function createDeadLetterHandler(
  fnName: string,
  options?: DeadLetterOptions
) {
  const opts = { ...DEFAULT_DLQ_OPTIONS, ...options }

  return async ({ error, event }: { error: Error; event: any }) => {
    initializeAxiom()

    const failedAt = new Date().toISOString()
    const originalEventName = event?.name ?? 'unknown'
    const originalEventData =
      event?.data && typeof event.data === 'object'
        ? (event.data as Record<string, unknown>)
        : {}

    // 1. Log to Axiom
    await log('error', '[DLQ] Function failed after retries exhausted', {
      workflow: 'dead-letter-queue',
      functionName: fnName,
      error: error.message,
      errorStack: error.stack,
      originalEventName,
      originalEventData,
      failedAt,
    })

    // 2. Record in dead letter queue table
    let dlqRecordId: string | undefined
    let consecutiveFailures: number | undefined
    try {
      const failureEvent: FailureEvent = {
        name: fnName,
        data: originalEventData,
        error,
      }
      const result = await recordFailedEvent(failureEvent, opts.maxRetries)
      dlqRecordId = result.id
      consecutiveFailures = result.consecutiveFailures
    } catch (dbError) {
      // DB write failure should not prevent event emission
      await log('error', '[DLQ] Failed to record dead letter in database', {
        workflow: 'dead-letter-queue',
        functionName: fnName,
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
      })
    }

    // 3. Emit support/dead-letter event
    try {
      await inngest.send({
        name: SUPPORT_DEAD_LETTER,
        data: {
          functionName: fnName,
          errorMessage: error.message,
          errorStack: error.stack,
          originalEventName,
          originalEventData,
          failedAt,
          dlqRecordId,
          consecutiveFailures,
        },
      })
    } catch (sendError) {
      // Event emission failure should not throw - log and continue
      await log('error', '[DLQ] Failed to emit dead letter event', {
        workflow: 'dead-letter-queue',
        functionName: fnName,
        sendError:
          sendError instanceof Error ? sendError.message : String(sendError),
      })
    }

    // 4. Alert on consecutive failures
    if (consecutiveFailures !== undefined) {
      await alertOnFailure(
        { name: fnName, data: originalEventData, error },
        consecutiveFailures
      )
    }
  }
}

/**
 * Wraps an Inngest function with dead letter queue handling.
 *
 * @deprecated Use `createDeadLetterHandler()` in your function's `onFailure`
 * config instead. This wrapper cannot retroactively add `onFailure` to an
 * already-created Inngest function - Inngest v3 requires `onFailure` to be
 * set at function definition time.
 *
 * Example migration:
 * ```typescript
 * // Before (no-op):
 * export const myFn = withDeadLetter(inngest.createFunction(...))
 *
 * // After (real DLQ):
 * export const myFn = inngest.createFunction(
 *   { id: 'my-fn', onFailure: createDeadLetterHandler('my-fn') },
 *   ...
 * )
 * ```
 *
 * @param fn - Inngest function to wrap
 * @param _options - Dead letter configuration (unused - see deprecation note)
 * @returns The function unchanged (pass-through)
 */
export function withDeadLetter<T = any>(
  fn: T,
  _options?: DeadLetterOptions
): T {
  // Cannot retroactively add onFailure to a created Inngest function.
  // Use createDeadLetterHandler() in your function config instead.
  return fn
}

/**
 * Sends Slack alert for consecutive failures.
 *
 * Only alerts after 3+ consecutive failures to reduce noise.
 *
 * @param event - Failed event details
 * @param consecutiveFailures - Count of consecutive failures
 */
export async function alertOnFailure(
  event: FailureEvent,
  consecutiveFailures: number
): Promise<void> {
  const threshold = DEFAULT_DLQ_OPTIONS.alertThreshold

  if (consecutiveFailures < threshold) {
    return
  }

  // TODO: Implement Slack alerting via webhook
  // For now, log to console for observability
  console.warn(
    `[DLQ] ${consecutiveFailures} consecutive failures for ${event.name}:`,
    event.error.message,
    {
      eventData: event.data,
      errorStack: event.error.stack,
    }
  )

  // Mark as alerted in DB
  const db = getDb()
  const recentFailures = await db
    .select()
    .from(DeadLetterQueueTable)
    .where(eq(DeadLetterQueueTable.event_name, event.name))
    .orderBy(desc(DeadLetterQueueTable.last_failed_at))
    .limit(1)

  const recent = recentFailures[0]
  if (recent && !recent.alerted_at) {
    await db
      .update(DeadLetterQueueTable)
      .set({ alerted_at: new Date() })
      .where(eq(DeadLetterQueueTable.id, recent.id))
  }
}
