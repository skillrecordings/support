import {
  deleteMemory,
  fetchMemory,
  getVectorIndex,
  upsertMemory,
} from './client'
import { calculateConfidence } from './decay'
import type { Memory } from './schemas'

/**
 * Vote type for memory feedback
 */
export type VoteType = 'upvote' | 'downvote'

/**
 * Outcome type for citation tracking
 */
export type OutcomeType = 'success' | 'failure'

/**
 * Options for pruning memories
 */
export interface PruneOptions {
  /** Collection to prune (omit for all collections) */
  collection?: string
  /** Minimum confidence threshold (memories below this are pruned) */
  min_confidence?: number
  /** Minimum age in days before pruning (default: 30) */
  min_age_days?: number
  /** Maximum downvotes before pruning regardless of age (default: none) */
  max_downvotes?: number
}

/**
 * Result of pruning operation
 */
export interface PruneResult {
  /** Number of memories deleted */
  deleted_count: number
  /** IDs of deleted memories */
  deleted_ids: string[]
}

/**
 * Stats for a collection
 */
export interface CollectionStats {
  /** Number of memories in collection */
  count: number
  /** Average confidence score */
  avg_confidence: number
  /** Total upvotes */
  total_upvotes: number
  /** Total downvotes */
  total_downvotes: number
  /** Total citations */
  total_citations: number
  /** Average success rate */
  avg_success_rate: number
}

/**
 * Stats result by collection
 */
export type StatsResult = Record<string, CollectionStats>

/**
 * Internal helper to track outcome counts
 */
interface OutcomeTracking {
  success_count: number
  failure_count: number
}

/**
 * Voting Service
 *
 * Provides operations for voting on memories, tracking citations,
 * recording outcomes, viewing stats, and pruning low-quality memories.
 */
