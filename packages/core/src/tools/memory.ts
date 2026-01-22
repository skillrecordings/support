import { calculateConfidence } from '@skillrecordings/memory/decay'
import { MemoryService } from '@skillrecordings/memory/memory'
import { VotingService } from '@skillrecordings/memory/voting'
import { z } from 'zod'
import {
  traceMemoryCite,
  traceMemoryFind,
  traceMemoryStore,
  traceMemoryVote,
} from '../observability/axiom'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Search for relevant memories using semantic similarity.
 *
 * Queries the memory store with vector search, applies decay scoring,
 * and returns relevant memories above the threshold.
 *
 * @example
 * ```typescript
 * const results = await memory_search.execute({
 *   query: 'How to handle refunds',
 *   appId: 'total-typescript',
 *   limit: 5,
 *   threshold: 0.7
 * }, context)
 * ```
 */
export const memorySearch = createTool({
  name: 'memory_search',
  description:
    'Search for relevant memories using semantic similarity. Use this to find past solutions, patterns, and decisions that may help with the current conversation.',
  parameters: z.object({
    /**
     * Search query for semantic matching
     */
    query: z.string().min(1, 'Query is required'),
    /**
     * App ID to scope search to specific app memories
     */
    appId: z.string().optional(),
    /**
     * Maximum number of results to return
     */
    limit: z.number().optional().default(10),
    /**
     * Minimum similarity score threshold (0-1)
     */
    threshold: z.number().optional().default(0.5),
    /**
     * Filter by specific tags
     */
    tags: z.array(z.string()).optional(),
  }),

  execute: async (params, context: ExecutionContext) => {
    const startTime = Date.now()

    try {
      const results = await MemoryService.find(params.query, {
        collection: params.appId ? `app:${params.appId}` : 'default',
        limit: params.limit,
        threshold: params.threshold,
        app_slug: params.appId,
        tags: params.tags,
      })

      const durationMs = Date.now() - startTime

      // Trace the search operation
      await traceMemoryFind({
        collection: params.appId ? `app:${params.appId}` : 'default',
        appSlug: params.appId,
        queryLength: params.query.length,
        limit: params.limit ?? 10,
        threshold: params.threshold ?? 0.5,
        tags: params.tags,
        resultsFound: results.length,
        topScore: results[0]?.score,
        avgScore:
          results.length > 0
            ? results.reduce((sum, r) => sum + r.score, 0) / results.length
            : 0,
        durationMs,
        success: true,
      })

      return results.map((r) => ({
        id: r.memory.id,
        content: r.memory.content,
        score: r.score,
        raw_score: r.raw_score,
        confidence: calculateConfidence(r.memory),
        tags: r.memory.metadata.tags,
        created_at: r.memory.metadata.created_at,
        age_days: r.age_days,
      }))
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      await traceMemoryFind({
        collection: params.appId ? `app:${params.appId}` : 'default',
        appSlug: params.appId,
        queryLength: params.query.length,
        limit: params.limit ?? 10,
        threshold: params.threshold ?? 0.5,
        tags: params.tags,
        resultsFound: 0,
        durationMs,
        success: false,
        error: errorMessage,
      })

      throw error
    }
  },
})

/**
 * Store a new memory for future retrieval.
 *
 * Saves information that may be useful for handling similar
 * conversations in the future. Memories are searchable via
 * semantic similarity.
 *
 * @example
 * ```typescript
 * await memory_store.execute({
 *   content: 'Customer prefers refunds to account credit for Total TypeScript',
 *   appId: 'total-typescript',
 *   tags: ['refund', 'preference'],
 *   confidence: 0.9
 * }, context)
 * ```
 */
