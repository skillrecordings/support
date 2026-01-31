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
 * Query options for data sources.
 */
export interface QueryOptions {
  /** App ID to filter by */
  appId?: string
  /** Filter conversations since this date */
  since?: Date
  /** Maximum conversations to return */
  limit?: number
}

/**
 * Abstract data source for FAQ mining.
 * Implementations include Front API and DuckDB cache.
 */
export interface DataSource {
  /** Data source name for logging */
  name: string
  /** Get conversations matching filters */
  getConversations(options: QueryOptions): Promise<ResolvedConversation[]>
  /** Get messages for a specific conversation */
  getMessages(conversationId: string): Promise<Message[]>
  /** Get statistics about the data source */
  getStats?(): Promise<{
    totalConversations: number
    filteredConversations: number
    totalMessages: number
    inboxCount: number
    dateRange: { oldest: Date | null; newest: Date | null }
  }>
  /** Clean up resources (close connections) */
  close?(): Promise<void>
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
  /** Data source to use (default: front) */
  source?: DataSource
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

// =============================================================================
// Production Clustering Types (Phase 1.2)
// =============================================================================

/**
 * Phase 0 cluster assignment from HDBSCAN
 */
export interface Phase0Assignment {
  cluster_id: number // -1 for noise
  distance_to_centroid: number | null
}

/**
 * Phase 0 cluster label from LLM
 */
export interface Phase0ClusterLabel {
  id: number
  label: string
  size: number
  representative_messages: string[]
  top_existing_tags: string[]
  tag_coverage: number
}

/**
 * Production cluster metadata
 */
export interface ProductionCluster {
  /** Cluster ID (from Phase 0) */
  id: number
  /** LLM-generated label */
  label: string
  /** Human-readable description (optional, for refinement) */
  description?: string
  /** Number of conversations in this cluster */
  size: number
  /** Representative conversation IDs */
  representativeIds: string[]
  /** Top tags from conversations in this cluster */
  topTags: string[]
  /** Tag coverage (% of conversations with tags) */
  tagCoverage: number
  /** Average distance to centroid (cohesion metric) */
  avgDistanceToCentroid: number
  /** Priority tier from Phase 0 decisions (1-3) */
  priorityTier?: number
}

/**
 * Individual conversation cluster assignment
 */
export interface ConversationAssignment {
  /** Conversation ID */
  conversationId: string
  /** Cluster ID (-1 for noise) */
  clusterId: number
  /** Distance to cluster centroid (null for noise) */
  distanceToCentroid: number | null
  /** Confidence score (1 - normalized distance) */
  confidence: number
}

/**
 * Production clustering result
 */
export interface ProductionClusteringResult {
  /** Version identifier */
  version: string
  /** When clustering was generated */
  generatedAt: string
  /** Algorithm and parameters used */
  config: {
    algorithm: string
    parameters: Record<string, unknown>
    phase0ArtifactPath: string
  }
  /** Summary statistics */
  stats: {
    totalConversations: number
    clusteredConversations: number
    noiseConversations: number
    clusterCount: number
    noisePct: number
    largestClusterSize: number
    avgClusterSize: number
  }
  /** Cluster metadata */
  clusters: ProductionCluster[]
  /** Conversation assignments */
  assignments: Record<string, ConversationAssignment>
}

/**
 * Options for production clustering
 */
export interface ProductionClusterOptions {
  /** Path to Phase 0 artifacts */
  phase0Path: string
  /** Output directory for production artifacts */
  outputPath: string
  /** Version tag (e.g., 'v1', 'v2') */
  version?: string
  /** Whether to enrich with DuckDB data */
  enrichFromDuckDB?: boolean
  /** DuckDB cache path */
  duckdbPath?: string
}
