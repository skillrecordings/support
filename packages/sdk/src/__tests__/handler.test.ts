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
