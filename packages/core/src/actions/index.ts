/**
 * Action execution utilities for tool operations
 *
 * This module provides:
 * - Idempotency protection to prevent duplicate tool executions
 * - Utilities for action lifecycle management
 */

export {
  generateIdempotencyKey,
  checkIdempotency,
  completeIdempotencyKey,
  failIdempotencyKey,
  cleanupExpiredKeys,
  withIdempotency,
  type IdempotencyCheckResult,
  type IdempotencyKeyOptions,
} from './idempotency'
