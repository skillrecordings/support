import { randomUUID } from 'node:crypto'
import {
  type QueryMemoriesOptions,
  deleteMemory,
  fetchMemory,
  queryMemories,
  upsertMemory,
} from './client'
import { calculateConfidence } from './decay'
import type { Memory, MemoryMetadata, SearchResult } from './schemas'

/**
 * Options for searching memories
 */
export interface SearchOptions {
  /** Collection (namespace) to search in */
  collection: string
  /** Number of results to return (default: 10) */
  limit?: number
  /** Minimum similarity score threshold (default: 0.5) */
  threshold?: number
  /** Filter by app slug */
  app_slug?: string
  /** Filter by tags (AND logic) */
  tags?: string[]
  /** Include low-confidence memories (<25%) (default: false) */
  include_stale?: boolean
}

/**
 * Metadata for storing a new memory
 */
export interface StoreMetadata extends Partial<MemoryMetadata> {
  collection: string
  source: 'agent' | 'human' | 'system'
}

/**
 * Memory Service
 *
 * Provides high-level operations for storing and retrieving memories
 * with semantic search, decay scoring, and metadata filtering.
 */
export const MemoryService = {
  /**
   * Store a new memory with embedding generation
   *
   * @param content - The memory content to store
   * @param metadata - Memory metadata (collection and source required)
   * @returns The created memory with generated ID and timestamps
   */
  async store(content: string, metadata: StoreMetadata): Promise<Memory> {
    const now = new Date().toISOString()

    const memory: Memory = {
      id: randomUUID(),
      content,
      metadata: {
        collection: metadata.collection,
        source: metadata.source,
        app_slug: metadata.app_slug,
        tags: metadata.tags ?? [],
        confidence: metadata.confidence ?? 1,
        created_at: metadata.created_at ?? now,
        last_validated_at: metadata.last_validated_at,
        votes: metadata.votes ?? {
          upvotes: 0,
          downvotes: 0,
          citations: 0,
          success_rate: 0,
        },
      },
    }

    await upsertMemory(memory)
    return memory
  },

  /**
   * Find memories by semantic similarity
   *
   * Queries the vector index, fetches full memory data, calculates
   * confidence with time decay, filters by threshold, and sorts by final score.
   *
   * @param query - Search query text
   * @param options - Search options including filters and limits
   * @returns Array of search results with decay-adjusted scores
   */
  async find(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const {
      collection,
      limit = 10,
      threshold = 0.5,
      app_slug,
      tags,
      include_stale = false,
    } = options

    // Build metadata filter expression
    let filter: string | undefined
    if (app_slug || tags) {
      const filters: string[] = []
      if (app_slug) {
        filters.push(`app_slug = "${app_slug}"`)
      }
      if (tags && tags.length > 0) {
        tags.forEach((tag) => {
          filters.push(`tags[*] = "${tag}"`)
        })
      }
      filter = filters.join(' AND ')
    }

    // Query vector index
    const queryResults = await queryMemories({
      query,
      collection,
      topK: limit * 2, // Over-fetch to account for filtering
      filter,
    })

    // Fetch full memories and calculate confidence scores
    const results: SearchResult[] = []

    for (const result of queryResults) {
      const memory = await fetchMemory(result.id, collection)
      if (!memory) continue

      // Calculate confidence with time decay
      const confidence = calculateConfidence(memory)

      // Filter by confidence threshold (25% for stale)
      if (!include_stale && confidence < 0.25) continue

      // Calculate age in days
      const createdAt = new Date(memory.metadata.created_at)
      const lastValidatedAt = memory.metadata.last_validated_at
        ? new Date(memory.metadata.last_validated_at)
        : undefined
      const referenceDate = lastValidatedAt || createdAt
      const ageDays =
        (Date.now() - referenceDate.getTime()) / (24 * 60 * 60 * 1000)

      // Calculate decay factor (used in confidence calculation)
      const decayFactor = Math.pow(0.5, ageDays / 30)

      // Final score combines similarity with confidence
      const finalScore = result.score * confidence

      // Filter by threshold
      if (finalScore < threshold) continue

      results.push({
        memory,
        score: finalScore,
        raw_score: result.score,
        age_days: ageDays,
        decay_factor: decayFactor,
      })
    }

    // Sort by final score descending
    results.sort((a, b) => b.score - a.score)

    // Limit results
    return results.slice(0, limit)
  },

  /**
   * Get a specific memory by ID
   *
   * @param id - Memory ID
   * @param collection - Collection the memory belongs to
   * @returns The memory or null if not found
   */
  async get(id: string, collection: string): Promise<Memory | null> {
    return fetchMemory(id, collection)
  },

  /**
   * Delete a memory
   *
   * @param id - Memory ID to delete
   * @param collection - Collection the memory belongs to
   */
  async delete(id: string, collection: string): Promise<void> {
    await deleteMemory(id, collection)
  },

  /**
   * Validate a memory (resets decay clock)
   *
   * Updates the last_validated_at timestamp to the current time,
   * which resets the time-based decay calculation.
   *
   * @param id - Memory ID to validate
   * @param collection - Collection the memory belongs to
   * @throws {Error} If memory not found
   */
  async validate(id: string, collection: string): Promise<void> {
    const memory = await fetchMemory(id, collection)
    if (!memory) {
      throw new Error('Memory not found')
    }

    // Update last_validated_at timestamp
    memory.metadata.last_validated_at = new Date().toISOString()

    await upsertMemory(memory)
  },
}
