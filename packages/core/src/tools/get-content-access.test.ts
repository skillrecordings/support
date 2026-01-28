import type { ContentAccess } from '@skillrecordings/sdk/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from './types'

// Store mock functions in module scope
let mockGetContentAccessImpl: ReturnType<typeof vi.fn>
let mockGetAppImpl: ReturnType<typeof vi.fn>

// Mock the app registry
vi.mock('../services/app-registry', () => ({
  getApp: (...args: unknown[]) => mockGetAppImpl(...args),
}))

// Mock the IntegrationClient
vi.mock('@skillrecordings/sdk/client', () => {
  return {
    IntegrationClient: vi.fn().mockImplementation(() => ({
      getContentAccess: (...args: unknown[]) =>
        mockGetContentAccessImpl(...args),
    })),
  }
})

import { getContentAccess } from './get-content-access'

describe('getContentAccess', () => {
  const mockContext: ExecutionContext = {
    user: {
      id: 'usr_123',
      email: 'test@example.com',
      name: 'Test User',
    },
    purchases: [],
    appConfig: {
      id: 'total-typescript',
      name: 'Total TypeScript',
    },
    traceId: 'trace_123',
    conversationId: 'cnv_123',
  }

  const mockApp = {
    id: 'total-typescript',
    integration_base_url: 'https://totaltypescript.com/api/support',
    webhook_secret: 'whsec_test123',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAppImpl = vi.fn().mockResolvedValue(mockApp)
    mockGetContentAccessImpl = vi.fn()
  })

  describe('successful access lookups', () => {
    it('returns full access to single product', async () => {
      const access: ContentAccess = {
        userId: 'usr_123',
        products: [
          {
            productId: 'prod_ts',
            productName: 'Total TypeScript',
            accessLevel: 'full',
          },
        ],
      }

      mockGetContentAccessImpl.mockResolvedValue(access)

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.access).toEqual(access)
        expect(result.data.summary).toContain('Total TypeScript')
        expect(result.data.summary).toContain('full')
      }
    })

    it('returns multiple products with different access levels', async () => {
      const access: ContentAccess = {
        userId: 'usr_123',
        products: [
          {
            productId: 'prod_ts',
            productName: 'Total TypeScript',
            accessLevel: 'full',
          },
          {
            productId: 'prod_react',
            productName: 'React Essentials',
            accessLevel: 'partial',
          },
        ],
      }

      mockGetContentAccessImpl.mockResolvedValue(access)

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('2 product(s)')
        expect(result.data.summary).toContain('Total TypeScript')
        expect(result.data.summary).toContain('React Essentials')
      }
    })

    it('shows module-level access details', async () => {
      const access: ContentAccess = {
        userId: 'usr_123',
        products: [
          {
            productId: 'prod_ts',
            productName: 'Total TypeScript',
            accessLevel: 'partial',
            modules: [
              {
                id: 'mod_1',
                title: 'Fundamentals',
                accessible: true,
              },
              { id: 'mod_2', title: 'Advanced', accessible: false },
              { id: 'mod_3', title: 'Pro', accessible: false },
            ],
          },
        ],
      }

      mockGetContentAccessImpl.mockResolvedValue(access)

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('Modules: 1/3 accessible')
      }
    })

    it('shows expiration date for time-limited access', async () => {
      const access: ContentAccess = {
        userId: 'usr_123',
        products: [
          {
            productId: 'prod_ts',
            productName: 'Total TypeScript',
            accessLevel: 'full',
            expiresAt: '2026-12-31T00:00:00Z',
          },
        ],
      }

      mockGetContentAccessImpl.mockResolvedValue(access)

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('expires')
      }
    })

    it('shows lifetime access for non-expiring products', async () => {
      const access: ContentAccess = {
        userId: 'usr_123',
        products: [
          {
            productId: 'prod_ts',
            productName: 'Total TypeScript',
            accessLevel: 'full',
            // No expiresAt = lifetime
          },
        ],
      }

      mockGetContentAccessImpl.mockResolvedValue(access)

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('lifetime')
      }
    })

    it('includes team membership info', async () => {
      const access: ContentAccess = {
        userId: 'usr_123',
        products: [
          {
            productId: 'prod_ts',
            productName: 'Total TypeScript',
            accessLevel: 'full',
          },
        ],
        teamMembership: {
          teamId: 'team_acme',
          teamName: 'Acme Corp',
          role: 'member',
          seatClaimedAt: '2025-01-15T10:00:00Z',
        },
      }

      mockGetContentAccessImpl.mockResolvedValue(access)

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('Acme Corp')
        expect(result.data.summary).toContain('member')
      }
    })

    it('handles user with no product access', async () => {
      const access: ContentAccess = {
        userId: 'usr_123',
        products: [],
      }

      mockGetContentAccessImpl.mockResolvedValue(access)

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.summary).toContain('no product access')
      }
    })
  })

  describe('access not found', () => {
    it('handles null response', async () => {
      mockGetContentAccessImpl.mockResolvedValue(null)

      const result = await getContentAccess.execute(
        { userId: 'usr_unknown', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(false)
        expect(result.data.access).toBeNull()
        expect(result.data.summary).toContain('No content access data found')
      }
    })
  })

  describe('501 fallback handling', () => {
    it('returns graceful error when method not implemented', async () => {
      mockGetContentAccessImpl.mockRejectedValue(
        new Error('Method not implemented: getContentAccess')
      )

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(false)
        expect(result.data.error).toContain('not implemented')
        expect(result.data.summary).toContain(
          'does not support content access checking'
        )
        expect(result.data.summary).toContain('purchase history instead')
      }
    })
  })

  describe('error handling', () => {
    it('returns error when app not found', async () => {
      mockGetAppImpl.mockResolvedValue(null)

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'unknown-app' },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('App not found')
      }
    })

    it('propagates network errors', async () => {
      mockGetContentAccessImpl.mockRejectedValue(new Error('Network error'))

      const result = await getContentAccess.execute(
        { userId: 'usr_123', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('Network error')
      }
    })
  })

  describe('tool metadata', () => {
    it('has correct name', () => {
      expect(getContentAccess.name).toBe('get_content_access')
    })

    it('has description mentioning content access', () => {
      expect(getContentAccess.description).toContain('content')
      expect(getContentAccess.description).toContain('access')
      expect(getContentAccess.description).toContain('module')
    })
  })
})
