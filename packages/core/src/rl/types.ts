/**
 * Reinforcement Learning Types
 *
 * Types for the RL feedback loop that learns from human edits to agent drafts.
 * This is THE learning signal - edits tell us what the human corrected.
 *
 * @module rl/types
 */

/**
 * Draft outcome category for RL signal classification.
 *
 * | Category | Similarity | Signal Type |
 * |----------|------------|-------------|
 * | unchanged | ≥95% | Strong positive - draft accepted |
 * | minor_edit | 70-95% | Weak positive - cosmetic changes |
 * | major_rewrite | <70% | Correction signal (10x learning value!) |
 * | deleted | N/A | Negative - draft discarded after timeout |
 * | no_draft | N/A | Baseline - manual response |
 */
export type DraftOutcome =
  | 'unchanged' // ≥95% match, draft sent as-is
  | 'minor_edit' // 70-95% match, small tweaks
  | 'major_rewrite' // <70% match, significant correction
  | 'deleted' // Draft not used within timeout window
  | 'no_draft' // No agent draft existed (manual response)

/**
 * Edit detection result with similarity score and metadata.
 */
export interface EditDetectionResult {
  /** Outcome category */
  outcome: DraftOutcome
  /** Similarity score (0-1), undefined for deleted/no_draft */
  similarity?: number
  /** Original draft text (normalized) */
  originalText?: string
  /** Sent message text (normalized) */
  sentText?: string
  /** Detection timestamp */
  detectedAt: string
}

/**
 * Detection thresholds (configurable for tuning).
 */
export interface DetectionThresholds {
  /** Threshold for unchanged (default: 0.95) */
  unchanged: number
  /** Threshold for minor_edit vs major_rewrite (default: 0.70) */
  minorEdit: number
}

/**
 * Default thresholds based on empirical research.
 * See Epic #26 for methodology.
 */
export const DEFAULT_THRESHOLDS: DetectionThresholds = {
  unchanged: 0.95,
  minorEdit: 0.7,
}

/**
 * Default deletion timeout (2 hours in ms).
 * If a draft isn't sent within this window, it's marked deleted.
 */
export const DELETION_TIMEOUT_MS = 2 * 60 * 60 * 1000

/**
 * RL Signal record for feedback loop consumption.
 */
export interface RLSignal {
  /** Unique signal ID */
  id: string
  /** Conversation ID */
  conversationId: string
  /** Message ID (if sent) */
  messageId?: string
  /** App identifier */
  appId: string
  /** Action ID that generated the draft */
  actionId: string
  /** Draft outcome category */
  outcome: DraftOutcome
  /** Similarity score (0-1) */
  similarity?: number
  /** Original draft text */
  draftText?: string
  /** Sent message text (if applicable) */
  sentText?: string
  /** Classification category (e.g., 'refund_request') */
  classificationCategory?: string
  /** Classification confidence */
  classificationConfidence?: number
  /** Author who sent (if applicable) */
  authorId?: string
  /** Timestamp when signal was recorded */
  recordedAt: string
  /** Workflow trace ID */
  traceId?: string
}
