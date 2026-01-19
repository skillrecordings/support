import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationClient } from '../client'
import { createSupportHandler } from '../handler'
import type { SupportIntegration } from '../integration'
import type { ContentSearchRequest, ContentSearchResponse } from '../types'

describe('IntegrationClient.searchContent', () => {
  const originalFetch = global.fetch
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('should make correct POST request to /api/support/search-content', async () => {
    const client = new IntegrationClient({
      baseUrl: 'https://totaltypescript.com',
      webhookSecret: 'test-secret',
    })

    const mockResponse: ContentSearchResponse = {
      results: [
        {
          id: 'result-1',
          type: 'lesson',
          title: 'TypeScript Generics',
          url: 'https://totaltypescript.com/lessons/generics',
          score: 0.95,
        },
      ],
      quickLinks: [
        {
          id: 'quick-1',
          type: 'social',
          title: 'Discord',
          url: 'https://discord.gg/totaltypescript',
        },
      ],
    }

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const request: ContentSearchRequest = {
      query: 'generics',
      types: ['lesson'],
      limit: 5,
    }

    const result = await client.searchContent(request)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://totaltypescript.com/api/support/search-content',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Support-Signature': expect.stringMatching(
            /^t=\d+,v1=[a-f0-9]{64}$/
          ),
        }),
        body: JSON.stringify(request),
      })
    )

    expect(result).toEqual(mockResponse)
  })

  it('should include customer context when provided', async () => {
    const client = new IntegrationClient({
      baseUrl: 'https://totaltypescript.com',
      webhookSecret: 'test-secret',
    })

    const mockResponse: ContentSearchResponse = {
      results: [],
    }

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
      })
    )

    const request: ContentSearchRequest = {
      query: 'advanced patterns',
      customer: {
        email: '[EMAIL]',
        hasPurchased: true,
        purchasedProducts: ['tt-course-1'],
      },
    }

    await client.searchContent(request)

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(callArgs[1].body as string)

    expect(body.customer).toEqual({
      email: '[EMAIL]',
      hasPurchased: true,
      purchasedProducts: ['tt-course-1'],
    })
  })

  it('should throw error when response is not ok', async () => {
    const client = new IntegrationClient({
      baseUrl: 'https://totaltypescript.com',
      webhookSecret: 'test-secret',
    })

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Search failed' }), {
        status: 500,
      })
    )

    await expect(client.searchContent({ query: 'test' })).rejects.toThrowError(
      'Search failed'
    )
  })
})

describe('Handler searchContent routing', () => {
  it('should route searchContent action correctly', async () => {
    const mockSearchContent = vi.fn().mockResolvedValue({
      results: [
        {
          id: 'lesson-1',
          type: 'lesson',
          title: 'Test Lesson',
          url: 'https://example.com/lesson',
        },
      ],
    })

    const integration: SupportIntegration = {
      lookupUser: vi.fn(),
      getPurchases: vi.fn(),
      revokeAccess: vi.fn(),
      transferPurchase: vi.fn(),
      generateMagicLink: vi.fn(),
      searchContent: mockSearchContent,
    }

    const handler = createSupportHandler({
      integration,
      webhookSecret: 'test-secret',
    })

    const request: ContentSearchRequest = {
      query: 'typescript generics',
      types: ['lesson', 'article'],
      limit: 10,
    }

    const body = JSON.stringify({
      action: 'searchContent',
      ...request,
    })

    const timestamp = Math.floor(Date.now() / 1000)
    const crypto = await import('crypto')
    const signature = crypto
      .createHmac('sha256', 'test-secret')
      .update(`${timestamp}.${body}`)
      .digest('hex')

    const req = new Request('https://example.com/api/support', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-support-signature': `timestamp=${timestamp},v1=${signature}`,
      },
      body,
    })

    const response = await handler(req)

    expect(response.status).toBe(200)
    expect(mockSearchContent).toHaveBeenCalledTimes(1)
    // Handler passes the entire body (including action field) as ContentSearchRequest
    // The integration receives { action, query, types, limit }
    const callArg = mockSearchContent.mock.calls[0]![0]
    expect(callArg).toMatchObject(request)
    expect(callArg).toHaveProperty('action', 'searchContent')

    const responseData = await response.json()
    expect(responseData).toEqual({
      results: [
        {
          id: 'lesson-1',
          type: 'lesson',
          title: 'Test Lesson',
          url: 'https://example.com/lesson',
        },
      ],
    })
  })

  it('should return 501 when searchContent not implemented', async () => {
    const integration: SupportIntegration = {
      lookupUser: vi.fn(),
      getPurchases: vi.fn(),
      revokeAccess: vi.fn(),
      transferPurchase: vi.fn(),
      generateMagicLink: vi.fn(),
      // searchContent not implemented
    }

    const handler = createSupportHandler({
      integration,
      webhookSecret: 'test-secret',
    })

    const body = JSON.stringify({
      action: 'searchContent',
      query: 'test',
    })

    const timestamp = Math.floor(Date.now() / 1000)
    const crypto = await import('crypto')
    const signature = crypto
      .createHmac('sha256', 'test-secret')
      .update(`${timestamp}.${body}`)
      .digest('hex')

    const req = new Request('https://example.com/api/support', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-support-signature': `timestamp=${timestamp},v1=${signature}`,
      },
      body,
    })

    const response = await handler(req)

    expect(response.status).toBe(501)

    const responseData = await response.json()
    expect(responseData).toEqual({
      error: 'Method not implemented: searchContent',
    })
  })

  it('should validate action field is present', async () => {
    const integration: SupportIntegration = {
      lookupUser: vi.fn(),
      getPurchases: vi.fn(),
      revokeAccess: vi.fn(),
      transferPurchase: vi.fn(),
      generateMagicLink: vi.fn(),
    }

    const handler = createSupportHandler({
      integration,
      webhookSecret: 'test-secret',
    })

    const body = JSON.stringify({
      query: 'test', // missing action field
    })

    const timestamp = Math.floor(Date.now() / 1000)
    const crypto = await import('crypto')
    const signature = crypto
      .createHmac('sha256', 'test-secret')
      .update(`${timestamp}.${body}`)
      .digest('hex')

    const req = new Request('https://example.com/api/support', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-support-signature': `timestamp=${timestamp},v1=${signature}`,
      },
      body,
    })

    const response = await handler(req)

    expect(response.status).toBe(400)

    const responseData = await response.json()
    expect(responseData).toEqual({ error: 'Missing action field' })
  })
})
