import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from './types'

// Mock dependencies BEFORE imports
vi.mock('@skillrecordings/core/services/app-registry', () => ({
  getApp: vi.fn(),
}))

vi.mock('@skillrecordings/sdk', () => ({
  IntegrationClient: vi.fn(),
}))

import { getApp } from '@skillrecordings/core/services/app-registry'
import { IntegrationClient } from '@skillrecordings/sdk'
import { processRefund } from './process-refund'

/**
 * Tests for processRefund (now request_refund)
 *
 * Architecture: Platform REQUESTS refunds from apps via SDK.
 * Apps own Stripe and process the actual refund.
 * Apps notify platform when complete.
 */
describe('processRefund (request_refund)', () => {
  const mockContext: ExecutionContext = {
    user: {
      id: 'user-123',
      email: '[EMAIL]',
      name: 'Test Customer',
    },
    purchases: [
      {
        id: 'pur_123',
        productId: 'prod_typescript',
        status: 'active',
        purchasedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      },
    ],
    appConfig: {
      id: 'total-typescript',
      name: 'Total TypeScript',
    },
    traceId: 'trace-123',
    conversationId: 'conv-123',
    approvalId: 'approval-456',
    db: {} as any,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(getApp as any).mockReset()
    ;(IntegrationClient as any).mockReset()
  })

  describe('requesting refund from app', () => {
    it('should request refund via IntegrationClient', async () => {
      const mockRevokeAccess = vi.fn().mockResolvedValue({
        success: true,
        message: 'Refund processing',
        refundId: 're_from_app_123',
      })

      const mockClient = { revokeAccess: mockRevokeAccess }
      ;(IntegrationClient as any).mockImplementation(() => mockClient as any)
      ;(getApp as any).mockResolvedValue({
        id: 'total-typescript',
        slug: 'total-typescript',
        name: 'Total TypeScript',
        integration_base_url: 'https://totaltypescript.com',
        webhook_secret: 'whsec_test_123',
      } as any)

      const result = await processRefund.execute(
        {
          purchaseId: 'pur_123',
          appId: 'total-typescript',
          reason: 'Customer request',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.accepted).toBe(true)
        expect(result.data.message).toContain('accepted')
      }

      // Verify we used SDK client, NOT Stripe directly
      expect(IntegrationClient).toHaveBeenCalledWith({
        baseUrl: 'https://totaltypescript.com',
        webhookSecret: 'whsec_test_123',
      })

      expect(mockRevokeAccess).toHaveBeenCalledWith({
        purchaseId: 'pur_123',
        reason: 'Customer request',
        refundId: expect.stringContaining('pending_'),
      })
    })

    it('should return declined when app rejects request', async () => {
      const mockRevokeAccess = vi.fn().mockResolvedValue({
        success: false,
        error: 'Purchase not eligible for refund',
      })
      ;(IntegrationClient as any).mockImplementation(
        () => ({ revokeAccess: mockRevokeAccess }) as any
      )
      ;(getApp as any).mockResolvedValue({
        id: 'total-typescript',
        integration_base_url: 'https://totaltypescript.com',
        webhook_secret: 'whsec_test_123',
      } as any)

      const result = await processRefund.execute(
        {
          purchaseId: 'pur_123',
          appId: 'total-typescript',
          reason: 'Customer request',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.accepted).toBe(false)
        expect(result.data.message).toContain('not eligible')
      }
    })

    it('should return error if app not found', async () => {
      ;(getApp as any).mockResolvedValueOnce(null)

      const result = await processRefund.execute(
        {
          purchaseId: 'pur_123',
          appId: 'nonexistent-app',
          reason: 'Customer request',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('App not found')
      }
    })

    it('should handle network errors gracefully', async () => {
      const mockRevokeAccess = vi
        .fn()
        .mockRejectedValue(new Error('Network error'))
      ;(IntegrationClient as any).mockImplementation(
        () => ({ revokeAccess: mockRevokeAccess }) as any
      )
      ;(getApp as any).mockResolvedValue({
        id: 'total-typescript',
        integration_base_url: 'https://totaltypescript.com',
        webhook_secret: 'whsec_test_123',
      } as any)

      const result = await processRefund.execute(
        {
          purchaseId: 'pur_123',
          appId: 'total-typescript',
          reason: 'Customer request',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('Network error')
      }
    })
  })

  describe('approval gate', () => {
    it('should auto-approve refunds within 30 days', () => {
      const params = {
        purchaseId: 'pur_123',
        appId: 'total-typescript',
        reason: 'Customer request',
      }

      const contextWithRecentPurchase = {
        ...mockContext,
        purchases: [
          {
            id: 'pur_123',
            productId: 'prod_typescript',
            status: 'active' as const,
            purchasedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
          },
        ],
      }

      const requiresApproval = processRefund.requiresApproval?.(
        params,
        contextWithRecentPurchase
      )

      expect(requiresApproval).toBe(false)
    })

    it('should require approval for refunds older than 30 days', () => {
      const params = {
        purchaseId: 'pur_123',
        appId: 'total-typescript',
        reason: 'Customer request',
      }

      const contextWithOldPurchase = {
        ...mockContext,
        purchases: [
          {
            id: 'pur_123',
            productId: 'prod_typescript',
            status: 'active' as const,
            purchasedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
          },
        ],
      }

      const requiresApproval = processRefund.requiresApproval?.(
        params,
        contextWithOldPurchase
      )

      expect(requiresApproval).toBe(true)
    })

    it('should require approval if purchase not found', () => {
      const params = {
        purchaseId: 'pur_unknown',
        appId: 'total-typescript',
        reason: 'Customer request',
      }

      const requiresApproval = processRefund.requiresApproval?.(
        params,
        mockContext
      )

      expect(requiresApproval).toBe(true)
    })
  })

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(processRefund.name).toBe('request_refund')
    })

    it('should have correct description', () => {
      expect(processRefund.description).toContain('Request a refund')
      expect(processRefund.description).toContain(
        'sends the request to the app'
      )
    })
  })
})
