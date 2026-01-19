import { z } from 'zod'

/**
 * Memory vote tracking
 */
export const MemoryVotesSchema = z.object({
  upvotes: z.number().int().min(0).default(0),
  downvotes: z.number().int().min(0).default(0),
  citations: z.number().int().min(0).default(0),
  success_rate: z.number().min(0).max(1).default(0),
})

export type MemoryVotes = z.infer<typeof MemoryVotesSchema>

/**
 * Memory metadata
 */
export const MemoryMetadataSchema = z.object({
  collection: z.string(),
  app_slug: z.string().optional(),
  tags: z.array(z.string()).default([]),
  source: z.enum(['agent', 'human', 'system']),
  confidence: z.number().min(0).max(1).default(1),
  created_at: z.string().datetime(),
  last_validated_at: z.string().datetime().optional(),
  votes: MemoryVotesSchema,
})

export type MemoryMetadata = z.infer<typeof MemoryMetadataSchema>

/**
 * Memory record structure
 */
export const MemorySchema = z.object({
  id: z.string().uuid(),
  content: z.string().min(1),
  embedding: z.array(z.number()).optional(),
  metadata: MemoryMetadataSchema,
})

export type Memory = z.infer<typeof MemorySchema>

/**
 * Search result with decay scoring
 */
export const SearchResultSchema = z.object({
  memory: MemorySchema,
  score: z.number(),
  raw_score: z.number(),
  age_days: z.number(),
  decay_factor: z.number().min(0).max(1),
})

export type SearchResult = z.infer<typeof SearchResultSchema>

/**
 * Memory vote action (upvote, downvote, citation)
 */
export const MemoryVoteSchema = z.object({
  memory_id: z.string().uuid(),
  vote_type: z.enum(['upvote', 'downvote', 'citation']),
  voter_id: z.string().optional(),
  timestamp: z.string().datetime(),
})

export type MemoryVote = z.infer<typeof MemoryVoteSchema>
