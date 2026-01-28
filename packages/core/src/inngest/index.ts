/**
 * Inngest module for the support platform.
 *
 * Exports:
 * - inngest: Typed Inngest client
 * - Events: Event type definitions
 * - allWorkflows: Collection of all workflow functions (populated by workflows/index.ts)
 * - createServeHandler: Factory function for creating Inngest serve handler
 */

import { inngest } from './client'
import { allWorkflows } from './workflows'

export { inngest }
export type { Events } from './events'
export {
  SUPPORT_INBOUND_RECEIVED,
  SUPPORT_COMMENT_RECEIVED,
  SUPPORT_CONVERSATION_SNOOZED,
  SUPPORT_SNOOZE_EXPIRED,
  SUPPORT_APPROVAL_REQUESTED,
  SUPPORT_APPROVAL_DECIDED,
  SUPPORT_ACTION_APPROVED,
  SUPPORT_ACTION_REJECTED,
  SUPPORT_DEAD_LETTER,
} from './events'
export {
  createDeadLetterHandler,
  withDeadLetter,
  alertOnFailure,
  calculateBackoff,
  recordFailedEvent,
  DEFAULT_DLQ_OPTIONS,
} from './dead-letter'
export type { DeadLetterOptions, FailureEvent } from './dead-letter'

/**
 * All workflow functions for the support platform.
 * Populated by ./workflows/index.ts when workflows are implemented.
 */
export { allWorkflows }

/**
 * Create serve handler for Inngest workflows.
 *
 * Factory function that wires the Inngest client with all workflows.
 * Returns a handler compatible with Inngest's serve API.
 *
 * Usage:
 * ```typescript
 * import { createServeHandler } from '@skillrecordings/core/inngest'
 *
 * export const { GET, POST, PUT } = createServeHandler()
 * ```
 *
 * @returns Inngest serve handler with GET, POST, PUT methods
 */
export function createServeHandler() {
  // Dynamic import to avoid loading serve at module level
  // serve() is framework-specific (Next.js, Express, etc.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { serve } = require('inngest/next')

  return serve({
    client: inngest,
    functions: allWorkflows,
  })
}
