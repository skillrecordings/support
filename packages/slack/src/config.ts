/**
 * Shared configuration for the Slack package.
 * Centralizes magic numbers and defaults for easier tuning.
 */

/** Default model for AI-powered draft refinement */
export const DEFAULT_DRAFT_MODEL =
  process.env.SLACK_DRAFT_MODEL ?? 'anthropic/claude-sonnet-4-5'

/** Cache TTL for status queries (ms) */
export const STATUS_CACHE_TTL_MS = Number(
  process.env.SLACK_STATUS_CACHE_TTL_MS ?? 30_000
)

/** Default TTL for thread context in Redis (seconds) */
export const THREAD_CONTEXT_TTL_SECONDS = Number(
  process.env.SLACK_THREAD_CONTEXT_TTL_SECONDS ?? 60 * 60
)
