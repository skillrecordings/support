import type { RefundPolicy } from '@skillrecordings/sdk/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from './types'

// Store mock functions in module scope
let mockGetRefundPolicyImpl: ReturnType<typeof vi.fn>
let mockGetAppImpl: ReturnType<typeof vi.fn>

// Mock the app registry
vi.mock('../services/app-registry', () => ({
  getApp: (...args: unknown[]) => mockGetAppImpl(...args),
}))

// Mock the IntegrationClient
vi.mock('@skillrecordings/sdk/client', () => {
  return {
    IntegrationClient: vi.fn().mockImplementation(() => ({
      getRefundPolicy: (...args: unknown[]) => mockGetRefundPolicyImpl(...args),
    })),
  }
})

import { getRefundPolicy } from './get-refund-policy'

describe('getRefundPolicy', () => {
  const mockContext: ExecutionContext = {
    user: {
      id: 'usr_123',
      email: '[EMAIL]',
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
    mockGetRefundPolicyImpl = vi.fn()
  })

  describe('successful policy lookups', () => {
    it('returns standard refund policy', async () => {
      const policy: RefundPolicy = {
        autoApproveWindowDays: 30,
        manualApproveWindowDays: 45,
      }

      mockGetRefundPolicyImpl.mockResolvedValue(policy)

      const result = await getRefundPolicy.execute(
        { appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.policy).toEqual(policy)
        expect(result.data.summary).toContain('30 days')
        expect(result.data.summary).toContain('Auto-approved')
      }
    })

    it('includes no-refund cutoff in summary', async () => {
      const policy: RefundPolicy = {
        autoApproveWindowDays: 30,
        manualApproveWindowDays: 45,
        noRefundAfterDays: 60,
      }

      mockGetRefundPolicyImpl.mockResolvedValue(policy)

      const result = await getRefundPolicy.execute(
        { appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('No refunds after 60 days')
      }
    })

    it('includes policy URL in summary', async () => {
      const policy: RefundPolicy = {
        autoApproveWindowDays: 30,
        manualApproveWindowDays: 45,
        policyUrl: 'https://example.com/refund-policy',
      }

      mockGetRefundPolicyImpl.mockResolvedValue(policy)

      const result = await getRefundPolicy.execute(
        { appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('Full policy:')
        expect(result.data.summary).toContain('example.com/refund-policy')
      }
    })

    it('includes special conditions in summary', async () => {
      const policy: RefundPolicy = {
        autoApproveWindowDays: 14,
        manualApproveWindowDays: 30,
        specialConditions: [
          'No refunds on sale items',
          'Partial refunds after 14 days',
        ],
      }

      mockGetRefundPolicyImpl.mockResolvedValue(policy)

      const result = await getRefundPolicy.execute(
        { appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('Special conditions')
        expect(result.data.summary).toContain('No refunds on sale items')
        expect(result.data.summary).toContain('Partial refunds after 14 days')
      }
    })
  })

  describe('501 fallback handling', () => {
    it('returns default policy info when method not implemented', async () => {
      mockGetRefundPolicyImpl.mockRejectedValue(
        new Error('Method not implemented: getRefundPolicy')
      )

      const result = await getRefundPolicy.execute(
        { appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(false)
        expect(result.data.error).toContain('not implemented')
        expect(result.data.summary).toContain(
          'does not provide a custom refund policy'
        )
        expect(result.data.summary).toContain('30 days auto-approved')
      }
    })
  })

  describe('error handling', () => {
    it('returns error when app not found', async () => {
      mockGetAppImpl.mockResolvedValue(null)

      const result = await getRefundPolicy.execute(
        { appId: 'unknown-app' },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('App not found')
      }
    })

    it('propagates network errors', async () => {
      mockGetRefundPolicyImpl.mockRejectedValue(new Error('Network error'))

      const result = await getRefundPolicy.execute(
        { appId: 'total-typescript' },
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
      expect(getRefundPolicy.name).toBe('get_refund_policy')
    })

    it('has description mentioning refund policy', () => {
      expect(getRefundPolicy.description).toContain('refund policy')
      expect(getRefundPolicy.description).toContain('auto-approval')
    })
  })
})
