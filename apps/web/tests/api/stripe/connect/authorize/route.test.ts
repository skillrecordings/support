import { describe, expect, it, beforeEach, vi } from 'vitest'
import { GET } from '@/app/api/stripe/connect/authorize/route'
import { NextRequest } from 'next/server'

// Mock Next.js cookies
const mockSet = vi.fn()
const mockGet = vi.fn()

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      set: mockSet,
      get: mockGet,
    })
  ),
}))

describe('GET /api/stripe/connect/authorize', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      STRIPE_CONNECT_CLIENT_ID: 'ca_test123',
      NEXT_PUBLIC_URL: 'http://localhost:4100',
      NODE_ENV: 'test',
    }
  })

  it('redirects to Stripe OAuth URL with correct parameters', async () => {
    const request = new NextRequest(
      'http://localhost:4100/api/stripe/connect/authorize?appSlug=total-typescript'
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toBeDefined()

    const url = new URL(location!)
    expect(url.origin).toBe('https://connect.stripe.com')
    expect(url.pathname).toBe('/oauth/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('ca_test123')
    expect(url.searchParams.get('scope')).toBe('read_write')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4100/api/stripe/connect/callback'
    )
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('sets state and app cookies with correct options', async () => {
    const request = new NextRequest(
      'http://localhost:4100/api/stripe/connect/authorize?appSlug=total-typescript'
    )

    await GET(request)

    expect(mockSet).toHaveBeenCalledWith(
      'stripe_oauth_state',
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        secure: false, // NODE_ENV=test
        sameSite: 'lax',
        maxAge: 600,
      })
    )

    expect(mockSet).toHaveBeenCalledWith(
      'stripe_oauth_app',
      'total-typescript',
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 600,
      })
    )
  })

  it('redirects to settings with error when appSlug is missing', async () => {
    const request = new NextRequest(
      'http://localhost:4100/api/stripe/connect/authorize'
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toBe('http://localhost:4100/settings/integrations?error=missing_app')
  })

  it('throws error when STRIPE_CONNECT_CLIENT_ID is not set', async () => {
    delete process.env.STRIPE_CONNECT_CLIENT_ID

    const request = new NextRequest(
      'http://localhost:4100/api/stripe/connect/authorize?appSlug=total-typescript'
    )

    await expect(GET(request)).rejects.toThrow()
  })
})
