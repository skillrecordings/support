import { z } from 'zod'
import { searchKnowledge as searchKnowledgeDB } from '../knowledge/search'
import type { KnowledgeSearchResult as KBSearchResult } from '../knowledge/types'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Parameters for hybrid knowledge base search.
 */
const searchKnowledgeParams = z.object({
  /**
   * Search query for semantic and keyword matching
   */
  query: z.string(),
  /**
   * App ID to scope search to specific knowledge base
   */
  appId: z.string(),
  /**
   * Maximum number of results to return
   */
  limit: z.number().optional().default(5),
  /**
   * Minimum similarity score (0-1) for semantic results
   */
  minScore: z.number().optional().default(0.7),
})

/**
 * Search result from hybrid search.
 */
export interface KnowledgeSearchResult {
  /**
   * Document/chunk ID
   */
  id: string
  /**
   * Matched content text
   */
  text: string
  /**
   * Semantic similarity score (0-1)
   */
  score: number
  /**
   * Source metadata (document title, URL, etc.)
   */
  metadata: Record<string, unknown>
}

/**
 * Map knowledge module results to tool result format.
 */
function mapToToolResult(result: KBSearchResult): KnowledgeSearchResult {
  return {
    id: result.id,
    text: result.text,
    score: result.score,
    metadata: {
      title: result.metadata.title,
      question: result.metadata.question,
      appId: result.metadata.appId,
      source: result.metadata.source,
      category: result.metadata.category,
      tags: result.metadata.tags,
      trust_score: result.metadata.trust_score,
    },
  }
}

/**
 * Search knowledge base using hybrid semantic and keyword search.
 *
 * Performs vector similarity search combined with BM25 keyword matching
 * via Upstash Vector to find relevant documentation and past solutions.
 *
 * @example
 * ```typescript
 * const results = await searchKnowledge.execute({
 *   query: 'How do I reset my password?',
 *   appId: 'totaltypescript',
 *   limit: 5,
 *   minScore: 0.7
 * }, context)
 * ```
 */
export const searchKnowledge = createTool({
  name: 'search_knowledge',
  description:
    'Search knowledge base using hybrid semantic and keyword search to find relevant documentation and past solutions',
  parameters: searchKnowledgeParams,
  execute: async (
    params,
    _context: ExecutionContext
  ): Promise<KnowledgeSearchResult[]> => {
    const { query, appId, limit, minScore } = params

    const results = await searchKnowledgeDB(query, {
      appId,
      limit,
      minScore,
      includeShared: true,
    })

    return results.map(mapToToolResult)
  },
})
