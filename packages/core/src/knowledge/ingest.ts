/**
 * Knowledge Base Ingest Orchestrator
 *
 * Central entry point for ingesting content from various sources
 * and formats into the knowledge base.
 */

import { scrapeHtml } from './parsers/html'
import { type MdxFileInput, parseMdx, parseMdxFiles } from './parsers/mdx'
import { type TsxFileInput, parseTsx, parseTsxFiles } from './parsers/tsx'
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeSource,
} from './types'

/**
 * Supported ingest formats
 */
export type IngestFormat = 'mdx' | 'tsx' | 'html' | 'database'

/**
 * Product source configuration
 */
export interface ProductSource {
  appId: string
  format: IngestFormat
  defaultSource?: KnowledgeSource
  defaultCategory?: KnowledgeCategory
  /** URLs to fetch FAQ content from */
  sourceUrls?: string[]
  /** File paths for local content (relative to project root) */
  sourcePaths?: string[]
  /** Whether this source is enabled for sync */
  enabled?: boolean
}

/**
 * Known product source configurations
 *
 * Source URLs point to raw FAQ content endpoints or pages.
 * For MDX/TSX: expects raw file content or GitHub raw URLs
 * For HTML: expects rendered FAQ pages to scrape
 */
export const PRODUCT_SOURCES: Record<string, ProductSource> = {
  'total-typescript': {
    appId: 'total-typescript',
    format: 'mdx',
    defaultSource: 'faq',
    defaultCategory: 'content',
    sourceUrls: [
      // Product-specific FAQs only (shared content in 'shared' namespace)
      'file:///home/joel/Code/skillrecordings/support/data/kb/total-typescript-faq.mdx',
    ],
    enabled: true,
  },
  'epic-react': {
    appId: 'epic-react',
    format: 'tsx',
    defaultSource: 'faq',
    defaultCategory: 'content',
    sourceUrls: [
      'https://raw.githubusercontent.com/skillrecordings/products/main/apps/epic-react/src/pages/faq.tsx',
    ],
    enabled: true,
  },
  'epic-web': {
    appId: 'epic-web',
    format: 'tsx',
    defaultSource: 'faq',
    defaultCategory: 'content',
    sourceUrls: [
      'https://raw.githubusercontent.com/skillrecordings/products/main/apps/epic-web/src/pages/faq.tsx',
    ],
    enabled: true,
  },
  'ai-hero': {
    appId: 'ai-hero',
    format: 'mdx',
    defaultSource: 'faq',
    defaultCategory: 'content',
    sourceUrls: [
      // Local file extracted from AI Hero database
      'file:///home/joel/Code/skillrecordings/support/data/kb/ai-hero-faq.mdx',
    ],
    enabled: true,
  },
  'shared': {
    appId: 'shared',
    format: 'mdx',
    defaultSource: 'faq',
    defaultCategory: 'content',
    sourceUrls: [
      // Cross-product FAQ content (PPP, team seats, gifting, etc.)
      'file:///home/joel/Code/skillrecordings/support/data/kb/shared-faq.mdx',
    ],
    enabled: true,
  },
  'testing-accessibility': {
    appId: 'testing-accessibility',
    format: 'html',
    defaultSource: 'docs',
    defaultCategory: 'technical',
    sourceUrls: ['https://testingaccessibility.com/faq'],
    enabled: true,
  },
}

/**
 * Pre-formed article input for database format
 */
export interface DatabaseArticleInput {
  title: string
  question: string
  answer: string
  category?: KnowledgeCategory
  tags?: string[]
  trust_score?: number
}

/**
 * Options for ingest operation
 */
export interface IngestOptions {
  /** Product identifier */
  productId: string
  /** Content format (auto-detected for known products) */
  format?: IngestFormat
  /** Raw content for MDX/TSX/HTML */
  content?: string | MdxFileInput[] | TsxFileInput[]
  /** Pre-formed articles for database format */
  articles?: DatabaseArticleInput[]
  /** Override default source */
  source?: KnowledgeSource
  /** Override default category */
  category?: KnowledgeCategory
}

/**
 * Result of ingest operation
 */
export interface IngestResult {
  appId: string
  format: IngestFormat
  articles: KnowledgeArticle[]
  errors: Array<{ message: string; context?: unknown }>
}

/**
 * Result of batch ingest operation
 */
