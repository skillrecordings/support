/**
 * HTML Scraper for Knowledge Base
 *
 * Extracts Q&A content from HTML pages, removing navigation/footer
 * and converting to markdown-like format. Uses cheerio for DOM parsing.
 */

import * as cheerio from 'cheerio'
import type { Cheerio, CheerioAPI } from 'cheerio'
import type { AnyNode, Text as DomText, Element } from 'domhandler'
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeSource,
} from '../types'

/**
 * Options for HTML scraping
 */
export interface HtmlScraperOptions {
  /** Default source if not specified */
  defaultSource?: KnowledgeSource
  /** Default category if not specified */
  defaultCategory?: KnowledgeCategory
  /** Default trust score (0-1) */
  defaultTrustScore?: number
  /** Split into sections by headings */
  splitSections?: boolean
  /** Selectors to remove */
  removeSelectors?: string[]
  /** Minimum content length to extract */
  minContentLength?: number
}

/**
 * Default selectors to remove from HTML
 */
const DEFAULT_REMOVE_SELECTORS = [
  'nav',
  'header',
  'footer',
  'aside',
  '.nav',
  '.header',
  '.footer',
  '.sidebar',
  '.navigation',
  '.menu',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  'script',
  'style',
  'noscript',
  'iframe',
]

/**
 * Category detection patterns
 */
const CATEGORY_PATTERNS: Array<{
  pattern: RegExp
  category: KnowledgeCategory
}> = [
  { pattern: /refund|money\s*back|return/i, category: 'refund' },
  { pattern: /license|licensing|seat|activation/i, category: 'license' },
  { pattern: /access|login|account|password/i, category: 'access' },
  { pattern: /billing|payment|invoice|charge/i, category: 'billing' },
  { pattern: /technical|error|bug|issue|problem/i, category: 'technical' },
]

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
 * Detect category from content
 */
function detectCategory(content: string): KnowledgeCategory | undefined {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(content)) {
      return category
    }
  }
  return undefined
}

/**
 * Convert HTML element to markdown-like text
 */
function elementToText($: CheerioAPI, el: Cheerio<AnyNode>): string {
  const lines: string[] = []

  el.contents().each((_, node) => {
    if (node.type === 'text') {
      const text = (node as DomText).data?.trim()
      if (text) lines.push(text)
    } else if (node.type === 'tag') {
      const $node = $(node)
      const tagName = (node as Element).tagName?.toLowerCase()

      switch (tagName) {
        case 'h1':
          lines.push(`# ${$node.text().trim()}`)
          break
        case 'h2':
          lines.push(`## ${$node.text().trim()}`)
          break
        case 'h3':
          lines.push(`### ${$node.text().trim()}`)
          break
        case 'h4':
        case 'h5':
        case 'h6':
          lines.push(`#### ${$node.text().trim()}`)
          break
        case 'p':
          lines.push($node.text().trim())
          break
        case 'ul':
        case 'ol':
          $node.children('li').each((_, li) => {
            lines.push(`- ${$(li).text().trim()}`)
          })
          break
        case 'li':
          lines.push(`- ${$node.text().trim()}`)
          break
        case 'a':
          const href = $node.attr('href')
          const text = $node.text().trim()
          if (href && text) {
            lines.push(`[${text}](${href})`)
          } else if (text) {
            lines.push(text)
          }
          break
        case 'strong':
        case 'b':
          lines.push(`**${$node.text().trim()}**`)
          break
        case 'em':
        case 'i':
          lines.push(`*${$node.text().trim()}*`)
          break
        case 'code':
          lines.push(`\`${$node.text().trim()}\``)
          break
        case 'pre':
          lines.push('```')
          lines.push($node.text().trim())
          lines.push('```')
          break
        case 'br':
          lines.push('')
          break
        case 'div':
        case 'section':
        case 'article':
        case 'main':
          lines.push(elementToText($, $node))
          break
        default:
          const innerText = $node.text().trim()
          if (innerText) lines.push(innerText)
      }
    }
  })

  return lines.filter(Boolean).join('\n\n')
}

/**
 * Extract meta keywords as tags
 */
function extractMetaKeywords($: CheerioAPI): string[] {
  const keywords = $('meta[name="keywords"]').attr('content')
  if (!keywords) return []

  return keywords
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0 && k.length < 30)
}

/**
 * Extract page title
 */
function extractPageTitle($: CheerioAPI): string {
  return $('title').text().trim() || $('h1').first().text().trim() || 'Untitled'
}

