/**
 * DuckDB Data Source Tests
 *
 * Tests for the DuckDB cache adapter for FAQ mining.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type CacheStats,
  createDuckDBSource,
  getAppForInbox,
  getInboxIdsForApp,
} from './duckdb-source'
import type { DataSource, ResolvedConversation } from './types'

const CACHE_PATH = `${process.env.HOME}/skill/data/front-cache.db`

describe('duckdb-source', () => {
  describe('inbox mapping', () => {
    it('maps total-typescript to correct inbox', () => {
      const inboxIds = getInboxIdsForApp('total-typescript')
      expect(inboxIds).toContain('inb_3srbb')
    })

    it('maps inbox back to app', () => {
      const app = getAppForInbox('inb_3srbb')
      expect(app).toBe('total-typescript')
    })

    it('returns undefined for unknown app', () => {
      const inboxIds = getInboxIdsForApp('nonexistent-app')
      expect(inboxIds).toBeUndefined()
    })

    it('returns undefined for unknown inbox', () => {
      const app = getAppForInbox('inb_unknown')
      expect(app).toBeUndefined()
    })
  })

  describe('createDuckDBSource', () => {
    let source: DataSource

    beforeAll(async () => {
      source = await createDuckDBSource({
        dbPath: CACHE_PATH,
      })
    })

    afterAll(async () => {
      if (source?.close) {
        await source.close()
      }
    })

    it('creates source with correct name', () => {
      expect(source.name).toBe('duckdb-cache')
    })

    it('has getStats method', () => {
      expect(source.getStats).toBeDefined()
    })

    it('has getMessages method', () => {
      expect(source.getMessages).toBeDefined()
    })

    describe('getStats', () => {
      let stats: CacheStats

      beforeAll(async () => {
        stats = (await source.getStats?.()) as CacheStats
      })

      it('returns total conversations', () => {
        expect(stats.totalConversations).toBeGreaterThan(0)
        // We know from the issue there are ~27k conversations
        expect(stats.totalConversations).toBeGreaterThan(20000)
      })

      it('returns total messages', () => {
        expect(stats.totalMessages).toBeGreaterThan(0)
      })

      it('returns inbox count', () => {
        expect(stats.inboxCount).toBeGreaterThan(0)
      })

      it('returns date range', () => {
        expect(stats.dateRange.oldest).toBeInstanceOf(Date)
        expect(stats.dateRange.newest).toBeInstanceOf(Date)
      })
    })

    describe('getConversations', () => {
      it('returns conversations for total-typescript', async () => {
        // Use larger limit because recent conversations may be spam
        const conversations = await source.getConversations({
          appId: 'total-typescript',
          limit: 100,
        })

        expect(conversations.length).toBeGreaterThan(0)
        expect(conversations.length).toBeLessThanOrEqual(100)
      })

      it('conversations have required fields', async () => {
        // Use larger limit to ensure we get past spam
        const conversations = await source.getConversations({
          appId: 'total-typescript',
          limit: 100,
        })

        for (const conv of conversations) {
          expect(conv.conversationId).toBeDefined()
          expect(conv.question).toBeDefined()
          expect(conv.answer).toBeDefined()
          expect(conv.appId).toBe('total-typescript')
          expect(Array.isArray(conv.tags)).toBe(true)
          expect(conv._raw.conversation).toBeDefined()
          expect(conv._raw.messages).toBeDefined()
        }
      })

      it('filters by date', async () => {
        const oneMonthAgo = new Date()
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

        const conversations = await source.getConversations({
          appId: 'total-typescript',
          since: oneMonthAgo,
          limit: 10,
        })

        for (const conv of conversations) {
          expect(conv.resolvedAt.getTime()).toBeGreaterThanOrEqual(
            oneMonthAgo.getTime()
          )
        }
      })

      it('filters out spam', async () => {
        const conversations = await source.getConversations({
          appId: 'total-typescript',
          limit: 100,
        })

        for (const conv of conversations) {
          // Should not contain spam patterns
          expect(conv.question.toLowerCase()).not.toContain('collaboration')
          expect(conv.question.toLowerCase()).not.toContain('partnership')
          // Should not have spam tags
          expect(conv.tags.map((t) => t.toLowerCase())).not.toContain('spam')
        }
      })

      it('returns empty array for unknown app', async () => {
        const conversations = await source.getConversations({
          appId: 'nonexistent-app',
          limit: 10,
        })

        expect(conversations).toEqual([])
      })
    })

    describe('getMessages', () => {
      it('returns messages for a conversation', async () => {
        // First get a conversation to get its ID (use larger limit to get past spam)
        const conversations = await source.getConversations({
          appId: 'total-typescript',
          limit: 100,
        })

        expect(conversations.length).toBeGreaterThan(0)
        const conv = conversations[0]!

        const messages = await source.getMessages(conv.conversationId)
        expect(messages.length).toBeGreaterThan(0)

        // Messages should have required fields
        for (const msg of messages) {
          expect(msg.id).toBeDefined()
          expect(typeof msg.is_inbound).toBe('boolean')
          expect(typeof msg.created_at).toBe('number')
        }
      })
    })
  })

  describe('createDuckDBSource with filters', () => {
    it('respects inbox filter', async () => {
      const source = await createDuckDBSource({
        dbPath: CACHE_PATH,
        inboxIds: ['inb_3srbb'], // Total TypeScript only
      })

      try {
        // Use larger limit to get past spam
        const conversations = await source.getConversations({
          limit: 100,
        })

        expect(conversations.length).toBeGreaterThan(0)
        // All should be from total-typescript
        for (const conv of conversations) {
          expect(conv.appId).toBe('total-typescript')
        }
      } finally {
        await source.close?.()
      }
    })
  })
})
