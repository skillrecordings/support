/**
 * FAQ Mining Types
 *
 * Types for mining FAQ candidates from resolved Front conversations.
 * Part of the RL feedback loop - learns from successful support interactions.
 *
 * @module faq/types
 */

import type { Conversation, Message } from '@skillrecordings/front-sdk'

/**
 * A resolved conversation with its messages, ready for FAQ analysis.
 */
export interface ResolvedConversation {
  /** Front conversation ID */
  conversationId: string
  /** Customer question (first inbound message) */
  question: string
  /** Agent response (reply that resolved the conversation) */
  answer: string
  /** Original conversation subject */
  subject: string
  /** When the conversation was resolved */
  resolvedAt: Date
  /** App ID (derived from inbox) */
  appId: string
  /** Whether the response was sent unchanged from draft */
  wasUnchanged: boolean
  /** Draft similarity score (if available) */
  draftSimilarity?: number
  /** Tags from the conversation */
  tags: string[]
  /** Full conversation for context */
  _raw: {
    conversation: Conversation
    messages: Message[]
  }
}

/**
 * A cluster of similar conversations.
 */
export interface ConversationCluster {
  /** Unique cluster ID */
  id: string
  /** Cluster centroid text (synthesized from questions) */
  centroid: string
  /** Conversations in this cluster */
  conversations: ResolvedConversation[]
  /** Average similarity score within cluster */
  cohesion: number
  /** Percentage of conversations where draft was sent unchanged */
  unchangedRate: number
  /** Most recent conversation timestamp */
  mostRecent: Date
  /** Oldest conversation timestamp */
  oldest: Date
}

/**
 * A generated FAQ candidate from a cluster.
 */
export interface FaqCandidate {
  /** Unique candidate ID */
  id: string
  /** Synthesized question (from cluster) */
  question: string
  /** Best/composite answer */
  answer: string
  /** Cluster this came from */
  clusterId: string
  /** Number of similar conversations */
  clusterSize: number
  /** Percentage of unchanged drafts */
  unchangedRate: number
  /** Confidence score (0-1) based on signals */
  confidence: number
  /** Common tags from conversations */
  tags: string[]
  /** Most common subject patterns */
  subjectPatterns: string[]
  /** Source conversation IDs */
  sourceConversationIds: string[]
  /** When candidate was generated */
  generatedAt: Date
  /** Suggested category */
  suggestedCategory?: string
  /** Review status */
  status: 'pending' | 'approved' | 'rejected'
}

/**
 * Options for mining conversations.
 */
export interface MineOptions {
  /** App ID to mine from */
  appId: string
  /** How far back to look (e.g., '30d', '90d') */
  since: string
  /** Maximum conversations to process */
  limit?: number
  /** Only include conversations where draft was unchanged */
  unchangedOnly?: boolean
  /** Minimum similarity threshold for clustering */
  clusterThreshold?: number
}

/**
 * Options for clustering.
 */
export interface ClusterOptions {
  /** Minimum similarity for grouping (default: 0.75) */
  threshold?: number
  /** Minimum cluster size to keep (default: 3) */
  minClusterSize?: number
}

/**
 * Result of mining operation.
 */
export interface MineResult {
  /** Conversations mined */
  conversations: ResolvedConversation[]
  /** Clusters formed */
  clusters: ConversationCluster[]
  /** FAQ candidates generated */
  candidates: FaqCandidate[]
  /** Statistics */
  stats: {
    totalConversations: number
    resolvedConversations: number
    clusteredConversations: number
    clusterCount: number
    candidateCount: number
    averageClusterSize: number
    averageUnchangedRate: number
  }
}

/**
 * Thresholds for auto-surfacing candidates.
 */
export const FAQ_THRESHOLDS = {
  /** Minimum cluster size for auto-surface */
  MIN_CLUSTER_SIZE: 5,
  /** Minimum unchanged rate for auto-surface (80%) */
  MIN_UNCHANGED_RATE: 0.8,
  /** High confidence threshold */
  HIGH_CONFIDENCE: 0.85,
  /** Default clustering threshold */
  DEFAULT_CLUSTER_THRESHOLD: 0.75,
  /** Minimum cluster size to keep */
  DEFAULT_MIN_CLUSTER_SIZE: 3,
} as const