/**
 * Split content by headings into sections (recursively handles nested structures)
 */
function splitBySections(
  $: CheerioAPI,
  mainContent: Cheerio<AnyNode>
): Array<{ title: string; content: string; anchor?: string }> {
  const sections: Array<{ title: string; content: string; anchor?: string }> =
    []
  let currentTitle = ''
  let currentContent: string[] = []
  let currentAnchor: string | undefined

  function processElement(el: Element): void {
    const $el = $(el)
    const tagName = el.tagName?.toLowerCase()

    if (tagName && ['h1', 'h2', 'h3'].includes(tagName)) {
      // Save previous section if exists
      if (currentTitle && currentContent.length > 0) {
        sections.push({
          title: currentTitle,
          content: currentContent.join('\n\n'),
          anchor: currentAnchor,
        })
      }
      // Start new section
      currentTitle = $el.text().trim()
      currentAnchor = $el.attr('id') || $el.parent().attr('id')
      currentContent = []
    } else if (tagName && ['section', 'article', 'div'].includes(tagName)) {
      // Recurse into container elements
      $el.children().each((_, child) => {
        processElement(child as Element)
      })
    } else {
      // Add to current section
      const text = elementToText($, $el)
      if (text.trim()) {
        currentContent.push(text)
      }
    }
  }

  mainContent.children().each((_, el) => {
    processElement(el as Element)
  })

  // Don't forget last section
  if (currentTitle && currentContent.length > 0) {
    sections.push({
      title: currentTitle,
      content: currentContent.join('\n\n'),
      anchor: currentAnchor,
    })
  }

  return sections
}

/**
 * Scrape HTML content for knowledge articles
 *
 * @param html - HTML content string
 * @param appId - Application identifier
 * @param options - Scraper options
 * @returns Array of knowledge articles
 */
export async function scrapeHtml(
  html: string,
  appId: string,
  options: HtmlScraperOptions = {}
): Promise<KnowledgeArticle[]> {
  const {
    defaultSource = 'docs',
    defaultCategory,
    defaultTrustScore = 1.0,
    splitSections = false,
    removeSelectors = DEFAULT_REMOVE_SELECTORS,
    minContentLength = 30,
  } = options

  const $ = cheerio.load(html)

  // Remove unwanted elements
  for (const selector of removeSelectors) {
    $(selector).remove()
  }

  // Extract metadata
  const pageTitle = extractPageTitle($)
  const tags = extractMetaKeywords($)

  // Find main content area
  let mainContent = $(
    'main, article, [role="main"], .content, .main-content, #content, #main'
  ).first()
  if (mainContent.length === 0) {
    mainContent = $('body')
  }

  const now = new Date().toISOString()
  const articles: KnowledgeArticle[] = []

  if (splitSections) {
    // Split into sections by headings
    const sections = splitBySections($, mainContent)

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!
      if (section.content.length < minContentLength) continue

      const category = detectCategory(section.content) || defaultCategory
      const anchor = section.anchor || slugify(section.title)
      // Include index to guarantee unique IDs
      const id = `kb-${appId}-html-${anchor}-${i}`

      // Extract first paragraph as question
      const paragraphs = section.content.split('\n\n')
      const question =
        paragraphs
          .find((p) => p && !p.startsWith('#') && !p.startsWith('-'))
          ?.slice(0, 200) || section.title

      articles.push({
        id,
        title: section.title,
        question,
        answer: section.content,
        appId,
        metadata: {
          source: defaultSource,
          category,
          created_at: now,
          updated_at: now,
          tags,
          trust_score: defaultTrustScore,
        },
      })
    }
  } else {
    // Single article from whole page
    const content = elementToText($, mainContent)
    if (content.length < minContentLength) return []

    const category = detectCategory(content) || defaultCategory
    const id = `kb-${appId}-html-${slugify(pageTitle)}`

    // Extract first paragraph as question
    const paragraphs = content.split('\n\n')
    const question =
      paragraphs
        .find((p) => p && !p.startsWith('#') && !p.startsWith('-'))
        ?.slice(0, 200) || pageTitle

    articles.push({
      id,
      title: pageTitle,
      question,
      answer: content,
      appId,
      metadata: {
        source: defaultSource,
        category,
        created_at: now,
        updated_at: now,
        tags,
        trust_score: defaultTrustScore,
      },
    })
  }

  return articles
}
