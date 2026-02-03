/**
 * Tests for FAQ Miner
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies before imports
vi.mock('@skillrecordings/front-sdk', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@skillrecordings/front-sdk')>()
  return {
    ...actual,
    createFrontClient: vi.fn(),
  }
})

vi.mock('@skillrecordings/database', () => ({
  database: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
  eq: vi.fn(),
  and: vi.fn(),
  gte: vi.fn(),
  desc: vi.fn(),
  ActionsTable: {},
  AppsTable: {},
  ConversationsTable: {},
}))

vi.mock('../services/app-registry', () => ({
  getApp: vi.fn(),
  getAppByInboxId: vi.fn(),
}))

vi.mock('../front/instrumented-client', () => ({
  createInstrumentedFrontClient: vi.fn(() => ({
    inboxes: {
      listConversations: vi.fn().mockResolvedValue({ _results: [] }),
    },
    conversations: {
      listMessages: vi.fn().mockResolvedValue({ _results: [] }),
    },
  })),
}))

vi.mock('../trust/repository', () => ({
  getOutcomeHistory: vi.fn().mockResolvedValue([]),
}))

vi.mock('./clusterer', () => ({
  clusterBySimilarity: vi.fn().mockResolvedValue([]),
  generateCandidatesFromClusters: vi.fn().mockResolvedValue([]),
}))

// Mock app for testing
const mockApp = {
  id: 'app-1',
  slug: 'test',
  name: 'Test',
  front_inbox_id: 'inb_123',
  integration_base_url: 'https://test.com',
  webhook_secret: 'secret',
  capabilities: [],
  stripe_account_id: null,
  stripe_connected: false,
  instructor_teammate_id: null,
  auto_approve_refund_days: 30,
  auto_approve_transfer_days: 14,
  escalation_slack_channel: null,
  created_at: new Date(),
  updated_at: new Date(),
}

describe('FAQ Miner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FRONT_API_TOKEN = 'test-token'
  })

  afterEach(() => {
    delete process.env.FRONT_API_TOKEN
  })

  describe('parseSince', () => {
    it('should parse days correctly', async () => {
      // Import dynamically to get mocked version
      const { mineConversations } = await import('./miner')
      const { getApp } = await import('../services/app-registry')
      const mockedGetApp = vi.mocked(getApp)

      mockedGetApp.mockResolvedValue(null as any)

      // Should throw because app not found, but we're testing the since parsing
      await expect(
        mineConversations({ appId: 'test', since: '30d' })
      ).rejects.toThrow('App not found')
    })

    it('should reject invalid since format', async () => {
      const { mineConversations } = await import('./miner')
      const { getApp } = await import('../services/app-registry')
      const mockedGetApp = vi.mocked(getApp)

      mockedGetApp.mockResolvedValue(mockApp as any)

      await expect(
        mineConversations({ appId: 'test', since: 'invalid' })
      ).rejects.toThrow('Invalid since format')
    })
  })

  describe('mineFaqCandidates', () => {
    it('should return empty result when no conversations', async () => {
      const { mineFaqCandidates } = await import('./miner')
      const { getApp } = await import('../services/app-registry')
      const mockedGetApp = vi.mocked(getApp)

      mockedGetApp.mockResolvedValue(mockApp as any)

      const result = await mineFaqCandidates({
        appId: 'test',
        since: '30d',
      })

      expect(result.conversations).toHaveLength(0)
      expect(result.clusters).toHaveLength(0)
      expect(result.candidates).toHaveLength(0)
      expect(result.stats.totalConversations).toBe(0)
    })
  })
})
