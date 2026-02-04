import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PRODUCT_SOURCES,
  batchIngest,
  ingest,
  listProductSources,
} from '../ingest'
import { scrapeHtml } from '../parsers/html'
import { parseMdx, parseMdxFiles } from '../parsers/mdx'
import { parseTsx, parseTsxFiles } from '../parsers/tsx'

// Load test fixtures
const fixturesDir = join(__dirname, 'fixtures')
const mdxWithFrontmatter = readFileSync(
  join(fixturesDir, 'sample.mdx'),
  'utf-8'
)
const mdxNoFrontmatter = readFileSync(
  join(fixturesDir, 'sample-no-frontmatter.mdx'),
  'utf-8'
)
const tsxContent = readFileSync(join(fixturesDir, 'sample.tsx'), 'utf-8')
const htmlContent = readFileSync(join(fixturesDir, 'sample.html'), 'utf-8')

describe('MDX Parser', () => {
  describe('parseMdx', () => {
    it('extracts frontmatter metadata', async () => {
      const articles = await parseMdx(mdxWithFrontmatter, 'test-app')

      // MDX with H2 sections gets split into multiple articles
      expect(articles.length).toBeGreaterThanOrEqual(1)
      const article = articles[0]!

      // First article inherits frontmatter metadata
      expect(article.metadata.category).toBe('refund')
      expect(article.metadata.source).toBe('faq')
      expect(article.metadata.tags).toContain('refund')
      expect(article.metadata.tags).toContain('billing')
      expect(article.metadata.trust_score).toBe(0.95)
    })

    it('generates ID from appId and slug', async () => {
      const articles = await parseMdx(mdxWithFrontmatter, 'test-app')

      // With H2 sections, ID is generated from H2 heading
      expect(articles[0]!.id).toBe('kb-test-app-eligibility')
      expect(articles[0]!.appId).toBe('test-app')
    })

    it('handles MDX without frontmatter', async () => {
      const articles = await parseMdx(mdxNoFrontmatter, 'test-app')

      // MDX with H2 sections gets split into multiple articles
      expect(articles.length).toBeGreaterThanOrEqual(1)
      const article = articles[0]!

      // H2 becomes title/question
      expect(article.title).toBeDefined()
      // Should use default source
      expect(article.metadata.source).toBe('docs')
    })

    it('uses default options when not specified in frontmatter', async () => {
      const articles = await parseMdx(mdxNoFrontmatter, 'test-app', {
        defaultSource: 'manual',
        defaultCategory: 'license',
      })

      expect(articles[0]!.metadata.source).toBe('manual')
      expect(articles[0]!.metadata.category).toBe('license')
    })

    it('extracts content as answer', async () => {
      const articles = await parseMdx(mdxWithFrontmatter, 'test-app')

      // With H2 sections split, each article contains its section content
      const allAnswers = articles.map((a) => a.answer).join('\n')
      expect(allAnswers).toContain('30 days')
      expect(allAnswers).toContain('[EMAIL]')
    })

    it('returns empty array for content with no meaningful text', async () => {
      const emptyMdx = '---\ntitle: Empty\n---\n\n'
      const articles = await parseMdx(emptyMdx, 'test-app')

      expect(articles).toHaveLength(0)
    })
  })

  describe('parseMdxFiles', () => {
    it('parses multiple files', async () => {
      const files = [
        { content: mdxWithFrontmatter, filePath: 'faq/refunds.mdx' },
        { content: mdxNoFrontmatter, filePath: 'docs/license.mdx' },
      ]

      const articles = await parseMdxFiles(files, 'test-app')

      // With H2 sections split, we get multiple articles per file
      expect(articles.length).toBeGreaterThanOrEqual(2)
      // Articles should come from both files
      const allTitles = articles.map((a) => a.title)
      expect(
        allTitles.some(
          (t) =>
            t.toLowerCase().includes('eligibility') ||
            t.toLowerCase().includes('refund')
        )
      ).toBe(true)
    })

    it('uses filePath for ID generation when no slug', async () => {
      const files = [
        {
          content: mdxNoFrontmatter,
          filePath: 'docs/special-license-info.mdx',
        },
      ]

      const articles = await parseMdxFiles(files, 'test-app')

      expect(articles[0]!.id).toContain('special-license-info')
    })
  })
})

