import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupportHandler } from '../handler'
import type { SupportIntegration } from '../integration'

describe('createSupportHandler', () => {
  const mockIntegration: SupportIntegration = {
    lookupUser: vi.fn(async (email: string) => ({
      id: 'usr_123',
      email,
      name: 'Test User',
      createdAt: new Date(),
    })),
    getPurchases: vi.fn(async (userId: string) => [
      {
        id: 'pur_123',
        productId: 'prod_123',
        productName: 'Test Product',
        purchasedAt: new Date(),
        amount: 10000,
        currency: 'usd',
        status: 'active' as const,
      },
    ]),
    revokeAccess: vi.fn(async (params) => ({ success: true })),
    transferPurchase: vi.fn(async (params) => ({ success: true })),
    generateMagicLink: vi.fn(async (params) => ({
      url: 'https://example.com/magic?token=abc123',
    })),
  }

  const webhookSecret = 'whsec_test123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createSignature(
    timestamp: number,
    body: string,
    secret: string
  ): string {
    const crypto = require('crypto')
    const payload = `${timestamp}.${body}`
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')
    return `timestamp=${timestamp},v1=${signature}`
  }

  function createRequest(
    body: Record<string, unknown>,
    options: {
      timestamp?: number
      secret?: string
      skipSignature?: boolean
      malformedSignature?: string
    } = {}
  ): Request {
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
    const bodyString = JSON.stringify(body)
    const secret = options.secret ?? webhookSecret
    const signature =
      options.malformedSignature ??
      (options.skipSignature
        ? ''
        : createSignature(timestamp, bodyString, secret))

    const headers = new Headers({
      'content-type': 'application/json',
    })

    if (signature) {
      headers.set('x-support-signature', signature)
    }

    return new Request('http://localhost:3000/api/support', {
      method: 'POST',
      headers,
      body: bodyString,
    })
  }

  describe('signature verification', () => {
    it('accepts valid HMAC signature', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'lookupUser',
        email: 'test@example.com',
      })

      const response = await handler(request)
      expect(response.status).toBe(200)

      const data = (await response.json()) as Record<string, unknown>
      expect(data).toMatchObject({
        id: 'usr_123',
        email: 'test@example.com',
      })
    })

    it('rejects missing signature header', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest(
        { action: 'lookupUser', email: 'test@example.com' },
        { skipSignature: true }
      )

      const response = await handler(request)
      expect(response.status).toBe(401)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Missing signature header')
    })

    it('rejects malformed signature header', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest(
        { action: 'lookupUser', email: 'test@example.com' },
        { malformedSignature: 'invalid_format' }
      )

      const response = await handler(request)
      expect(response.status).toBe(401)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Invalid signature format')
    })

    it('rejects invalid HMAC signature', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest(
        { action: 'lookupUser', email: 'test@example.com' },
        { secret: 'wrong_secret' }
      )

      const response = await handler(request)
      expect(response.status).toBe(401)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Invalid signature')
    })

    it('rejects replay attacks (timestamp > 5 minutes old)', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 301 // 5 minutes + 1 second
      const request = createRequest(
        { action: 'lookupUser', email: 'test@example.com' },
        { timestamp: fiveMinutesAgo }
      )

      const response = await handler(request)
      expect(response.status).toBe(401)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Signature expired')
    })

    it('accepts timestamp within 5 minute window', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const fourMinutesAgo = Math.floor(Date.now() / 1000) - 240 // 4 minutes
      const request = createRequest(
        { action: 'lookupUser', email: 'test@example.com' },
        { timestamp: fourMinutesAgo }
      )

      const response = await handler(request)
      expect(response.status).toBe(200)
    })
  })

  describe('action routing', () => {
    it('routes lookupUser action', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'lookupUser',
        email: 'test@example.com',
      })

      const response = await handler(request)
      expect(response.status).toBe(200)

      expect(mockIntegration.lookupUser).toHaveBeenCalledWith(
        'test@example.com'
      )
    })

    it('routes getPurchases action', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getPurchases',
        userId: 'usr_123',
      })

      const response = await handler(request)
      expect(response.status).toBe(200)

      expect(mockIntegration.getPurchases).toHaveBeenCalledWith('usr_123')
    })

    it('routes revokeAccess action', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'revokeAccess',
        purchaseId: 'pur_123',
        reason: 'Customer request',
        refundId: 're_123',
      })

      const response = await handler(request)
      expect(response.status).toBe(200)

      expect(mockIntegration.revokeAccess).toHaveBeenCalledWith({
        purchaseId: 'pur_123',
        reason: 'Customer request',
        refundId: 're_123',
      })
    })

    it('routes transferPurchase action', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'transferPurchase',
        purchaseId: 'pur_123',
        fromUserId: 'usr_123',
        toEmail: 'newuser@example.com',
      })

      const response = await handler(request)
      expect(response.status).toBe(200)

      expect(mockIntegration.transferPurchase).toHaveBeenCalledWith({
        purchaseId: 'pur_123',
        fromUserId: 'usr_123',
        toEmail: 'newuser@example.com',
      })
    })

    it('routes generateMagicLink action', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'generateMagicLink',
        email: 'test@example.com',
        expiresIn: 3600,
      })

      const response = await handler(request)
      expect(response.status).toBe(200)

      expect(mockIntegration.generateMagicLink).toHaveBeenCalledWith({
        email: 'test@example.com',
        expiresIn: 3600,
      })
    })

    it('rejects unknown action', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'unknownAction',
        foo: 'bar',
      })

      const response = await handler(request)
      expect(response.status).toBe(400)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Unknown action: unknownAction')
    })

    it('rejects missing action field', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        email: 'test@example.com',
      })

      const response = await handler(request)
      expect(response.status).toBe(400)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Missing action field')
    })
  })

  describe('optional methods', () => {
    it('routes getSubscriptions when implemented', async () => {
      const integrationWithSubscriptions: SupportIntegration = {
        ...mockIntegration,
        getSubscriptions: vi.fn(async (userId: string) => [
          {
            id: 'sub_123',
            productId: 'prod_123',
            productName: 'Monthly Subscription',
            status: 'active' as const,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(),
            cancelAtPeriodEnd: false,
          },
        ]),
      }

      const handler = createSupportHandler({
        integration: integrationWithSubscriptions,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getSubscriptions',
        userId: 'usr_123',
      })

      const response = await handler(request)
      expect(response.status).toBe(200)

      expect(
        integrationWithSubscriptions.getSubscriptions
      ).toHaveBeenCalledWith('usr_123')
    })

    it('returns 501 for optional method not implemented', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getSubscriptions',
        userId: 'usr_123',
      })

      const response = await handler(request)
      expect(response.status).toBe(501)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Method not implemented: getSubscriptions')
    })

    it('routes getProductStatus when implemented', async () => {
      const integrationWithProductStatus: SupportIntegration = {
        ...mockIntegration,
        getProductStatus: vi.fn(async (productId: string) => ({
          productId,
          productType: 'live' as const,
          available: true,
          soldOut: false,
          quantityAvailable: 50,
          quantityRemaining: 12,
          state: 'active' as const,
          startsAt: '2026-02-01T10:00:00Z',
        })),
      }

      const handler = createSupportHandler({
        integration: integrationWithProductStatus,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getProductStatus',
        productId: 'ts-workshop-feb-2026',
      })

      const response = await handler(request)
      expect(response.status).toBe(200)

      expect(
        integrationWithProductStatus.getProductStatus
      ).toHaveBeenCalledWith('ts-workshop-feb-2026')

      const data = (await response.json()) as Record<string, unknown>
      expect(data).toMatchObject({
        productId: 'ts-workshop-feb-2026',
        productType: 'live',
        available: true,
        soldOut: false,
        quantityRemaining: 12,
      })
    })

    it('returns 501 for getProductStatus when not implemented', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getProductStatus',
        productId: 'some-product',
      })

      const response = await handler(request)
      expect(response.status).toBe(501)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Method not implemented: getProductStatus')
    })

    it('returns null for non-existent product', async () => {
      const integrationWithProductStatus: SupportIntegration = {
        ...mockIntegration,
        getProductStatus: vi.fn(async (productId: string) => null),
      }

      const handler = createSupportHandler({
        integration: integrationWithProductStatus,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getProductStatus',
        productId: 'non-existent-product',
      })

      const response = await handler(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toBeNull()
    })

    // ── Agent Intelligence Methods ─────────────────────────────────

    it('routes getActivePromotions when implemented', async () => {
      const promotions = [
        {
          id: 'promo_123',
          name: 'Summer Sale',
          discountType: 'percent' as const,
          discountAmount: 30,
          active: true,
        },
      ]

      const integrationWithPromos: SupportIntegration = {
        ...mockIntegration,
        getActivePromotions: vi.fn(async () => promotions),
      }

      const handler = createSupportHandler({
        integration: integrationWithPromos,
        webhookSecret,
      })

      const request = createRequest({ action: 'getActivePromotions' })
      const response = await handler(request)

      expect(response.status).toBe(200)
      expect(integrationWithPromos.getActivePromotions).toHaveBeenCalled()

      const data = await response.json()
      expect(data).toEqual(promotions)
    })

    it('returns 501 for getActivePromotions when not implemented', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({ action: 'getActivePromotions' })
      const response = await handler(request)

      expect(response.status).toBe(501)
      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Method not implemented: getActivePromotions')
    })

    it('routes getCouponInfo when implemented', async () => {
      const coupon = {
        code: 'SAVE20',
        valid: true,
        discountType: 'percent' as const,
        discountAmount: 20,
        usageCount: 100,
      }

      const integrationWithCoupons: SupportIntegration = {
        ...mockIntegration,
        getCouponInfo: vi.fn(async (code: string) => coupon),
      }

      const handler = createSupportHandler({
        integration: integrationWithCoupons,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getCouponInfo',
        code: 'SAVE20',
      })
      const response = await handler(request)

      expect(response.status).toBe(200)
      expect(integrationWithCoupons.getCouponInfo).toHaveBeenCalledWith(
        'SAVE20'
      )

      const data = await response.json()
      expect(data).toEqual(coupon)
    })

    it('returns 501 for getCouponInfo when not implemented', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getCouponInfo',
        code: 'SAVE20',
      })
      const response = await handler(request)

      expect(response.status).toBe(501)
      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Method not implemented: getCouponInfo')
    })

    it('routes getRefundPolicy when implemented', async () => {
      const policy = {
        autoApproveWindowDays: 30,
        manualApproveWindowDays: 45,
      }

      const integrationWithPolicy: SupportIntegration = {
        ...mockIntegration,
        getRefundPolicy: vi.fn(async () => policy),
      }

      const handler = createSupportHandler({
        integration: integrationWithPolicy,
        webhookSecret,
      })

      const request = createRequest({ action: 'getRefundPolicy' })
      const response = await handler(request)

      expect(response.status).toBe(200)
      expect(integrationWithPolicy.getRefundPolicy).toHaveBeenCalled()

      const data = await response.json()
      expect(data).toEqual(policy)
    })

    it('returns 501 for getRefundPolicy when not implemented', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({ action: 'getRefundPolicy' })
      const response = await handler(request)

      expect(response.status).toBe(501)
      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Method not implemented: getRefundPolicy')
    })

    it('routes getContentAccess when implemented', async () => {
      const access = {
        userId: 'usr_123',
        products: [
          {
            productId: 'prod_123',
            productName: 'TypeScript Pro',
            accessLevel: 'full' as const,
          },
        ],
      }

      const integrationWithAccess: SupportIntegration = {
        ...mockIntegration,
        getContentAccess: vi.fn(async (userId: string) => access),
      }

      const handler = createSupportHandler({
        integration: integrationWithAccess,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getContentAccess',
        userId: 'usr_123',
      })
      const response = await handler(request)

      expect(response.status).toBe(200)
      expect(integrationWithAccess.getContentAccess).toHaveBeenCalledWith(
        'usr_123'
      )

      const data = await response.json()
      expect(data).toEqual(access)
    })

    it('returns 501 for getContentAccess when not implemented', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getContentAccess',
        userId: 'usr_123',
      })
      const response = await handler(request)

      expect(response.status).toBe(501)
      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Method not implemented: getContentAccess')
    })

    it('routes getRecentActivity when implemented', async () => {
      const activity = {
        userId: 'usr_123',
        lessonsCompleted: 42,
        totalLessons: 100,
        completionPercent: 42,
        recentItems: [],
      }

      const integrationWithActivity: SupportIntegration = {
        ...mockIntegration,
        getRecentActivity: vi.fn(async (userId: string) => activity),
      }

      const handler = createSupportHandler({
        integration: integrationWithActivity,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getRecentActivity',
        userId: 'usr_123',
      })
      const response = await handler(request)

      expect(response.status).toBe(200)
      expect(integrationWithActivity.getRecentActivity).toHaveBeenCalledWith(
        'usr_123'
      )

      const data = await response.json()
      expect(data).toEqual(activity)
    })

    it('returns 501 for getRecentActivity when not implemented', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getRecentActivity',
        userId: 'usr_123',
      })
      const response = await handler(request)

      expect(response.status).toBe(501)
      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Method not implemented: getRecentActivity')
    })

    it('routes getLicenseInfo when implemented', async () => {
      const license = {
        purchaseId: 'pur_123',
        licenseType: 'team' as const,
        totalSeats: 10,
        claimedSeats: 7,
        availableSeats: 3,
        claimedBy: [
          { email: 'alice@acme.com', claimedAt: '2025-01-15T10:00:00Z' },
        ],
      }

      const integrationWithLicense: SupportIntegration = {
        ...mockIntegration,
        getLicenseInfo: vi.fn(async (purchaseId: string) => license),
      }

      const handler = createSupportHandler({
        integration: integrationWithLicense,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getLicenseInfo',
        purchaseId: 'pur_123',
      })
      const response = await handler(request)

      expect(response.status).toBe(200)
      expect(integrationWithLicense.getLicenseInfo).toHaveBeenCalledWith(
        'pur_123'
      )

      const data = await response.json()
      expect(data).toEqual(license)
    })

    it('returns 501 for getLicenseInfo when not implemented', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'getLicenseInfo',
        purchaseId: 'pur_123',
      })
      const response = await handler(request)

      expect(response.status).toBe(501)
      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Method not implemented: getLicenseInfo')
    })

    it('routes getAppInfo when implemented', async () => {
      const appInfo = {
        name: 'Total TypeScript',
        instructorName: 'Matt Pocock',
        supportEmail: 'support@totaltypescript.com',
        websiteUrl: 'https://totaltypescript.com',
      }

      const integrationWithAppInfo: SupportIntegration = {
        ...mockIntegration,
        getAppInfo: vi.fn(async () => appInfo),
      }

      const handler = createSupportHandler({
        integration: integrationWithAppInfo,
        webhookSecret,
      })

      const request = createRequest({ action: 'getAppInfo' })
      const response = await handler(request)

      expect(response.status).toBe(200)
      expect(integrationWithAppInfo.getAppInfo).toHaveBeenCalled()

      const data = await response.json()
      expect(data).toEqual(appInfo)
    })

    it('returns 501 for getAppInfo when not implemented', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const request = createRequest({ action: 'getAppInfo' })
      const response = await handler(request)

      expect(response.status).toBe(501)
      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toBe('Method not implemented: getAppInfo')
    })
  })

  describe('error handling', () => {
    it('handles integration method errors', async () => {
      const failingIntegration: SupportIntegration = {
        ...mockIntegration,
        lookupUser: vi.fn(async () => {
          throw new Error('Database connection failed')
        }),
      }

      const handler = createSupportHandler({
        integration: failingIntegration,
        webhookSecret,
      })

      const request = createRequest({
        action: 'lookupUser',
        email: 'test@example.com',
      })

      const response = await handler(request)
      expect(response.status).toBe(500)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toContain('Database connection failed')
    })

    it('handles malformed JSON body', async () => {
      const handler = createSupportHandler({
        integration: mockIntegration,
        webhookSecret,
      })

      const timestamp = Math.floor(Date.now() / 1000)
      const malformedBody = 'not valid json'
      const signature = createSignature(timestamp, malformedBody, webhookSecret)

      const request = new Request('http://localhost:3000/api/support', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-support-signature': signature,
        },
        body: malformedBody,
      })

      const response = await handler(request)
      expect(response.status).toBe(400)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.error).toContain('Invalid JSON')
    })
  })
})
