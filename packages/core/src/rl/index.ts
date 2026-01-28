/**
 * Reinforcement Learning Module
 *
 * Provides edit detection and RL signal types for the feedback loop.
 *
 * @module rl
 */

// Types
export type {
  DraftOutcome,
  EditDetectionResult,
  DetectionThresholds,
  RLSignal,
} from './types'

export {
  DEFAULT_THRESHOLDS,
  DELETION_TIMEOUT_MS,
} from './types'

// Detection functions
export {
  detectEditType,
  detectEditTypes,
  markAsDeleted,
  normalizeText,
  computeSimilarity,
} from './edit-detection'
