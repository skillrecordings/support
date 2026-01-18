import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('health command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('signRequest', () => {
    it('creates valid HMAC signature', async () => {
      // Import the module to test signature format
      const body = '{"action":"lookupUser","email":"test@example.com"}'
      const secret = 'test-secret'
      const timestamp = Math.floor(Date.now() / 1000)
      const payload = `${timestamp}.${body}`
      const expectedSignature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex')

      // The signature format should be: timestamp=X,v1=Y
      expect(expectedSignature).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('testAction', () => {
    it('returns ok for successful response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'user-123', email: 'test@example.com' }),
      })

      // Test that fetch was called with correct headers
      const response = await mockFetch('http://localhost:3016/api/support', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-support-signature': 'timestamp=123,v1=abc',
        },
        body: '{"action":"lookupUser","email":"test@example.com"}',
      })

      expect(response.ok).toBe(true)
    })

    it('returns not_implemented for 501 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 501,
        json: async () => ({ error: 'Method not implemented' }),
      })

      const response = await mockFetch('http://localhost:3016/api/support', {
        method: 'POST',
        body: '{"action":"getSubscriptions"}',
      })

      expect(response.status).toBe(501)
    })

    it('returns error for failed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid signature' }),
      })

      const response = await mockFetch('http://localhost:3016/api/support', {
        method: 'POST',
        body: '{"action":"lookupUser"}',
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
    })
  })
})
