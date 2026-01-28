/**
 * Knowledge search module
 *
 * Two-stage search: Vector search for semantic similarity,
 * then Redis for full article content.
 */

import { randomUUID } from 'node:crypto'
import { getRedis } from '../redis/client'
import { queryVectors, upsertVector } from '../vector/client'
import {
  KNOWLEDGE_NAMESPACE,
  type KnowledgeArticle,
  type KnowledgeArticleInput,
  type KnowledgeSearchOptions,
  type KnowledgeSearchResult,
  type KnowledgeVectorResult,
  getKnowledgeNamespace,
  getKnowledgeRedisKey,
} from './types'

/**
 * Default search configuration
 */
const SEARCH_DEFAULTS = {
  /** Number of results to fetch from vector search */
  VECTOR_TOP_K: 8,
  /** Minimum similarity score */
  MIN_SCORE: 0.65,
  /** Final number of results to return */
  RESULT_LIMIT: 3,
} as const

/**
 * Build filter string for vector query
 */
function buildFilter(
  options: KnowledgeSearchOptions,
  namespace: string
): string | undefined {
  const filters: string[] = []

  // Always filter by namespace (embedded in metadata as appId)
  // For shared namespace, we use 'shared' as the marker
  const appIdFilter =
    namespace === KNOWLEDGE_NAMESPACE.SHARED ? 'shared' : options.appId
  filters.push(`appId = "${appIdFilter}"`)

  if (options.category) {
    filters.push(`category = "${options.category}"`)
  }

  if (options.source) {
    filters.push(`source = "${options.source}"`)
  }

  return filters.length > 0 ? filters.join(' AND ') : undefined
}

/**
 * Search a single namespace for knowledge articles
 */
async function searchNamespace(
  query: string,
  namespace: string,
  options: KnowledgeSearchOptions
): Promise<KnowledgeVectorResult[]> {
  const filter = buildFilter(options, namespace)

  const results = await queryVectors({
    data: query,
    topK: SEARCH_DEFAULTS.VECTOR_TOP_K,
    includeMetadata: true,
    includeData: true,
    filter,
  })

  return results
    .filter((r) => r.score >= (options.minScore ?? SEARCH_DEFAULTS.MIN_SCORE))
    .map((r) => ({
      id: r.id,
      score: r.score,
      data: r.data,
      metadata: r.metadata as KnowledgeVectorResult['metadata'],
    }))
}

/**
 * Hydrate vector results with full content from Redis
 */
async function hydrateResults(
  vectorResults: KnowledgeVectorResult[],
  namespace: string
): Promise<KnowledgeSearchResult[]> {
  if (vectorResults.length === 0) {
    return []
  }

  const redis = getRedis()
  const results: KnowledgeSearchResult[] = []

  // Fetch full articles from Redis
  for (const result of vectorResults) {
    const key = getKnowledgeRedisKey(result.id, namespace)
    const article = await redis.hgetall(key)

    if (!article || Object.keys(article).length === 0) {
      // Article not found in Redis, skip
      continue
    }

    // Parse stored article
    const parsedArticle = article as unknown as {
      id: string
      title: string
      question: string
      answer: string
      appId: string
      metadata: string
    }

    let metadata: KnowledgeArticle['metadata']
    try {
      metadata =
        typeof parsedArticle.metadata === 'string'
          ? JSON.parse(parsedArticle.metadata)
          : parsedArticle.metadata
    } catch {
      // Invalid metadata, use defaults
      metadata = {
        source: 'manual',
        created_at: new Date().toISOString(),
        tags: [],
      }
    }

    results.push({
      id: result.id,
      text: parsedArticle.answer,
      score: result.score,
      metadata: {
        ...metadata,
        title: parsedArticle.title,
        question: parsedArticle.question,
        appId: parsedArticle.appId,
      },
    })
  }

  return results
}

/**
 * Search knowledge base
 *
 * Queries both app-specific and shared namespaces (if enabled),
 * ranks by relevance, and returns top results with full content.
 *
 * @param query - Search query text
 * @param options - Search options
 * @returns Array of search results with full article content
 */
export async function searchKnowledge(
  query: string,
  options: KnowledgeSearchOptions
): Promise<KnowledgeSearchResult[]> {
  const {
    appId,
    limit = SEARCH_DEFAULTS.RESULT_LIMIT,
    includeShared = true,
  } = options
  const appNamespace = getKnowledgeNamespace(appId)

  // Search app-specific namespace
  const appResults = await searchNamespace(query, appNamespace, options)

  // Optionally search shared namespace
  let sharedResults: KnowledgeVectorResult[] = []
  if (includeShared) {
    sharedResults = await searchNamespace(
      query,
      KNOWLEDGE_NAMESPACE.SHARED,
      options
    )
  }

  // Combine and sort by score
  const allVectorResults = [...appResults, ...sharedResults].sort(
    (a, b) => b.score - a.score
  )

  // Take top results before hydration
  const topVectorResults = allVectorResults.slice(0, limit)

  // Track which namespace each result came from for hydration
  const appIds = new Set(appResults.map((r) => r.id))

  // Hydrate results from appropriate namespace
  const hydratedResults: KnowledgeSearchResult[] = []

  for (const result of topVectorResults) {
    const namespace = appIds.has(result.id)
      ? appNamespace
      : KNOWLEDGE_NAMESPACE.SHARED
    const hydrated = await hydrateResults([result], namespace)
    hydratedResults.push(...hydrated)
  }

  return hydratedResults
}

