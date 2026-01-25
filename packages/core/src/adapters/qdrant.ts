/**
 * Qdrant vector database adapter for local eval environment
 * Provides similar API to production vector store for testing
 */

import { z } from 'zod'

export interface QdrantConfig {
  url: string
  collection: string
}

export interface QdrantPoint {
  id: string
  vector: number[]
  payload: Record<string, unknown>
}

export interface QdrantSearchResult {
  id: string
  score: number
  payload: Record<string, unknown>
}

/**
 * Qdrant client for local eval environment
 */
export class QdrantClient {
  private baseUrl: string
  private collection: string

  constructor(config: QdrantConfig) {
    this.baseUrl = config.url.replace(/\/$/, '')
    this.collection = config.collection
  }

  /**
   * Create collection if it doesn't exist
   */
  async ensureCollection(vectorSize: number = 768): Promise<void> {
    // Check if collection exists
    const existsRes = await fetch(
      `${this.baseUrl}/collections/${this.collection}`
    )

    if (existsRes.status === 404) {
      // Create collection
      const createRes = await fetch(
        `${this.baseUrl}/collections/${this.collection}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vectors: {
              size: vectorSize,
              distance: 'Cosine',
            },
          }),
        }
      )

      if (!createRes.ok) {
        const error = await createRes.text()
        throw new Error(`Failed to create Qdrant collection: ${error}`)
      }
    }
  }

  /**
   * Upsert points into the collection
   */
  async upsert(points: QdrantPoint[]): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/collections/${this.collection}/points`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: points.map((p) => ({
            id: p.id,
            vector: p.vector,
            payload: p.payload,
          })),
        }),
      }
    )

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Failed to upsert points: ${error}`)
    }
  }

  /**
   * Search for similar vectors
   */
  async search(
    vector: number[],
    limit: number = 5,
    filter?: Record<string, unknown>
  ): Promise<QdrantSearchResult[]> {
    const body: Record<string, unknown> = {
      vector,
      limit,
      with_payload: true,
    }

    if (filter) {
      body.filter = filter
    }

    const res = await fetch(
      `${this.baseUrl}/collections/${this.collection}/points/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Failed to search: ${error}`)
    }

    const data = (await res.json()) as {
      result: Array<{
        id: string
        score: number
        payload: Record<string, unknown>
      }>
    }
    return data.result.map((r) => ({
      id: r.id,
      score: r.score,
      payload: r.payload,
    }))
  }

  /**
   * Delete collection
   */
  async deleteCollection(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: 'DELETE',
    })

    // 404 is ok - collection doesn't exist
    if (!res.ok && res.status !== 404) {
      const error = await res.text()
      throw new Error(`Failed to delete collection: ${error}`)
    }
  }

  /**
   * Get collection info
   */
  async getCollectionInfo(): Promise<{
    pointsCount: number
    status: string
  }> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}`)

    if (res.status === 404) {
      return { pointsCount: 0, status: 'not_found' }
    }

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Failed to get collection info: ${error}`)
    }

    const data = (await res.json()) as {
      result?: { points_count?: number; status?: string }
    }
    return {
      pointsCount: data.result?.points_count ?? 0,
      status: data.result?.status ?? 'unknown',
    }
  }
}

/**
 * Create Qdrant client from environment
 */
export function createQdrantClient(): QdrantClient {
  const url = process.env.QDRANT_URL || 'http://localhost:6333'
  const collection = process.env.QDRANT_COLLECTION || 'support_eval'

  return new QdrantClient({ url, collection })
}