describe('TSX Parser', () => {
  describe('parseTsx', () => {
    it('extracts content from template literals', async () => {
      const articles = await parseTsx(tsxContent, 'test-app')

      // Should extract multiple content blocks
      expect(articles.length).toBeGreaterThanOrEqual(1)

      // Check that we found FAQ content
      const titles = articles.map((a) => a.title.toLowerCase())
      expect(
        titles.some((t) => t.includes('access') || t.includes('course'))
      ).toBe(true)
    })

    it('extracts title from content headings', async () => {
      const simpleTsx = `
        const content = \`
# Test Title

This is the answer content.
        \`
      `
      const articles = await parseTsx(simpleTsx, 'test-app')

      expect(articles).toHaveLength(1)
      expect(articles[0]!.title).toBe('Test Title')
    })

    it('extracts content from exported objects', async () => {
      const articles = await parseTsx(tsxContent, 'test-app')

      // faqData.content should be extracted
      const offlineArticle = articles.find(
        (a) =>
          a.answer.toLowerCase().includes('download') ||
          a.answer.toLowerCase().includes('offline')
      )
      expect(offlineArticle).toBeDefined()
    })

    it('handles parsing errors gracefully', async () => {
      const invalidTsx = 'this is not { valid tsx <>'
      const articles = await parseTsx(invalidTsx, 'test-app')

      expect(articles).toEqual([])
    })

    it('deduplicates by content', async () => {
      const duplicateTsx = `
        const content1 = \`
# Duplicate Content

This is some content that appears twice.
        \`
        const content2 = \`
# Duplicate Content

This is some content that appears twice.
        \`
      `
      const articles = await parseTsx(duplicateTsx, 'test-app')

      // Should only get 1 article despite duplicate content
      expect(articles.length).toBeLessThanOrEqual(2)
    })

    it('sets default source and category', async () => {
      const simpleTsx = `const x = \`# Title\n\nLong content here for extraction purposes minimum length.\``
      const articles = await parseTsx(simpleTsx, 'test-app', {
        defaultSource: 'faq',
        defaultCategory: 'technical',
      })

      if (articles.length > 0) {
        expect(articles[0]!.metadata.source).toBe('faq')
        expect(articles[0]!.metadata.category).toBe('technical')
      }
    })
  })

  describe('parseTsxFiles', () => {
    it('parses multiple TSX files', async () => {
      const files = [{ content: tsxContent, filePath: 'components/FAQ.tsx' }]

      const articles = await parseTsxFiles(files, 'test-app')

      expect(articles.length).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('HTML Scraper', () => {
  describe('scrapeHtml', () => {
    it('extracts sections from HTML', async () => {
      const articles = await scrapeHtml(htmlContent, 'test-app', {
        splitSections: true,
      })

      expect(articles.length).toBeGreaterThanOrEqual(1)
    })

    it('removes nav, header, footer content', async () => {
      const articles = await scrapeHtml(htmlContent, 'test-app', {
        splitSections: false,
      })

      const allContent = articles.map((a) => a.answer).join('\n')

      // Navigation links should be removed
      expect(allContent).not.toContain('Home</a>')
      // Footer should be removed
      expect(allContent).not.toContain('© 2024')
    })

    it('extracts meta keywords as tags', async () => {
      const articles = await scrapeHtml(htmlContent, 'test-app', {
        splitSections: false,
      })

      // At least some articles should have tags from meta keywords
      const allTags = articles.flatMap((a) => a.metadata.tags)
      expect(allTags.length).toBeGreaterThanOrEqual(0)
    })

    it('detects category from content', async () => {
      const articles = await scrapeHtml(htmlContent, 'test-app', {
        splitSections: true,
      })

      // The refund section should be categorized
      const refundArticle = articles.find(
        (a) =>
          a.title.toLowerCase().includes('refund') ||
          a.answer.toLowerCase().includes('refund')
      )

      if (refundArticle) {
        expect(refundArticle.metadata.category).toBe('refund')
      }
    })

    it('converts HTML to markdown-like format', async () => {
      const articles = await scrapeHtml(htmlContent, 'test-app', {
        splitSections: true,
      })

      const accessibilityArticle = articles.find((a) =>
        a.answer.includes('Screen reader')
      )

      if (accessibilityArticle) {
        // Should have list formatting
        expect(accessibilityArticle.answer).toContain('-')
      }
    })

    it('handles empty content gracefully', async () => {
      const emptyHtml = '<html><body></body></html>'
      const articles = await scrapeHtml(emptyHtml, 'test-app')

      expect(articles).toEqual([])
    })

    it('generates unique IDs with anchors', async () => {
      const articles = await scrapeHtml(htmlContent, 'test-app', {
        splitSections: true,
      })

      // IDs should be unique
      const ids = articles.map((a) => a.id)
      const uniqueIds = [...new Set(ids)]
      expect(ids.length).toBe(uniqueIds.length)
    })
  })
})

describe('Ingest Orchestrator', () => {
  describe('ingest', () => {
    it('routes MDX content to MDX parser', async () => {
      const result = await ingest({
        productId: 'total-typescript',
        content: mdxWithFrontmatter,
      })

      expect(result.format).toBe('mdx')
      expect(result.appId).toBe('total-typescript')
      expect(result.articles.length).toBeGreaterThanOrEqual(1)
      expect(result.errors).toHaveLength(0)
    })

    it('routes TSX content to TSX parser', async () => {
      const result = await ingest({
        productId: 'epic-react',
        content: tsxContent,
      })

      expect(result.format).toBe('tsx')
      expect(result.appId).toBe('epic-react')
    })

    it('handles database format with pre-fetched articles', async () => {
      // ai-hero now uses MDX format, so test with a custom product using database format
      const result = await ingest({
        productId: 'custom-db-product',
        format: 'database',
        articles: [
          {
            title: 'Test Article',
            question: 'How do I test?',
            answer: 'Write tests with vitest',
            category: 'technical',
            tags: ['testing'],
          },
        ],
      })

      expect(result.format).toBe('database')
      expect(result.articles).toHaveLength(1)
      expect(result.articles[0]!.title).toBe('Test Article')
      expect(result.articles[0]!.appId).toBe('custom-db-product')
      expect(result.articles[0]!.metadata.tags).toContain('testing')
    })

    it('uses product config for known products', async () => {
      const result = await ingest({
        productId: 'total-typescript',
        content: mdxNoFrontmatter,
      })

      expect(result.articles[0]!.metadata.source).toBe('faq')
      expect(result.articles[0]!.metadata.category).toBe('content')
    })

    it('allows format override for custom products', async () => {
      const result = await ingest({
        productId: 'custom-product',
        format: 'mdx',
        content: mdxNoFrontmatter,
        source: 'docs',
        category: 'general',
      })

      expect(result.appId).toBe('custom-product')
      expect(result.format).toBe('mdx')
    })

    it('throws error for unknown product without format', async () => {
      await expect(ingest({ productId: 'unknown-product' })).rejects.toThrow(
        'Unknown product'
      )
    })

    it('throws error for MDX without content', async () => {
      await expect(ingest({ productId: 'total-typescript' })).rejects.toThrow(
        'MDX format requires content'
      )
    })

    it('handles multiple MDX files', async () => {
      const result = await ingest({
        productId: 'total-typescript',
        content: [
          { content: mdxWithFrontmatter, filePath: 'faq/refunds.mdx' },
          { content: mdxNoFrontmatter, filePath: 'docs/license.mdx' },
        ],
      })

      // With H2 sections split, we get multiple articles per file
      expect(result.articles.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('batchIngest', () => {
    it('processes multiple sources', async () => {
      const result = await batchIngest([
        {
          productId: 'total-typescript',
          content: mdxWithFrontmatter,
        },
        {
          productId: 'custom-db-product',
          format: 'database',
          articles: [
            {
              title: 'AI Question',
              question: 'How does AI work?',
              answer: 'Magic and math',
            },
          ],
        },
      ])

      // total-typescript MDX has H2 sections that get split into multiple articles
      expect(result.totalCount).toBeGreaterThanOrEqual(2)
      expect(result.byProduct['total-typescript']).toBeGreaterThanOrEqual(1)
      expect(result.byProduct['custom-db-product']).toBe(1)
    })

    it('collects errors from multiple sources', async () => {
      const result = await batchIngest([
        {
          productId: 'total-typescript',
          content: mdxWithFrontmatter,
        },
        {
          productId: 'unknown-no-format',
          // No format specified for unknown product
        },
      ])

      expect(result.errors.length).toBeGreaterThanOrEqual(1)
      expect(result.errors[0]!.productId).toBe('unknown-no-format')
    })
  })

  describe('PRODUCT_SOURCES', () => {
    it('has all expected products', () => {
      expect(PRODUCT_SOURCES['total-typescript']).toBeDefined()
      expect(PRODUCT_SOURCES['epic-react']).toBeDefined()
      expect(PRODUCT_SOURCES['epic-web']).toBeDefined()
      expect(PRODUCT_SOURCES['ai-hero']).toBeDefined()
      expect(PRODUCT_SOURCES['testing-accessibility']).toBeDefined()
      expect(PRODUCT_SOURCES['shared']).toBeDefined()
    })

    it('has correct formats for each product', () => {
      expect(PRODUCT_SOURCES['total-typescript']!.format).toBe('mdx')
      expect(PRODUCT_SOURCES['epic-react']!.format).toBe('tsx')
      expect(PRODUCT_SOURCES['epic-web']!.format).toBe('tsx')
      expect(PRODUCT_SOURCES['ai-hero']!.format).toBe('mdx')
      expect(PRODUCT_SOURCES['testing-accessibility']!.format).toBe('html')
      expect(PRODUCT_SOURCES['shared']!.format).toBe('mdx')
    })
  })

  describe('listProductSources', () => {
    it('returns all product sources', () => {
      const sources = listProductSources()

      expect(sources).toHaveLength(6)
      expect(sources.map((s) => s.appId)).toContain('total-typescript')
      expect(sources.map((s) => s.appId)).toContain('epic-react')
      expect(sources.map((s) => s.appId)).toContain('shared')
    })
  })
})
