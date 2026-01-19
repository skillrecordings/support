import { Index } from '@upstash/vector'
import type { Memory, MemoryMetadata } from './schemas'

/**
 * Lazy-initialized Upstash Vector index singleton.
 * Use this pattern to avoid creating connections at import time in serverless environments.
 */
let _index: Index | null = null

/**
 * Get or create the Upstash Vector index instance.
 * Uses lazy initialization to defer connection until first use.
 *
 * @throws {Error} If UPSTASH_VECTOR_REST_URL or UPSTASH_VECTOR_REST_TOKEN env vars are missing
 */
export function getVectorIndex(): Index {
  if (!_index) {
    const url = process.env.UPSTASH_VECTOR_REST_URL
    const token = process.env.UPSTASH_VECTOR_REST_TOKEN

    if (!url) {
      throw new Error(
        'UPSTASH_VECTOR_REST_URL environment variable is required'
      )
    }
    if (!token) {
      throw new Error(
        'UPSTASH_VECTOR_REST_TOKEN environment variable is required'
      )
    }

    _index = new Index({
      url,
      token,
    })
  }

  return _index
}

/**
 * Upsert a memory into the vector index.
 * Uses Upstash hosted embeddings by passing data string instead of vector.
 *
 * @param memory - The memory to upsert
 * @returns Promise resolving to the upsert result
 */
export async function upsertMemory(memory: Memory): Promise<unknown> {
  const index = getVectorIndex()
  return index.upsert(
    {
      id: memory.id,
      data: memory.content, // Upstash generates embedding from data string
      metadata: memory.metadata,
    },
    { namespace: memory.metadata.collection }
  )
}

/**
 * Options for querying memories
 */
export interface QueryMemoriesOptions {
  /** The search query text */
  query: string
  /** Collection (namespace) to search in */
  collection: string
  /** Number of results to return */
  topK?: number
  /** Metadata filter expression */
  filter?: string
}

/**
 * Query result with memory metadata
 */
export interface QueryMemoryResult {
  id: string
  score: number
  metadata: MemoryMetadata
}

/**
 * Query memories by semantic similarity.
 *
 * @param options - Query options including search text, collection, topK, and filters
 * @returns Promise resolving to array of query results
 */
export async function queryMemories(
  options: QueryMemoriesOptions
): Promise<QueryMemoryResult[]> {
  const index = getVectorIndex()
  const { query, collection, topK = 10, filter } = options

  const results = await index.query(
    {
      data: query, // Upstash generates embedding from query string
      topK,
      includeMetadata: true,
      ...(filter && { filter }),
    },
    { namespace: collection }
  )

  return results.map((result) => ({
    id: String(result.id),
    score: result.score,
    metadata: result.metadata as MemoryMetadata,
  }))
}

/**
 * Delete a memory by ID.
 *
 * @param id - The memory ID to delete
 * @param collection - The collection (namespace) the memory belongs to
 * @returns Promise resolving when deletion is complete
 */
export async function deleteMemory(
  id: string,
  collection: string
): Promise<void> {
  const index = getVectorIndex()
  await index.delete(id, { namespace: collection })
}

/**
 * Fetch a memory by ID.
 *
 * @param id - The memory ID to fetch
 * @param collection - The collection (namespace) the memory belongs to
 * @returns Promise resolving to the memory or null if not found
 */
export async function fetchMemory(
  id: string,
  collection: string
): Promise<Memory | null> {
  const index = getVectorIndex()
  const results = await index.fetch([id], {
    namespace: collection,
    includeMetadata: true,
    includeData: true,
  })

  if (results.length === 0) {
    return null
  }

  const result = results[0]
  if (!result) {
    return null
  }

  return {
    id: String(result.id),
    content: String(result.data),
    metadata: result.metadata as MemoryMetadata,
  }
}
