/**
 * Draft Tracking Module
 *
 * Provides utilities for correlating Front drafts with agent actions
 * to enable the RL (reinforcement learning) feedback loop.
 *
 * @module draft
 */

export type { DraftTrackingData } from './types'
export {
  DRAFT_ID_MARKER_PREFIX,
  DRAFT_ID_MARKER_SUFFIX,
} from './types'

export {
  embedDraftId,
  extractDraftId,
  storeDraftTracking,
  getDraftTracking,
  removeDraftTracking,
} from './tracking'
