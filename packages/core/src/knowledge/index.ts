/**
 * Knowledge Base Module
 *
 * Two-stage retrieval system for product-specific and shared knowledge:
 * 1. Upstash Vector semantic search (topK=8, minScore=0.65)
 * 2. Redis Hash lookup for full article content (top 3)
 *
 * @example
 * ```ts
 * import { searchKnowledge, storeKnowledgeArticle } from '@support/core/knowledge'
 *
 * // Search for articles
 * const results = await searchKnowledge('how to get a refund', {
 *   appId: 'total-typescript',
 *   limit: 3,
 * })
 *
 * // Store a new article
 * await storeKnowledgeArticle({
 *   title: 'Refund Policy',
 *   question: 'How do I get a refund?',
 *   answer: 'Contact support within 30 days...',
 *   appId: 'total-typescript',
 *   source: 'policy',
 * })
 * ```
 */

// Types
export {
  KNOWLEDGE_NAMESPACE,
  getKnowledgeNamespace,
  getKnowledgeRedisKey,
  type KnowledgeArticle,
  type KnowledgeArticleInput,
  type KnowledgeCategory,
  type KnowledgeMetadata,
  type KnowledgeSearchOptions,
  type KnowledgeSearchResult,
  type KnowledgeSource,
  type KnowledgeVectorDocument,
  type KnowledgeVectorResult,
} from './types'

// Search operations
export {
  deleteKnowledgeArticle,
  getKnowledgeArticle,
  recordKnowledgeUsage,
  searchKnowledge,
  storeKnowledgeArticle,
} from './search'

// Ingest operations
export {
  PRODUCT_SOURCES,
  batchIngest,
  ingest,
  listProductSources,
  type BatchIngestResult,
  type DatabaseArticleInput,
  type IngestFormat,
  type IngestOptions,
  type IngestResult,
  type ProductSource,
} from './ingest'

// Parsers (for advanced usage)
export { scrapeHtml } from './parsers/html'
export { parseMdx, parseMdxFiles, type MdxFileInput } from './parsers/mdx'
export { parseTsx, parseTsxFiles, type TsxFileInput } from './parsers/tsx'
