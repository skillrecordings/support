import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

/**
 * OAuth authorization endpoint for Stripe Connect
 *
 * Initiates the OAuth flow by redirecting the user to Stripe's authorization page.
 * Generates and stores a CSRF token (state) to prevent authorization code interception attacks.
 *
 * @param request - Next.js request object
 * @returns Redirect to Stripe OAuth or error redirect
 */
export async function GET(request: NextRequest) {
  const appSlug = request.nextUrl.searchParams.get('appSlug')

  if (!appSlug) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=missing_app', request.url)
    )
  }

  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID
  if (!clientId) {
    throw new Error('STRIPE_CONNECT_CLIENT_ID is not configured')
  }

  // Generate CSRF token
  const state = crypto.randomUUID()
  const cookieStore = await cookies()

  // Store state and app context in httpOnly cookies
  cookieStore.set('stripe_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  })

  cookieStore.set('stripe_oauth_app', appSlug, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
  })

  // Build OAuth authorization URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    redirect_uri: `${process.env.NEXT_PUBLIC_URL}/api/stripe/connect/callback`,
    state,
  })

  return NextResponse.redirect(
    `https://connect.stripe.com/oauth/authorize?${params}`
  )
}
