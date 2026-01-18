import { AppsTable, database } from '@skillrecordings/database'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock token function that can be reconfigured per test
const mockOauthToken = vi.fn()

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(),
      delete: vi.fn(),
    })
  ),
}))

vi.mock('@skillrecordings/database', () => ({
  database: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
  AppsTable: {},
  eq: vi.fn(),
}))

vi.mock('stripe', () => {
  class MockStripeInvalidGrantError extends Error {
    name = 'StripeInvalidGrantError'
  }

  const StripeMock = vi.fn(() => ({
    oauth: {
      token: mockOauthToken,
    },
  }))

  // Attach errors to the constructor
  ;(StripeMock as any).errors = {
    StripeInvalidGrantError: MockStripeInvalidGrantError,
  }

  return {
    default: StripeMock,
  }
})

// Import route AFTER mocks are defined
const { GET } = await import(
  '../../../../../app/api/stripe/connect/callback/route'
)

describe('OAuth callback route', () => {
  const mockCookies = {
    get: vi.fn(),
    delete: vi.fn(),
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockOauthToken.mockReset()
    const nextHeaders = await import('next/headers')
    vi.mocked(nextHeaders.cookies).mockResolvedValue(mockCookies as any)
    process.env.NEXT_PUBLIC_URL = 'http://localhost:4100'
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
  })

  it('should redirect with error when access_denied', async () => {
    const req = new NextRequest(
      'http://localhost:4100/api/stripe/connect/callback?error=access_denied'
    )

    const response = await GET(req)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:4100/settings/integrations?error=denied'
    )
  })

  it('should redirect with error when state mismatches', async () => {
    mockCookies.get.mockImplementation((name: string) => {
      if (name === 'stripe_oauth_state') return { value: 'saved-state' }
      if (name === 'stripe_oauth_app') return { value: 'total-typescript' }
      return undefined
    })

    const req = new NextRequest(
      'http://localhost:4100/api/stripe/connect/callback?code=auth_code&state=wrong-state'
    )

    const response = await GET(req)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:4100/settings/integrations?error=invalid_state'
    )
  })

  it('should redirect with error when app slug is missing', async () => {
    mockCookies.get.mockImplementation((name: string) => {
      if (name === 'stripe_oauth_state') return { value: 'same-state' }
      return undefined
    })

    const req = new NextRequest(
      'http://localhost:4100/api/stripe/connect/callback?code=auth_code&state=same-state'
    )

    const response = await GET(req)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:4100/settings/integrations?error=missing_app'
    )
  })

  it('should exchange code and update database on success', async () => {
    mockCookies.get.mockImplementation((name: string) => {
      if (name === 'stripe_oauth_state') return { value: 'same-state' }
      if (name === 'stripe_oauth_app') return { value: 'total-typescript' }
      return undefined
    })

    mockOauthToken.mockResolvedValue({ stripe_user_id: 'acct_123' })

    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })
    vi.mocked(database.update).mockReturnValue(mockUpdate() as any)

    const req = new NextRequest(
      'http://localhost:4100/api/stripe/connect/callback?code=auth_code&state=same-state'
    )

    const response = await GET(req)

    expect(mockOauthToken).toHaveBeenCalledWith({
      grant_type: 'authorization_code',
      code: 'auth_code',
    })
    expect(database.update).toHaveBeenCalledWith(AppsTable)
    expect(mockCookies.delete).toHaveBeenCalledWith('stripe_oauth_state')
    expect(mockCookies.delete).toHaveBeenCalledWith('stripe_oauth_app')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:4100/settings/integrations?success=connected'
    )
  })

  it('should handle expired code error', async () => {
    mockCookies.get.mockImplementation((name: string) => {
      if (name === 'stripe_oauth_state') return { value: 'same-state' }
      if (name === 'stripe_oauth_app') return { value: 'total-typescript' }
      return undefined
    })

    const { default: Stripe } = await import('stripe')
    mockOauthToken.mockRejectedValue(
      new Stripe.errors.StripeInvalidGrantError({
        type: 'invalid_grant',
        message: 'Authorization code expired',
      })
    )

    const req = new NextRequest(
      'http://localhost:4100/api/stripe/connect/callback?code=[REDACTED]&state=same-state'
    )

    const response = await GET(req)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:4100/settings/integrations?error=expired'
    )
  })

  it('should handle general oauth errors', async () => {
    mockCookies.get.mockImplementation((name: string) => {
      if (name === 'stripe_oauth_state') return { value: 'same-state' }
      if (name === 'stripe_oauth_app') return { value: 'total-typescript' }
      return undefined
    })

    mockOauthToken.mockRejectedValue(new Error('Network error'))

    const req = new NextRequest(
      'http://localhost:4100/api/stripe/connect/callback?code=auth_code&state=same-state'
    )

    const response = await GET(req)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:4100/settings/integrations?error=oauth_failed'
    )
  })
})
