/**
 * Draft Tracking Types
 *
 * Types for correlating Front drafts with agent actions for the RL loop.
 * The hidden ID embedded in draft content allows us to trace back from
 * sent emails to the original action that generated them.
 */

/**
 * Data stored in Redis for draft tracking.
 * Links a Front draft to its originating action for RL feedback.
 */
export interface DraftTrackingData {
  /** The action ID that generated this draft */
  actionId: string
  /** Front conversation ID */
  conversationId: string
  /** Front draft ID returned from createDraft */
  draftId: string
  /** App ID for multi-tenant tracking */
  appId: string
  /** Classification category (e.g., 'password_reset', 'refund_request') */
  category: string
  /** Confidence score from classification (0-1) */
  confidence: number
  /** Whether this was auto-approved or human-approved */
  autoApproved: boolean
  /** Customer email for correlation */
  customerEmail?: string
  /** Timestamp when draft was created */
  createdAt: string
}

/**
 * Marker format for embedding action ID in draft content.
 * Uses an HTML comment that's invisible in rendered email.
 */
export const DRAFT_ID_MARKER_PREFIX = '<!-- agent-draft-id:'
export const DRAFT_ID_MARKER_SUFFIX = ' -->'
