import type { CouponInfo } from '@skillrecordings/sdk/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from './types'

// Store mock functions in module scope
let mockGetCouponInfoImpl: ReturnType<typeof vi.fn>
let mockGetAppImpl: ReturnType<typeof vi.fn>

// Mock the app registry
vi.mock('../services/app-registry', () => ({
  getApp: (...args: unknown[]) => mockGetAppImpl(...args),
}))

// Mock the IntegrationClient
vi.mock('@skillrecordings/sdk/client', () => {
  return {
    IntegrationClient: vi.fn().mockImplementation(() => ({
      getCouponInfo: (...args: unknown[]) => mockGetCouponInfoImpl(...args),
    })),
  }
})

import { getCouponInfo } from './get-coupon-info'

describe('getCouponInfo', () => {
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
    mockGetCouponInfoImpl = vi.fn()
  })

  describe('successful coupon lookups', () => {
    it('returns valid percent discount coupon', async () => {
      const coupon: CouponInfo = {
        code: 'SAVE20',
        valid: true,
        discountType: 'percent',
        discountAmount: 20,
        usageCount: 50,
        maxUses: 100,
      }

      mockGetCouponInfoImpl.mockResolvedValue(coupon)

      const result = await getCouponInfo.execute(
        { code: 'SAVE20', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.coupon).toEqual(coupon)
        expect(result.data.summary).toContain('20% off')
        expect(result.data.summary).toContain('valid')
      }
    })

    it('returns valid fixed amount coupon', async () => {
      const coupon: CouponInfo = {
        code: 'FLAT50',
        valid: true,
        discountType: 'fixed',
        discountAmount: 5000, // $50 in cents
        usageCount: 10,
      }

      mockGetCouponInfoImpl.mockResolvedValue(coupon)

      const result = await getCouponInfo.execute(
        { code: 'FLAT50', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.summary).toContain('$50.00 off')
      }
    })

    it('returns invalid coupon details', async () => {
      const coupon: CouponInfo = {
        code: 'EXPIRED',
        valid: false,
        discountType: 'percent',
        discountAmount: 30,
        usageCount: 100,
        maxUses: 100,
      }

      mockGetCouponInfoImpl.mockResolvedValue(coupon)

      const result = await getCouponInfo.execute(
        { code: 'EXPIRED', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.coupon?.valid).toBe(false)
        expect(result.data.summary).toContain('not valid')
      }
    })

    it('includes restriction type in summary', async () => {
      const coupon: CouponInfo = {
        code: 'STUDENT50',
        valid: true,
        discountType: 'percent',
        discountAmount: 50,
        usageCount: 200,
        restrictionType: 'student',
      }

      mockGetCouponInfoImpl.mockResolvedValue(coupon)

      const result = await getCouponInfo.execute(
        { code: 'STUDENT50', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('Restriction: student')
      }
    })

    it('includes expiration in summary', async () => {
      const coupon: CouponInfo = {
        code: 'FLASH',
        valid: true,
        discountType: 'percent',
        discountAmount: 40,
        usageCount: 5,
        expiresAt: '2026-02-01T00:00:00Z',
      }

      mockGetCouponInfoImpl.mockResolvedValue(coupon)

      const result = await getCouponInfo.execute(
        { code: 'FLASH', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('Expires:')
      }
    })
  })

  describe('coupon not found', () => {
    it('handles null response from integration', async () => {
      mockGetCouponInfoImpl.mockResolvedValue(null)

      const result = await getCouponInfo.execute(
        { code: 'NONEXISTENT', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(false)
        expect(result.data.coupon).toBeNull()
        expect(result.data.summary).toContain('not found')
      }
    })
  })

  describe('501 fallback handling', () => {
    it('returns graceful error when method not implemented', async () => {
      mockGetCouponInfoImpl.mockRejectedValue(
        new Error('Method not implemented: getCouponInfo')
      )

      const result = await getCouponInfo.execute(
        { code: 'SAVE20', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(false)
        expect(result.data.error).toContain('not implemented')
        expect(result.data.summary).toContain('does not support coupon lookups')
      }
    })
  })

  describe('error handling', () => {
    it('returns error when app not found', async () => {
      mockGetAppImpl.mockResolvedValue(null)

      const result = await getCouponInfo.execute(
        { code: 'SAVE20', appId: 'unknown-app' },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('App not found')
      }
    })

    it('propagates network errors', async () => {
      mockGetCouponInfoImpl.mockRejectedValue(new Error('Network error'))

      const result = await getCouponInfo.execute(
        { code: 'SAVE20', appId: 'total-typescript' },
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
      expect(getCouponInfo.name).toBe('get_coupon_info')
    })

    it('has description mentioning coupon lookup', () => {
      expect(getCouponInfo.description).toContain('coupon')
      expect(getCouponInfo.description).toContain('discount')
    })
  })
})