export const VotingService = {
  /**
   * Vote on a memory (upvote or downvote)
   *
   * @param id - Memory ID
   * @param collection - Collection the memory belongs to
   * @param voteType - Type of vote ('upvote' or 'downvote')
   * @throws {Error} If memory not found
   */
  async vote(
    id: string,
    collection: string,
    voteType: VoteType
  ): Promise<void> {
    const memory = await fetchMemory(id, collection)
    if (!memory) {
      throw new Error('Memory not found')
    }

    // Increment the appropriate vote counter
    if (voteType === 'upvote') {
      memory.metadata.votes.upvotes++
    } else {
      memory.metadata.votes.downvotes++
    }

    await upsertMemory(memory)
  },

  /**
   * Record a citation (memory was retrieved and used)
   *
   * @param id - Memory ID
   * @param collection - Collection the memory belongs to
   * @throws {Error} If memory not found
   */
  async cite(id: string, collection: string): Promise<void> {
    const memory = await fetchMemory(id, collection)
    if (!memory) {
      throw new Error('Memory not found')
    }

    memory.metadata.votes.citations++
    await upsertMemory(memory)
  },

  /**
   * Record outcome for a citation (success or failure)
   *
   * Updates the success_rate based on accumulated outcomes.
   * Formula: success_rate = success_count / total_outcomes
   *
   * We store outcome counts in metadata (not in schema yet, but will add).
   * For now, we store them as custom fields in metadata.
   *
   * @param id - Memory ID
   * @param collection - Collection the memory belongs to
   * @param outcome - Outcome type ('success' or 'failure')
   * @throws {Error} If memory not found
   */
  async recordOutcome(
    id: string,
    collection: string,
    outcome: OutcomeType
  ): Promise<void> {
    const memory = await fetchMemory(id, collection)
    if (!memory) {
      throw new Error('Memory not found')
    }

    // Store outcome counts in metadata (extend the type at runtime)
    const metadata = memory.metadata as any
    const outcomeTracking = metadata._outcome_tracking || {
      success: 0,
      failure: 0,
    }

    // Update counts based on new outcome
    if (outcome === 'success') {
      outcomeTracking.success++
    } else {
      outcomeTracking.failure++
    }

    // Calculate new success rate
    const totalOutcomes = outcomeTracking.success + outcomeTracking.failure
    memory.metadata.votes.success_rate =
      totalOutcomes > 0 ? outcomeTracking.success / totalOutcomes : 0

    // Store updated tracking
    metadata._outcome_tracking = outcomeTracking

    await upsertMemory(memory)
  },

  /**
   * Get statistics for memories
   *
   * @param collection - Optional collection filter (omit for all collections)
   * @returns Stats by collection
   */
  async stats(collection?: string): Promise<StatsResult> {
    const index = getVectorIndex()

    // Upstash Vector doesn't provide a direct way to list all namespaces/collections
    // or count all memories across collections. We'll need to implement this by
    // scanning the index. For now, we'll implement a simplified version that
    // requires fetching memories.

    // Note: This is a simplified implementation. In production, you might want
    // to maintain stats in a separate data store for efficiency.

    const collections = collection
      ? [collection]
      : await this._listCollections()
    const stats: StatsResult = {}

    for (const col of collections) {
      // Fetch all memories in this collection
      // This is inefficient but necessary given Upstash Vector's API
      const memories = await this._fetchAllMemories(col)

      if (memories.length === 0) {
        continue
      }

      // Calculate stats
      let totalConfidence = 0
      let totalUpvotes = 0
      let totalDownvotes = 0
      let totalCitations = 0
      let totalSuccessRate = 0

      for (const mem of memories) {
        const confidence = calculateConfidence(mem)
        totalConfidence += confidence
        totalUpvotes += mem.metadata.votes.upvotes
        totalDownvotes += mem.metadata.votes.downvotes
        totalCitations += mem.metadata.votes.citations
        totalSuccessRate += mem.metadata.votes.success_rate
      }

      stats[col] = {
        count: memories.length,
        avg_confidence: totalConfidence / memories.length,
        total_upvotes: totalUpvotes,
        total_downvotes: totalDownvotes,
        total_citations: totalCitations,
        avg_success_rate: totalSuccessRate / memories.length,
      }
    }

    return stats
  },

  /**
   * Prune low-quality memories
   *
   * Removes memories that meet ANY of the following criteria:
   * - Below min_confidence AND older than min_age_days
   * - Exceeds max_downvotes (regardless of age)
   *
   * @param options - Pruning options
   * @returns Result with count and IDs of deleted memories
   */
  async prune(options: PruneOptions = {}): Promise<PruneResult> {
    const {
      collection,
      min_confidence = 0.1,
      min_age_days = 30,
      max_downvotes,
    } = options

    const collections = collection
      ? [collection]
      : await this._listCollections()
    const deletedIds: string[] = []

    for (const col of collections) {
      const memories = await this._fetchAllMemories(col)

      for (const memory of memories) {
        let shouldDelete = false

        // Check downvotes threshold (regardless of age)
        if (
          max_downvotes !== undefined &&
          memory.metadata.votes.downvotes > max_downvotes
        ) {
          shouldDelete = true
        }

        // Check confidence + age threshold
        if (!shouldDelete) {
          const confidence = calculateConfidence(memory)
          const createdAt = new Date(memory.metadata.created_at)
          const lastValidatedAt = memory.metadata.last_validated_at
            ? new Date(memory.metadata.last_validated_at)
            : undefined
          const referenceDate = lastValidatedAt || createdAt
          const ageDays =
            (Date.now() - referenceDate.getTime()) / (24 * 60 * 60 * 1000)

          if (confidence < min_confidence && ageDays >= min_age_days) {
            shouldDelete = true
          }
        }

        if (shouldDelete) {
          await deleteMemory(memory.id, col)
          deletedIds.push(memory.id)
        }
      }
    }

    return {
      deleted_count: deletedIds.length,
      deleted_ids: deletedIds,
    }
  },

  /**
   * Internal: List all collections (namespaces) in the index
   *
   * Note: Upstash Vector doesn't provide a native way to list namespaces.
   * This is a workaround that tries common collections and sees which ones have data.
   *
   * @returns Array of collection names
   * @private
   */
  async _listCollections(): Promise<string[]> {
    // Try common collections and filter to ones that have data
    const commonCollections = [
      'default',
      'agent',
      'human',
      'system',
      'test',
      'other',
    ]
    const collectionsWithData: string[] = []

    for (const col of commonCollections) {
      const memories = await this._fetchAllMemories(col)
      if (memories.length > 0) {
        collectionsWithData.push(col)
      }
    }

    return collectionsWithData
  },

  /**
   * Internal: Fetch all memories from a collection
   *
   * Uses a broad query to retrieve all memories in a namespace.
   * This is inefficient but necessary given Upstash Vector's API limitations.
   *
   * @param collection - Collection to fetch from
   * @returns Array of memories
   * @private
   */
  async _fetchAllMemories(collection: string): Promise<Memory[]> {
    const index = getVectorIndex()

    // Query with a broad query to get all memories
    // We use topK=10000 as a practical limit
    const results = await index.query(
      {
        data: '', // Empty query to match all
        topK: 10000,
        includeMetadata: true,
        includeData: true,
      },
      { namespace: collection }
    )

    return results.map((result) => ({
      id: String(result.id),
      content: String(result.data),
      metadata: result.metadata as Memory['metadata'],
    }))
  },
}
