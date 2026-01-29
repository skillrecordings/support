/**
 * MDX Parser for Knowledge Base
 *
 * Extracts Q&A pairs from MDX content with frontmatter support.
 * Uses gray-matter for frontmatter parsing.
 */

import matter from 'gray-matter'
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeSource,
} from '../types'

/**
 * Options for MDX parsing
 */
export interface MdxParserOptions {
  /** Default source if not specified in frontmatter */
  defaultSource?: KnowledgeSource
  /** Default category if not specified in frontmatter */
  defaultCategory?: KnowledgeCategory
  /** Default trust score (0-1) */
  defaultTrustScore?: number
}

/**
 * Frontmatter schema expected in MDX files
 */
interface MdxFrontmatter {
  title?: string
  slug?: string
  question?: string
  category?: KnowledgeCategory
  source?: KnowledgeSource
  tags?: string[]
  trust_score?: number
  created_at?: string
  updated_at?: string
}

/**
 * File input for batch processing
 */
export interface MdxFileInput {
  content: string
  filePath: string
}

/**
 * Slugify a string for ID generation
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

/**
 * Extract title from first H1 heading
 */
function extractTitleFromContent(content: string): string | null {
  const h1Match = content.match(/^#\s+(.+)$/m)
  return h1Match ? h1Match[1]!.trim() : null
}

/**
 * Extract first paragraph as question/summary
 */
function extractFirstParagraph(content: string): string | null {
  // Remove H1 heading first
  const withoutH1 = content.replace(/^#\s+.+$/m, '').trim()

  // Split into paragraphs and find first non-empty one
  const paragraphs = withoutH1.split(/\n\n+/)
  for (const p of paragraphs) {
    const trimmed = p.trim()
    // Skip if it's a heading, code block, or list
    if (
      trimmed &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('```') &&
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('*')
    ) {
      return trimmed
    }
  }
  return null
}

/**
 * Split content by <div> blocks (FAQ format)
 * Returns array of content blocks, or null if no div blocks found
 */
function splitByDivBlocks(content: string): string[] | null {
  // Match <div>...</div> blocks (non-greedy, multiline)
  const divPattern = /<div>\s*([\s\S]*?)\s*<\/div>/gi
  const matches = [...content.matchAll(divPattern)]
  
  if (matches.length === 0) {
    return null
  }
  
  return matches.map(m => m[1]!.trim()).filter(block => block.length > 0)
}

/**
 * Split content by ## headings (alternative FAQ format)
 * Returns array of Q&A blocks, or null if not enough headings found
 */
function splitByH2Headings(content: string): string[] | null {
  // Split by ## headings, keeping the heading with each block
  const blocks = content.split(/(?=^## )/m).filter(block => block.trim().length > 0)
  
  // Only use this format if we have multiple H2 sections
  if (blocks.length < 2) {
    return null
  }
  
  return blocks.map(block => block.trim())
}

/**
 * Extract H2 heading as question from a block
 */
function extractH2Question(content: string): string | null {
  const h2Match = content.match(/^##\s+(.+)$/m)
  return h2Match ? h2Match[1]!.trim() : null
}

/**
 * Remove H2 heading from content to get answer
 */
function removeH2Heading(content: string): string {
  return content.replace(/^##\s+.+$/m, '').trim()
}

/**
 * Generate article ID from appId and slug/title
 */
function generateId(
  appId: string,
  slug: string | undefined,
  title: string
): string {
  const slugPart = slug || slugify(title)
  return `kb-${appId}-${slugPart}`
}

/**
 * Parse a single MDX content string
 *
 * @param content - MDX content with optional frontmatter
 * @param appId - Application identifier
 * @param options - Parser options
 * @returns Array of knowledge articles (usually 1 per file, but multiple for FAQ format)
 */
export async function parseMdx(
  content: string,
  appId: string,
  options: MdxParserOptions = {}
): Promise<KnowledgeArticle[]> {
  const {
    defaultSource = 'docs',
    defaultCategory,
    defaultTrustScore = 1.0,
  } = options

  // Parse frontmatter
  const { data: frontmatter, content: mdxBody } = matter(content)
  const fm = frontmatter as MdxFrontmatter

  // Check if content has <div> blocks or ## headings (FAQ formats)
  const divBlocks = splitByDivBlocks(mdxBody)
  const h2Blocks = !divBlocks ? splitByH2Headings(mdxBody) : null
  const faqBlocks = divBlocks || h2Blocks
  
  if (faqBlocks && faqBlocks.length > 1) {
    // FAQ format: each <div> block is a separate Q&A
    const articles: KnowledgeArticle[] = []
    const now = new Date().toISOString()
    
    for (const block of faqBlocks) {
      // Extract question from H2 heading
      const question = extractH2Question(block)
      if (!question) continue
      
      // Answer is everything after the H2
      const answer = removeH2Heading(block)
      if (answer.length < 10) continue
      
      // Generate ID from question
      const id = generateId(appId, undefined, question)
      
      articles.push({
        id,
        title: question,
        question,
        answer,
        appId,
        metadata: {
          source: fm.source || defaultSource,
          category: fm.category || defaultCategory || 'general',
          created_at: fm.created_at || now,
          updated_at: fm.updated_at || now,
          tags: fm.tags || [],
          trust_score: fm.trust_score ?? defaultTrustScore,
        },
      })
    }
    
    return articles
  }

  // Standard format: single article per file
  // Extract title (frontmatter > H1 > fallback)
  const title = fm.title || extractTitleFromContent(mdxBody) || 'Untitled'

  // Extract question (frontmatter > first paragraph)
  const question = fm.question || extractFirstParagraph(mdxBody) || title

  // Get the full content as answer (keeping markdown format)
  const answer = mdxBody.trim()

  // Skip if content is too short to be meaningful
  if (answer.length < 10) {
    return []
  }

  // Generate ID
  const id = generateId(appId, fm.slug, title)

  // Build tags array
  const tags = fm.tags || []

  // Determine timestamps
  const now = new Date().toISOString()
  const created_at = fm.created_at || now
  const updated_at = fm.updated_at || now

  const article: KnowledgeArticle = {
    id,
    title,
    question,
    answer,
    appId,
    metadata: {
      source: fm.source || defaultSource,
      category: fm.category || defaultCategory,
      created_at,
      updated_at,
      tags,
      trust_score: fm.trust_score ?? defaultTrustScore,
    },
  }

  return [article]
}

/**
 * Parse multiple MDX files
 *
 * @param files - Array of file inputs with content and path
 * @param appId - Application identifier
 * @param options - Parser options
 * @returns Combined array of all articles
 */
export async function parseMdxFiles(
  files: MdxFileInput[],
  appId: string,
  options: MdxParserOptions = {}
): Promise<KnowledgeArticle[]> {
  const articles: KnowledgeArticle[] = []

  for (const file of files) {
    // Parse the file
    const parsed = await parseMdx(file.content, appId, options)

    // If no slug was in frontmatter, derive from file path
    for (const article of parsed) {
      if (article.id === `kb-${appId}-${slugify(article.title)}`) {
        // ID was generated from title, try to use file path instead
        const pathSlug =
          file.filePath
            .replace(/\.(mdx?|md)$/i, '')
            .split('/')
            .pop() || ''

        if (pathSlug) {
          article.id = `kb-${appId}-${slugify(pathSlug)}`
        }
      }
      articles.push(article)
    }
  }

  return articles
}
