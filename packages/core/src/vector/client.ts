import { Index } from '@upstash/vector'
import type {
  VectorDocument,
  VectorDocumentMetadata,
  VectorQueryResult,
} from './types'

/**
 * Lazy-initialized Upstash Vector index singleton.
 * Use this pattern to avoid creating connections at import time in serverless environments.
 */
let _index: Index | null = null

/**
 * Get or create the Upstash Vector index instance.
 * Uses lazy initialization to defer connection until first use.
 *
 * @throws {Error} If UPSTASH_VECTOR_URL or UPSTASH_VECTOR_TOKEN env vars are missing
 */
export function getVectorIndex(): Index {
  if (!_index) {
    const url = process.env.UPSTASH_VECTOR_URL
    const token = process.env.UPSTASH_VECTOR_TOKEN

    if (!url) {
      throw new Error('UPSTASH_VECTOR_URL environment variable is required')
    }
    if (!token) {
      throw new Error('UPSTASH_VECTOR_TOKEN environment variable is required')
    }

    _index = new Index({
      url,
      token,
    })
  }

  return _index
}

/**
 * Options for querying vectors
 */
export interface QueryVectorsOptions {
  /** The search query text */
  data: string
  /** Number of results to return */
  topK: number
  /** Include metadata in results */
  includeMetadata?: boolean
  /** Include data in results */
  includeData?: boolean
  /** Metadata filter expression */
  filter?: string
}

/**
 * Upsert a vector document into the index.
 *
 * @param document - The vector document to upsert
 * @returns Promise resolving to the upsert result
 */
export async function upsertVector(document: VectorDocument): Promise<unknown> {
  const index = getVectorIndex()
  return index.upsert({
    id: document.id,
    data: document.data,
    metadata: document.metadata,
  })
}

/**
 * Query vectors by semantic similarity.
 *
 * @param options - Query options including search text, topK, and filters
 * @returns Promise resolving to array of query results
 */
export async function queryVectors(
  options: QueryVectorsOptions
): Promise<VectorQueryResult[]> {
  const index = getVectorIndex()
  const results = await index.query(options)

  return results.map((result) => ({
    id: String(result.id),
    score: result.score,
    data: result.data,
    metadata: result.metadata as VectorDocumentMetadata | undefined,
  }))
}
