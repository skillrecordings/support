/**
 * TSX Parser for Knowledge Base
 *
 * Extracts Q&A content from TSX files by parsing template literals
 * and exported content objects. Uses Babel for AST traversal.
 */

import * as parser from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeSource,
} from '../types'

/**
 * Options for TSX parsing
 */
export interface TsxParserOptions {
  /** Default source if not specified */
  defaultSource?: KnowledgeSource
  /** Default category if not specified */
  defaultCategory?: KnowledgeCategory
  /** Default trust score (0-1) */
  defaultTrustScore?: number
  /** Minimum content length to extract */
  minContentLength?: number
}

/**
 * File input for batch processing
 */
export interface TsxFileInput {
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
 * Extract title from first H1/H2 heading in content
 */
function extractTitle(content: string): string | null {
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match) return h1Match[1]!.trim()

  const h2Match = content.match(/^##\s+(.+)$/m)
  if (h2Match) return h2Match[1]!.trim()

  // Try first non-empty line as title
  const lines = content.trim().split('\n')
  const firstLine = lines[0]?.trim()
  if (firstLine && firstLine.length < 100 && !firstLine.startsWith('-')) {
    return firstLine
  }

  return null
}

/**
 * Extract question/summary from content
 */
function extractQuestion(content: string, title: string | null): string {
  // Remove title line if present
  let body = content
  if (title) {
    body = content
      .replace(
        new RegExp(
          `^#+\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          'm'
        ),
        ''
      )
      .trim()
  }

  // Get first paragraph
  const paragraphs = body.split(/\n\n+/)
  for (const p of paragraphs) {
    const trimmed = p.trim()
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('```')) {
      return trimmed.slice(0, 200)
    }
  }

  return title || 'FAQ Content'
}

/**
 * Normalize and clean extracted content
 */
function normalizeContent(content: string): string {
  return content
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .trim()
}

/**
 * Hash content for deduplication
 */
function contentHash(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').slice(0, 200)
}

/**
 * Parse TSX content to extract knowledge articles
 *
 * @param content - TSX source code
 * @param appId - Application identifier
 * @param options - Parser options
 * @returns Array of knowledge articles
 */
export async function parseTsx(
  content: string,
  appId: string,
  options: TsxParserOptions = {}
): Promise<KnowledgeArticle[]> {
  const {
    defaultSource = 'docs',
    defaultCategory,
    defaultTrustScore = 1.0,
    minContentLength = 50,
  } = options

  let ast: ReturnType<typeof parser.parse>
  try {
    ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    })
  } catch (e) {
    console.error('Failed to parse TSX:', e)
    return []
  }

  const extractedContent: string[] = []
  const seenHashes = new Set<string>()

  // Traverse AST to find template literals and string content
  traverse(ast, {
    TemplateLiteral(path) {
      const quasis = path.node.quasis
      if (quasis.length === 1) {
        const raw = quasis[0]!.value.cooked || quasis[0]!.value.raw
        if (raw && raw.length >= minContentLength) {
          const normalized = normalizeContent(raw)
          const hash = contentHash(normalized)
          if (!seenHashes.has(hash)) {
            seenHashes.add(hash)
            extractedContent.push(normalized)
          }
        }
      }
    },
    StringLiteral(path) {
      const value = path.node.value
      if (
        value.length >= minContentLength &&
        (value.includes('\n') || value.includes('#'))
      ) {
        const normalized = normalizeContent(value)
        const hash = contentHash(normalized)
        if (!seenHashes.has(hash)) {
          seenHashes.add(hash)
          extractedContent.push(normalized)
        }
      }
    },
    ObjectProperty(path) {
      if (
        t.isIdentifier(path.node.key) &&
        ['content', 'description', 'answer', 'body', 'text'].includes(
          path.node.key.name
        )
      ) {
        if (t.isStringLiteral(path.node.value)) {
          const value = path.node.value.value
          if (value.length >= minContentLength) {
            const normalized = normalizeContent(value)
            const hash = contentHash(normalized)
            if (!seenHashes.has(hash)) {
              seenHashes.add(hash)
              extractedContent.push(normalized)
            }
          }
        } else if (t.isTemplateLiteral(path.node.value)) {
          const quasis = path.node.value.quasis
          if (quasis.length === 1) {
            const raw = quasis[0]!.value.cooked || quasis[0]!.value.raw
            if (raw && raw.length >= minContentLength) {
              const normalized = normalizeContent(raw)
              const hash = contentHash(normalized)
              if (!seenHashes.has(hash)) {
                seenHashes.add(hash)
                extractedContent.push(normalized)
              }
            }
          }
        }
      }
    },
  })

  // Convert extracted content to articles
  const now = new Date().toISOString()
  const articles: KnowledgeArticle[] = []
  let index = 0

  for (const text of extractedContent) {
    const title = extractTitle(text)
    if (!title) continue

    const question = extractQuestion(text, title)
    const id = `kb-${appId}-tsx-${slugify(title)}-${index++}`

    articles.push({
      id,
      title,
      question,
      answer: text,
      appId,
      metadata: {
        source: defaultSource,
        category: defaultCategory,
        created_at: now,
        updated_at: now,
        tags: [],
        trust_score: defaultTrustScore,
      },
    })
  }

  return articles
}

/**
 * Parse multiple TSX files
 *
 * @param files - Array of file inputs with content and path
 * @param appId - Application identifier
 * @param options - Parser options
 * @returns Combined array of all articles
 */
export async function parseTsxFiles(
  files: TsxFileInput[],
  appId: string,
  options: TsxParserOptions = {}
): Promise<KnowledgeArticle[]> {
  const articles: KnowledgeArticle[] = []

  for (const file of files) {
    const parsed = await parseTsx(file.content, appId, options)
    articles.push(...parsed)
  }

  return articles
}