/**
 * Store a knowledge article
 *
 * Stores searchable content in vector index and full article in Redis.
 *
 * @param input - Article input
 * @returns The created article
 */
export async function storeKnowledgeArticle(
  input: KnowledgeArticleInput
): Promise<KnowledgeArticle> {
  const now = new Date().toISOString()
  const id = randomUUID()

  const namespace = input.shared
    ? KNOWLEDGE_NAMESPACE.SHARED
    : getKnowledgeNamespace(input.appId)

  const article: KnowledgeArticle = {
    id,
    title: input.title,
    question: input.question,
    answer: input.answer,
    appId: input.appId,
    metadata: {
      source: input.source,
      category: input.category,
      created_at: now,
      updated_at: now,
      tags: input.tags ?? [],
      trust_score: input.trust_score ?? 1.0,
      usage_count: 0,
    },
  }

  // Store in vector index (title + question for embedding)
  const searchableText = `${input.title}\n\n${input.question}`
  await upsertVector({
    id,
    data: searchableText,
    metadata: {
      type: 'knowledge',
      appId: input.shared ? 'shared' : input.appId,
      // Map knowledge categories to vector categories where possible
      category: input.category as
        | 'refund'
        | 'license'
        | 'access'
        | 'billing'
        | 'technical'
        | 'other'
        | undefined,
      source: input.source as
        | 'docs'
        | 'faq'
        | 'policy'
        | 'canned-response'
        | undefined,
      trustScore: input.trust_score ?? 1.0,
    },
  })

  // Store full article in Redis hash
  const redis = getRedis()
  const key = getKnowledgeRedisKey(id, namespace)
  await redis.hset(key, {
    id: article.id,
    title: article.title,
    question: article.question,
    answer: article.answer,
    appId: article.appId,
    metadata: JSON.stringify(article.metadata),
  })

  return article
}

/**
 * Get a knowledge article by ID
 *
 * @param id - Article ID
 * @param appId - App ID (to determine namespace)
 * @param shared - Whether to look in shared namespace
 * @returns The article or null if not found
 */
export async function getKnowledgeArticle(
  id: string,
  appId: string,
  shared = false
): Promise<KnowledgeArticle | null> {
  const namespace = shared
    ? KNOWLEDGE_NAMESPACE.SHARED
    : getKnowledgeNamespace(appId)

  const redis = getRedis()
  const key = getKnowledgeRedisKey(id, namespace)
  const data = await redis.hgetall(key)

  if (!data || Object.keys(data).length === 0) {
    return null
  }

  const parsed = data as unknown as {
    id: string
    title: string
    question: string
    answer: string
    appId: string
    metadata: string
  }

  return {
    id: parsed.id,
    title: parsed.title,
    question: parsed.question,
    answer: parsed.answer,
    appId: parsed.appId,
    metadata: JSON.parse(parsed.metadata),
  }
}

/**
 * Delete a knowledge article
 *
 * Removes from both vector index and Redis.
 *
 * @param id - Article ID
 * @param appId - App ID
 * @param shared - Whether article is in shared namespace
 */
export async function deleteKnowledgeArticle(
  id: string,
  appId: string,
  shared = false
): Promise<void> {
  const namespace = shared
    ? KNOWLEDGE_NAMESPACE.SHARED
    : getKnowledgeNamespace(appId)

  // Delete from Redis
  const redis = getRedis()
  const key = getKnowledgeRedisKey(id, namespace)
  await redis.del(key)

  // Note: Vector deletion would require the Index.delete() method
  // which isn't exposed in our current client. Add if needed.
}

/**
 * Record usage of a knowledge article
 *
 * Increments usage count and updates last cited timestamp.
 *
 * @param id - Article ID
 * @param appId - App ID
 * @param shared - Whether article is in shared namespace
 */
export async function recordKnowledgeUsage(
  id: string,
  appId: string,
  shared = false
): Promise<void> {
  const namespace = shared
    ? KNOWLEDGE_NAMESPACE.SHARED
    : getKnowledgeNamespace(appId)

  const redis = getRedis()
  const key = getKnowledgeRedisKey(id, namespace)

  // Get current article
  const data = await redis.hgetall(key)
  if (!data || Object.keys(data).length === 0) {
    return
  }

  const parsed = data as unknown as {
    metadata: string
  }

  const metadata = JSON.parse(parsed.metadata)
  metadata.usage_count = (metadata.usage_count ?? 0) + 1
  metadata.last_cited_at = new Date().toISOString()

  await redis.hset(key, {
    metadata: JSON.stringify(metadata),
  })
}
