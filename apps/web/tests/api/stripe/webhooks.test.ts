import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'

// Set required env vars before imports
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock_secret'

// Mock the inngest client
vi.mock('@skillrecordings/core/inngest', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock Stripe with a properly typed mock
const mockConstructEvent = vi.fn()

vi.mock('stripe', () => {
  const MockStripe = vi.fn(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }))
  return { default: MockStripe }
})

// Import after mocks are set up
const { POST } = await import('../../../app/api/stripe/webhooks/route')

describe('POST /api/stripe/webhooks', () => {
  const mockBody = JSON.stringify({
    id: 'evt_test_123',
    type: 'charge.succeeded',
    data: {
      object: {
        id: 'ch_test_123',
        amount: 1000,
      },
    },
  })

  const validSignature = 'valid_signature_hash'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when stripe-signature header is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      body: mockBody,
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toBe('Missing signature')
  })

  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('Invalid signature')
    })

    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      headers: {
        'stripe-signature': 'invalid_signature',
      },
      body: mockBody,
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toBe('Invalid signature')
  })

  it('successfully processes valid webhook and sends to Inngest', async () => {
    const mockEvent: Stripe.Event = {
      id: 'evt_test_123',
      object: 'event',
      type: 'charge.succeeded',
      data: {
        object: {
          id: 'ch_test_123',
          object: 'charge',
          amount: 1000,
        } as Stripe.Charge,
      },
      created: Date.now(),
      livemode: false,
      pending_webhooks: 0,
      request: null,
      api_version: '2024-12-18.acacia',
    }

    mockConstructEvent.mockReturnValueOnce(mockEvent)

    const { inngest } = await import('@skillrecordings/core/inngest')

    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: mockBody,
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.received).toBe(true)
    expect(inngest.send).toHaveBeenCalledWith({
      name: 'stripe/event.received',
      data: {
        type: 'charge.succeeded',
        data: mockEvent.data.object,
        accountId: undefined,
      },
    })
  })

  it('includes accountId when event is from connected account', async () => {
    const mockEvent: Stripe.Event = {
      id: 'evt_test_123',
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_test_123',
          object: 'charge',
          amount: 1000,
        } as Stripe.Charge,
      },
      created: Date.now(),
      livemode: false,
      pending_webhooks: 0,
      request: null,
      api_version: '2024-12-18.acacia',
      account: 'acct_connected_123',
    }

    mockConstructEvent.mockReturnValueOnce(mockEvent)

    const { inngest } = await import('@skillrecordings/core/inngest')

    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: mockBody,
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.received).toBe(true)
    expect(inngest.send).toHaveBeenCalledWith({
      name: 'stripe/event.received',
      data: {
        type: 'charge.refunded',
        data: mockEvent.data.object,
        accountId: 'acct_connected_123',
      },
    })
  })
})