export const memoryStore = createTool({
  name: 'memory_store',
  description:
    'Store a new memory for future retrieval. Use this to save important patterns, decisions, or customer preferences that will help with similar conversations.',
  parameters: z.object({
    /**
     * The memory content to store
     */
    content: z.string().min(1, 'Content is required'),
    /**
     * App ID to associate memory with specific app
     */
    appId: z.string().optional(),
    /**
     * Tags for categorizing the memory
     */
    tags: z.array(z.string()).optional(),
    /**
     * Initial confidence score (0-1)
     */
    confidence: z.number().min(0).max(1).optional().default(1),
  }),

  execute: async (params, context: ExecutionContext) => {
    const startTime = Date.now()

    try {
      const memory = await MemoryService.store(params.content, {
        collection: params.appId ? `app:${params.appId}` : 'default',
        source: 'agent',
        app_slug: params.appId,
        tags: params.tags,
        confidence: params.confidence,
      })

      const durationMs = Date.now() - startTime

      // Trace the store operation
      await traceMemoryStore({
        memoryId: memory.id,
        collection: params.appId ? `app:${params.appId}` : 'default',
        appSlug: params.appId,
        source: 'agent',
        contentLength: params.content.length,
        tags: params.tags ?? [],
        confidence: params.confidence ?? 1,
        durationMs,
        success: true,
      })

      return {
        id: memory.id,
        content: memory.content,
        created_at: memory.metadata.created_at,
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      await traceMemoryStore({
        memoryId: 'failed',
        collection: params.appId ? `app:${params.appId}` : 'default',
        appSlug: params.appId,
        source: 'agent',
        contentLength: params.content.length,
        tags: params.tags ?? [],
        confidence: params.confidence ?? 1,
        durationMs,
        success: false,
        error: errorMessage,
      })

      throw error
    }
  },
})

/**
 * Vote on a memory to indicate quality.
 *
 * Upvote memories that were helpful, downvote those that weren't.
 * This helps improve memory retrieval over time.
 *
 * @example
 * ```typescript
 * await memory_vote.execute({
 *   memoryId: 'mem-123',
 *   appId: 'total-typescript',
 *   voteType: 'upvote'
 * }, context)
 * ```
 */
export const memoryVote = createTool({
  name: 'memory_vote',
  description:
    'Vote on a memory to indicate its quality. Upvote helpful memories, downvote unhelpful ones. This improves future memory retrieval.',
  parameters: z.object({
    /**
     * Memory ID to vote on
     */
    memoryId: z.string().min(1, 'Memory ID is required'),
    /**
     * App ID the memory belongs to
     */
    appId: z.string().optional(),
    /**
     * Type of vote
     */
    voteType: z.enum(['upvote', 'downvote']),
  }),

  execute: async (params, context: ExecutionContext) => {
    const startTime = Date.now()
    const collection = params.appId ? `app:${params.appId}` : 'default'

    try {
      // Fetch current memory state for tracing
      const memory = await MemoryService.get(params.memoryId, collection)
      if (!memory) {
        throw new Error('Memory not found')
      }

      const previousUpvotes = memory.metadata.votes?.upvotes ?? 0
      const previousDownvotes = memory.metadata.votes?.downvotes ?? 0

      // Apply vote
      await VotingService.vote(params.memoryId, collection, params.voteType)

      // Fetch updated state
      const updatedMemory = await MemoryService.get(params.memoryId, collection)
      if (!updatedMemory) {
        throw new Error('Memory not found after vote')
      }

      const newUpvotes = updatedMemory.metadata.votes?.upvotes ?? 0
      const newDownvotes = updatedMemory.metadata.votes?.downvotes ?? 0

      const durationMs = Date.now() - startTime

      // Trace the vote operation
      await traceMemoryVote({
        memoryId: params.memoryId,
        collection,
        voteType: params.voteType,
        previousUpvotes,
        previousDownvotes,
        newUpvotes,
        newDownvotes,
        durationMs,
        success: true,
      })

      return {
        success: true,
        upvotes: newUpvotes,
        downvotes: newDownvotes,
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      await traceMemoryVote({
        memoryId: params.memoryId,
        collection,
        voteType: params.voteType,
        previousUpvotes: 0,
        previousDownvotes: 0,
        newUpvotes: 0,
        newDownvotes: 0,
        durationMs,
        success: false,
        error: errorMessage,
      })

      throw error
    }
  },
})

/**
 * Record that a memory was cited in a conversation.
 *
 * This tracks usage and helps identify the most useful memories.
 * Call this when using information from a memory in a response.
 *
 * @example
 * ```typescript
 * await memory_cite.execute({
 *   memoryId: 'mem-123',
 *   appId: 'total-typescript',
 *   conversationId: 'cnv_abc'
 * }, context)
 * ```
 */
export const memoryCite = createTool({
  name: 'memory_cite',
  description:
    'Record that a memory was cited in a conversation. Call this when you use information from a memory in your response.',
  parameters: z.object({
    /**
     * Memory ID that was cited
     */
    memoryId: z.string().min(1, 'Memory ID is required'),
    /**
     * App ID the memory belongs to
     */
    appId: z.string().optional(),
    /**
     * Conversation ID where memory was cited
     */
    conversationId: z.string().optional(),
  }),

  execute: async (params, context: ExecutionContext) => {
    const startTime = Date.now()
    const collection = params.appId ? `app:${params.appId}` : 'default'

    try {
      // Fetch current citation count
      const memory = await MemoryService.get(params.memoryId, collection)
      if (!memory) {
        throw new Error('Memory not found')
      }

      const previousCitations = memory.metadata.votes?.citations ?? 0

      // Record citation (VotingService.cite expects array of IDs and runId)
      await VotingService.cite(
        [params.memoryId],
        params.conversationId ?? context.conversationId,
        collection
      )

      // Fetch updated state
      const updatedMemory = await MemoryService.get(params.memoryId, collection)
      if (!updatedMemory) {
        throw new Error('Memory not found after citation')
      }

      const newCitations = updatedMemory.metadata.votes?.citations ?? 0

      const durationMs = Date.now() - startTime

      // Trace the citation operation
      await traceMemoryCite({
        memoryId: params.memoryId,
        collection,
        conversationId: params.conversationId ?? context.conversationId,
        appId: params.appId ?? context.appConfig.id,
        previousCitations,
        newCitations,
        durationMs,
        success: true,
      })

      return {
        success: true,
        citations: newCitations,
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      await traceMemoryCite({
        memoryId: params.memoryId,
        collection,
        conversationId: params.conversationId ?? context.conversationId,
        appId: params.appId ?? context.appConfig.id,
        previousCitations: 0,
        newCitations: 0,
        durationMs,
        success: false,
        error: errorMessage,
      })

      throw error
    }
  },
})
