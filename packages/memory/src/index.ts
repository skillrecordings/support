/**
 * @skillrecordings/memory
 *
 * Memory system with semantic search, time decay, and voting.
 */

// Base memory system
export { MemoryService } from './memory'
export type { SearchOptions, StoreMetadata } from './memory'

export { VotingService } from './voting'
export type {
  VoteType,
  OutcomeType,
  PruneOptions,
  PruneResult,
  CollectionStats,
  StatsResult,
} from './voting'

export {
  calculateDecay,
  calculateConfidence,
  DECAY_HALF_LIFE_DAYS,
} from './decay'

export {
  getVectorIndex,
  upsertMemory,
  queryMemories,
  deleteMemory,
  fetchMemory,
} from './client'
export type { QueryMemoriesOptions, QueryMemoryResult } from './client'

// Base schemas
export {
  MemorySchema,
  MemoryMetadataSchema,
  MemoryVotesSchema,
  SearchResultSchema,
  MemoryVoteSchema,
} from './schemas'
export type {
  Memory,
  MemoryMetadata,
  MemoryVotes,
  SearchResult,
  MemoryVote,
} from './schemas'

// Support-specific
export { SupportMemoryService } from './support-memory'

export {
  SupportStageSchema,
  SupportOutcomeSchema,
  SupportMemoryMetadataSchema,
  SupportMemorySchema,
  StoreSupportMemoryInputSchema,
  FindSimilarOptionsSchema,
  CorrectionInputSchema,
  SupportSearchResultSchema,
} from './support-schemas'
export type {
  SupportStage,
  SupportOutcome,
  SupportMemoryMetadata,
  SupportMemory,
  StoreSupportMemoryInput,
  FindSimilarOptions,
  CorrectionInput,
  SupportSearchResult,
} from './support-schemas'
