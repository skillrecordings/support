/**
 * Knowledge module types
 *
 * Types for the knowledge base articles and search results.
 * Used for product-specific and shared knowledge retrieval.
 */

/**
 * Source of knowledge article
 */
export type KnowledgeSource =
  | 'docs'
  | 'faq'
  | 'policy'
  | 'canned-response'
  | 'manual'
  | 'generated'

/**
 * Category of knowledge article
 */
export type KnowledgeCategory =
  | 'refund'
  | 'license'
  | 'access'
  | 'billing'
  | 'technical'
  | 'general'
  | 'account'
  | 'content'

/**
 * Metadata for knowledge articles
 */
export interface KnowledgeMetadata {
  /** Source of the knowledge (docs, faq, policy, etc.) */
  source: KnowledgeSource
  /** Category for filtering */
  category?: KnowledgeCategory
  /** ISO timestamp when article was created */
  created_at: string
  /** ISO timestamp when article was last updated */
  updated_at?: string
  /** Tags for additional categorization */
  tags: string[]
  /** Trust score (0-1) for prioritizing results */
  trust_score?: number
  /** Number of times this article was used */
  usage_count?: number
  /** Last ISO timestamp when article was cited */
  last_cited_at?: string
  /** Index signature for Upstash compatibility */
  [key: string]: string | number | string[] | undefined
}

/**
 * Full knowledge article stored in Redis
 */
export interface KnowledgeArticle {
  /** Unique identifier */
  id: string
  /** Article title/summary */
  title: string
  /** The question or situation this addresses */
  question: string
  /** The answer or resolution */
  answer: string
  /** App identifier (e.g., 'testing-javascript', 'total-typescript') */
  appId: string
  /** Article metadata */
  metadata: KnowledgeMetadata
}

/**
 * Vector-only data stored in Upstash Vector
 * Contains searchable text and reference back to full content
 */
export interface KnowledgeVectorDocument {
  /** Same ID as KnowledgeArticle */
  id: string
  /** Searchable text (title + question for embedding) */
  data: string
  /** Minimal metadata for filtering */
  metadata: {
    type: 'knowledge'
    appId: string
    category?: KnowledgeCategory
    source: KnowledgeSource
    tags?: string[]
    trust_score?: number
    [key: string]: string | number | string[] | undefined
  }
}

/**
 * Result from vector search (before Redis hydration)
 */
export interface KnowledgeVectorResult {
  /** Article ID */
  id: string
  /** Similarity score (0-1) */
  score: number
  /** Searchable text from vector */
  data?: string
  /** Metadata from vector */
  metadata?: KnowledgeVectorDocument['metadata']
}

/**
 * Final search result with full content
 */
export interface KnowledgeSearchResult {
  /** Article ID */
  id: string
  /** Full answer text (from Redis) */
  text: string
  /** Similarity score (0-1) */
  score: number
  /** Full article metadata */
  metadata: KnowledgeMetadata & {
    /** Article title */
    title: string
    /** Original question */
    question: string
    /** App ID */
    appId: string
  }
}

/**
 * Options for knowledge search
 */
export interface KnowledgeSearchOptions {
  /** App ID to search within (also searches shared namespace) */
  appId: string
  /** Maximum number of results to return (default: 3) */
  limit?: number
  /** Minimum similarity score (default: 0.65) */
  minScore?: number
  /** Filter by category */
  category?: KnowledgeCategory
  /** Filter by source */
  source?: KnowledgeSource
  /** Filter by tags (any match) */
  tags?: string[]
  /** Include shared namespace results (default: true) */
  includeShared?: boolean
}

/**
 * Input for storing a knowledge article
 */
export interface KnowledgeArticleInput {
  /** Article title/summary */
  title: string
  /** The question or situation this addresses */
  question: string
  /** The answer or resolution */
  answer: string
  /** App identifier */
  appId: string
  /** Source of the knowledge */
  source: KnowledgeSource
  /** Category for filtering */
  category?: KnowledgeCategory
  /** Tags for additional categorization */
  tags?: string[]
  /** Initial trust score (default: 1.0) */
  trust_score?: number
  /** Store in shared namespace instead of app-specific */
  shared?: boolean
}

/**
 * Namespace constants
 */
export const KNOWLEDGE_NAMESPACE = {
  /** Prefix for app-specific knowledge */
  APP_PREFIX: 'knowledge:',
  /** Namespace for cross-product knowledge */
  SHARED: 'knowledge:shared',
} as const

/**
 * Get the namespace for an app
 */
export function getKnowledgeNamespace(appId: string): string {
  return `${KNOWLEDGE_NAMESPACE.APP_PREFIX}${appId}`
}

/**
 * Get the Redis key for a knowledge article
 */
export function getKnowledgeRedisKey(id: string, namespace: string): string {
  return `${namespace}:article:${id}`
}
