/**
 * FAQ Mining Module
 *
 * Tools for mining FAQ candidates from resolved support conversations
 * and clustering them by semantic similarity.
 *
 * @module faq
 */

// Types
export type {
  ResolvedConversation,
  ConversationCluster,
  FaqCandidate,
  MineOptions,
  ClusterOptions,
  MineResult,
} from './types'

export { FAQ_THRESHOLDS } from './types'

// Mining functions
export { mineConversations, mineFaqCandidates } from './miner'

// Clustering functions
export {
  clusterBySimilarity,
  generateCandidatesFromClusters,
  filterAutoSurfaceCandidates,
} from './clusterer'
