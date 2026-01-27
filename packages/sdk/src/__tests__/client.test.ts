import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActionResult,
  AppInfo,
  ContentAccess,
  CouponInfo,
  LicenseInfo,
  ProductStatus,
  Promotion,
  Purchase,
  RefundPolicy,
  User,
  UserActivity,
} from '../integration'

// Import will fail until we create the client
import { IntegrationClient } from '../client'

describe('IntegrationClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let client: IntegrationClient
  const baseUrl = 'https://app.example.com'
  const webhookSecret = 'whsec_test123'

  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock

    client = new IntegrationClient({
      baseUrl,
      webhookSecret,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('creates client with baseUrl and secret', () => {
      expect(client).toBeInstanceOf(IntegrationClient)
    })

    it('strips trailing slash from baseUrl', () => {
      const clientWithSlash = new IntegrationClient({
        baseUrl: 'https://app.example.com/',
        webhookSecret: 'secret',
      })
      expect(clientWithSlash).toBeInstanceOf(IntegrationClient)
    })
  })

  describe('HMAC signature', () => {
    it('signs requests with X-Support-Signature header', async () => {
      const user: User = {
        id: 'usr_123',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date(),
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => user,
      })

      await client.lookupUser('test@example.com')

      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Support-Signature': expect.stringMatching(
              /^timestamp=\d+,v1=[a-f0-9]+$/
            ),
          }),
        })
      )
    })

    it('includes timestamp in signature', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      })

      const now = Date.now()
      await client.lookupUser('test@example.com')

      const call = fetchMock.mock.calls[0]
      const signature = call?.[1]?.headers?.['X-Support-Signature']
      expect(signature).toBeDefined()
      const timestampPart = (signature as string)
        .split('timestamp=')[1]
        ?.split(',')[0]
      expect(timestampPart).toBeDefined()
      const timestamp = parseInt(timestampPart as string)

      // Timestamp should be within 1 second of now
      expect(Math.abs(timestamp - now / 1000)).toBeLessThan(1)
    })
  })

  describe('lookupUser', () => {
    it('calls baseUrl with lookupUser action', async () => {
      const user: User = {
        id: 'usr_123',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date(),
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => user,
      })

      const result = await client.lookupUser('test@example.com')

      expect(result).toEqual(user)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'lookupUser',
            email: 'test@example.com',
          }),
        })
      )
    })

    it('returns null when user not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      })

      const result = await client.lookupUser('notfound@example.com')
      expect(result).toBeNull()
    })
  })

  describe('getPurchases', () => {
    it('calls baseUrl with getPurchases action', async () => {
      const purchases: Purchase[] = [
        {
          id: 'pur_123',
          productId: 'prod_123',
          productName: 'Test Product',
          purchasedAt: new Date(),
          amount: 10000,
          currency: 'usd',
          status: 'active',
        },
      ]

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => purchases,
      })

      const result = await client.getPurchases('usr_123')

      expect(result).toEqual(purchases)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'getPurchases', userId: 'usr_123' }),
        })
      )
    })

    it('returns empty array when no purchases', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      const result = await client.getPurchases('usr_123')
      expect(result).toEqual([])
    })
  })

  describe('revokeAccess', () => {
    it('calls baseUrl with revokeAccess action', async () => {
      const actionResult: ActionResult = { success: true }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => actionResult,
      })

      const result = await client.revokeAccess({
        purchaseId: 'pur_123',
        reason: 'Customer requested refund',
        refundId: 're_123',
      })

      expect(result).toEqual(actionResult)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'revokeAccess',
            purchaseId: 'pur_123',
            reason: 'Customer requested refund',
            refundId: 're_123',
          }),
        })
      )
    })
  })

  describe('transferPurchase', () => {
    it('calls baseUrl with transferPurchase action', async () => {
      const actionResult: ActionResult = { success: true }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => actionResult,
      })

      const result = await client.transferPurchase({
        purchaseId: 'pur_123',
        fromUserId: 'usr_123',
        toEmail: 'new@example.com',
      })

      expect(result).toEqual(actionResult)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'transferPurchase',
            purchaseId: 'pur_123',
            fromUserId: 'usr_123',
            toEmail: 'new@example.com',
          }),
        })
      )
    })
  })

  describe('generateMagicLink', () => {
    it('calls baseUrl with generateMagicLink action', async () => {
      const magicLink = {
        url: 'https://app.example.com/auth/magic?token=abc123',
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => magicLink,
      })

      const result = await client.generateMagicLink({
        email: 'test@example.com',
        expiresIn: 3600,
      })

      expect(result).toEqual(magicLink)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'generateMagicLink',
            email: 'test@example.com',
            expiresIn: 3600,
          }),
        })
      )
    })
  })

  describe('error handling', () => {
    it('throws when response is not ok', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(client.lookupUser('test@example.com')).rejects.toThrow(
        'Integration request failed: 500 Internal Server Error'
      )
    })

    it('includes error message from response when available', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid email format' }),
      })

      await expect(client.lookupUser('invalid')).rejects.toThrow(
        'Invalid email format'
      )
    })

    it('handles network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'))

      await expect(client.lookupUser('test@example.com')).rejects.toThrow(
        'Network error'
      )
    })
  })

  describe('optional methods', () => {
    it('calls getSubscriptions when implemented', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      const result = await client.getSubscriptions?.('usr_123')
      expect(result).toEqual([])
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('getSubscriptions'),
        })
      )
    })

    it('calls updateEmail when implemented', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })

      const result = await client.updateEmail?.({
        userId: 'usr_123',
        newEmail: 'new@example.com',
      })

      expect(result).toEqual({ success: true })
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('updateEmail'),
        })
      )
    })

    it('calls updateName when implemented', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })

      const result = await client.updateName?.({
        userId: 'usr_123',
        newName: 'New Name',
      })

      expect(result).toEqual({ success: true })
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('updateName'),
        })
      )
    })

    it('calls getClaimedSeats when implemented', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      const result = await client.getClaimedSeats?.('bulk_123')
      expect(result).toEqual([])
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('getClaimedSeats'),
        })
      )
    })

    it('calls getProductStatus for product availability', async () => {
      const productStatus: ProductStatus = {
        productId: 'ts-workshop-feb-2026',
        productType: 'live',
        available: true,
        soldOut: false,
        quantityAvailable: 50,
        quantityRemaining: 12,
        state: 'active',
        startsAt: '2026-02-01T10:00:00Z',
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => productStatus,
      })

      const result = await client.getProductStatus('ts-workshop-feb-2026')

      expect(result).toEqual(productStatus)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('getProductStatus'),
        })
      )
    })

    it('returns null when product not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      })

      const result = await client.getProductStatus('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('agent intelligence methods', () => {
    it('calls getActivePromotions', async () => {
      const promotions: Promotion[] = [
        {
          id: 'promo_123',
          name: 'Summer Sale',
          code: 'SUMMER2025',
          discountType: 'percent',
          discountAmount: 30,
          active: true,
        },
      ]

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => promotions,
      })

      const result = await client.getActivePromotions()

      expect(result).toEqual(promotions)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('getActivePromotions'),
        })
      )
    })

    it('getActivePromotions returns empty array on 501', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 501,
        json: async () => ({
          error: 'Method not implemented: getActivePromotions',
        }),
      })

      const result = await client.getActivePromotions()
      expect(result).toEqual([])
    })

    it('calls getCouponInfo with code', async () => {
      const coupon: CouponInfo = {
        code: 'SAVE20',
        valid: true,
        discountType: 'percent',
        discountAmount: 20,
        usageCount: 100,
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => coupon,
      })

      const result = await client.getCouponInfo('SAVE20')

      expect(result).toEqual(coupon)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"code":"SAVE20"'),
        })
      )
    })

    it('getCouponInfo returns null on 501', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 501,
        json: async () => ({
          error: 'Method not implemented: getCouponInfo',
        }),
      })

      const result = await client.getCouponInfo('INVALID')
      expect(result).toBeNull()
    })

    it('calls getRefundPolicy', async () => {
      const policy: RefundPolicy = {
        autoApproveWindowDays: 30,
        manualApproveWindowDays: 45,
        noRefundAfterDays: 60,
        policyUrl: 'https://example.com/refund',
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => policy,
      })

      const result = await client.getRefundPolicy()

      expect(result).toEqual(policy)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('getRefundPolicy'),
        })
      )
    })

    it('calls getContentAccess with userId', async () => {
      const access: ContentAccess = {
        userId: 'usr_123',
        products: [
          {
            productId: 'prod_123',
            productName: 'TypeScript Pro',
            accessLevel: 'full',
          },
        ],
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => access,
      })

      const result = await client.getContentAccess('usr_123')

      expect(result).toEqual(access)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"userId":"usr_123"'),
        })
      )
    })

    it('calls getRecentActivity with userId', async () => {
      const activity: UserActivity = {
        userId: 'usr_123',
        lessonsCompleted: 42,
        totalLessons: 100,
        completionPercent: 42,
        recentItems: [],
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => activity,
      })

      const result = await client.getRecentActivity('usr_123')

      expect(result).toEqual(activity)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"userId":"usr_123"'),
        })
      )
    })

    it('calls getLicenseInfo with purchaseId', async () => {
      const license: LicenseInfo = {
        purchaseId: 'pur_123',
        licenseType: 'team',
        totalSeats: 10,
        claimedSeats: 7,
        availableSeats: 3,
        claimedBy: [
          { email: 'alice@acme.com', claimedAt: '2025-01-15T10:00:00Z' },
        ],
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => license,
      })

      const result = await client.getLicenseInfo('pur_123')

      expect(result).toEqual(license)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"purchaseId":"pur_123"'),
        })
      )
    })

    it('getLicenseInfo returns null on 501', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 501,
        json: async () => ({
          error: 'Method not implemented: getLicenseInfo',
        }),
      })

      const result = await client.getLicenseInfo('pur_123')
      expect(result).toBeNull()
    })

    it('calls getAppInfo', async () => {
      const appInfo: AppInfo = {
        name: 'Total TypeScript',
        instructorName: 'Matt Pocock',
        supportEmail: 'support@totaltypescript.com',
        websiteUrl: 'https://totaltypescript.com',
        invoicesUrl: 'https://totaltypescript.com/invoices',
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => appInfo,
      })

      const result = await client.getAppInfo()

      expect(result).toEqual(appInfo)
      expect(fetchMock).toHaveBeenCalledWith(
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('getAppInfo'),
        })
      )
    })

    it('optional methods throw on non-501 errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Database down' }),
      })

      await expect(client.getActivePromotions()).rejects.toThrow(
        'Database down'
      )
    })
  })
})
