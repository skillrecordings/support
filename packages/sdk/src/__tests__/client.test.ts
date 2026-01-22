import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActionResult,
  ProductStatus,
  Purchase,
  User,
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
        `${baseUrl}/api/support/lookup-user`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Support-Signature':
              expect.stringMatching(/^t=\d+,v1=[a-f0-9]+$/),
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
      const timestampPart = (signature as string).split('t=')[1]?.split(',')[0]
      expect(timestampPart).toBeDefined()
      const timestamp = parseInt(timestampPart as string)

      // Timestamp should be within 1 second of now
      expect(Math.abs(timestamp - now / 1000)).toBeLessThan(1)
    })
  })

  describe('lookupUser', () => {
    it('calls /api/support/lookup-user endpoint', async () => {
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
        `${baseUrl}/api/support/lookup-user`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com' }),
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
    it('calls /api/support/get-purchases endpoint', async () => {
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
        `${baseUrl}/api/support/get-purchases`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ userId: 'usr_123' }),
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
    it('calls /api/support/revoke-access endpoint', async () => {
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
        `${baseUrl}/api/support/revoke-access`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            purchaseId: 'pur_123',
            reason: 'Customer requested refund',
            refundId: 're_123',
          }),
        })
      )
    })
  })

  describe('transferPurchase', () => {
    it('calls /api/support/transfer-purchase endpoint', async () => {
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
        `${baseUrl}/api/support/transfer-purchase`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            purchaseId: 'pur_123',
            fromUserId: 'usr_123',
            toEmail: 'new@example.com',
          }),
        })
      )
    })
  })

  describe('generateMagicLink', () => {
    it('calls /api/support/generate-magic-link endpoint', async () => {
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
        `${baseUrl}/api/support/generate-magic-link`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
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
        `${baseUrl}/api/support/get-subscriptions`,
        expect.any(Object)
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
        `${baseUrl}/api/support/update-email`,
        expect.any(Object)
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
        `${baseUrl}/api/support/update-name`,
        expect.any(Object)
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
        `${baseUrl}/api/support/get-claimed-seats`,
        expect.any(Object)
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
})