export interface BatchIngestResult {
  totalCount: number
  byProduct: Record<string, number>
  articles: KnowledgeArticle[]
  errors: Array<{ productId: string; message: string; context?: unknown }>
}

/**
 * Helper to slugify text for IDs
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

/**
 * Ingest content into knowledge base
 *
 * @param options - Ingest options
 * @returns Ingest result with articles and any errors
 */
export async function ingest(options: IngestOptions): Promise<IngestResult> {
  const {
    productId,
    content,
    articles: inputArticles,
    source,
    category,
  } = options

  // Get product config or use provided format
  const productConfig = PRODUCT_SOURCES[productId]
  const format = options.format || productConfig?.format

  if (!format) {
    throw new Error(`Unknown product: ${productId}. Provide explicit format.`)
  }

  // Validate required inputs before processing
  if ((format === 'mdx' || format === 'tsx') && !content) {
    throw new Error(`${format.toUpperCase()} format requires content`)
  }
  if (format === 'html' && (!content || typeof content !== 'string')) {
    throw new Error('HTML format requires string content')
  }
  if (format === 'database' && !inputArticles) {
    throw new Error('Database format requires articles array')
  }

  const defaultSource = source || productConfig?.defaultSource || 'docs'
  const defaultCategory = category || productConfig?.defaultCategory

  const appId = productId
  const errors: IngestResult['errors'] = []
  let articles: KnowledgeArticle[] = []

  try {
    switch (format) {
      case 'mdx': {
        if (
          Array.isArray(content) &&
          typeof content[0] === 'object' &&
          'filePath' in content[0]
        ) {
          // Multiple files
          articles = await parseMdxFiles(content as MdxFileInput[], appId, {
            defaultSource,
            defaultCategory,
          })
        } else if (typeof content === 'string') {
          // Single content string
          articles = await parseMdx(content, appId, {
            defaultSource,
            defaultCategory,
          })
        } else {
          throw new Error('Invalid MDX content format')
        }
        break
      }

      case 'tsx': {
        if (
          Array.isArray(content) &&
          typeof content[0] === 'object' &&
          'filePath' in content[0]
        ) {
          // Multiple files
          articles = await parseTsxFiles(content as TsxFileInput[], appId, {
            defaultSource,
            defaultCategory,
          })
        } else if (typeof content === 'string') {
          // Single content string
          articles = await parseTsx(content, appId, {
            defaultSource,
            defaultCategory,
          })
        } else {
          throw new Error('Invalid TSX content format')
        }
        break
      }

      case 'html': {
        articles = await scrapeHtml(content as string, appId, {
          defaultSource,
          defaultCategory,
          splitSections: true,
        })
        break
      }

      case 'database': {
        const now = new Date().toISOString()
        articles = inputArticles!.map((input, index) => ({
          id: `kb-${appId}-db-${index}-${slugify(input.title)}`,
          title: input.title,
          question: input.question,
          answer: input.answer,
          appId,
          metadata: {
            source: defaultSource,
            category: input.category || defaultCategory,
            created_at: now,
            updated_at: now,
            tags: input.tags || [],
            trust_score: input.trust_score ?? 1.0,
          },
        }))
        break
      }

      default:
        throw new Error(`Unsupported format: ${format}`)
    }
  } catch (error) {
    errors.push({
      message: error instanceof Error ? error.message : String(error),
      context: { productId, format },
    })
  }

  return { appId, format, articles, errors }
}

/**
 * Batch ingest from multiple sources
 *
 * @param sources - Array of ingest options
 * @returns Combined result with all articles and errors
 */
export async function batchIngest(
  sources: IngestOptions[]
): Promise<BatchIngestResult> {
  const allArticles: KnowledgeArticle[] = []
  const byProduct: Record<string, number> = {}
  const errors: BatchIngestResult['errors'] = []

  for (const source of sources) {
    try {
      const result = await ingest(source)
      allArticles.push(...result.articles)
      byProduct[result.appId] =
        (byProduct[result.appId] || 0) + result.articles.length

      for (const error of result.errors) {
        errors.push({
          productId: source.productId,
          message: error.message,
          context: error.context,
        })
      }
    } catch (error) {
      errors.push({
        productId: source.productId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    totalCount: allArticles.length,
    byProduct,
    articles: allArticles,
    errors,
  }
}

/**
 * List all known product sources
 *
 * @returns Array of product source configurations
 */
export function listProductSources(): ProductSource[] {
  return Object.values(PRODUCT_SOURCES)
}
