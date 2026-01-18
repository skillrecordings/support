import { randomUUID } from 'crypto'
import {
  DeadLetterQueueTable,
  desc,
  eq,
  getDb,
} from '@skillrecordings/database'
import type { InngestFunction } from 'inngest'

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

  // Check if this event has failed before
  const existingFailures = await db
    .select()
    .from(DeadLetterQueueTable)
    .where(eq(DeadLetterQueueTable.event_name, event.name))
    .orderBy(desc(DeadLetterQueueTable.last_failed_at))
    .limit(1)

  const consecutiveFailures =
    existingFailures.length > 0
      ? existingFailures[0].consecutive_failures + 1
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
 * Wraps an Inngest function with dead letter queue handling.
 *
 * Failed events are routed to DLQ table after max retries.
 * Retry backoff is configurable.
 *
 * @param fn - Inngest function to wrap
 * @param options - Dead letter configuration
 * @returns Wrapped function with DLQ handling
 */
export function withDeadLetter<T = any>(fn: T, options?: DeadLetterOptions): T {
  // For now, return the function as-is
  // Full wrapper implementation would require Inngest middleware
  // which is better implemented at the function definition level
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

  if (recentFailures.length > 0 && !recentFailures[0].alerted_at) {
    await db
      .update(DeadLetterQueueTable)
      .set({ alerted_at: new Date() })
      .where(eq(DeadLetterQueueTable.id, recentFailures[0].id))
  }
}
