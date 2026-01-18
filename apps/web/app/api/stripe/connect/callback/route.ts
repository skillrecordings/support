import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { database, AppsTable, eq } from '@skillrecordings/database'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

/**
 * OAuth callback handler for Stripe Connect
 *
 * Handles the return flow from Stripe's OAuth authorization:
 * 1. Validates state parameter (CSRF protection)
 * 2. Exchanges authorization code for connected account ID
 * 3. Updates app record with Stripe account details
 * 4. Redirects to success/error page
 */
export async function GET(request: NextRequest) {
	const url = request.nextUrl
	const code = url.searchParams.get('code')
	const state = url.searchParams.get('state')
	const error = url.searchParams.get('error')

	const baseUrl = process.env.NEXT_PUBLIC_URL || ''

	// Handle user denying access
	if (error === 'access_denied') {
		return NextResponse.redirect(
			new URL('/settings/integrations?error=denied', baseUrl),
		)
	}

	const cookieStore = await cookies()
	const savedState = cookieStore.get('stripe_oauth_state')?.value
	const appSlug = cookieStore.get('stripe_oauth_app')?.value

	// CSRF protection: verify state matches
	if (state !== savedState) {
		return NextResponse.redirect(
			new URL('/settings/integrations?error=invalid_state', baseUrl),
		)
	}

	// Ensure we have the app slug from cookie
	if (!appSlug) {
		return NextResponse.redirect(
			new URL('/settings/integrations?error=missing_app', baseUrl),
		)
	}

	try {
		// Exchange authorization code for access token and account ID
		const response = await stripe.oauth.token({
			grant_type: 'authorization_code',
			code: code!,
		})

		const stripeAccountId = response.stripe_user_id

		// Update app record with connected account details
		await database
			.update(AppsTable)
			.set({
				stripe_account_id: stripeAccountId,
				stripe_connected: true,
			})
			.where(eq(AppsTable.slug, appSlug))

		// Clean up OAuth cookies
		cookieStore.delete('stripe_oauth_state')
		cookieStore.delete('stripe_oauth_app')

		return NextResponse.redirect(
			new URL('/settings/integrations?success=connected', baseUrl),
		)
	} catch (err) {
		// Handle expired or invalid authorization code
		if (err instanceof Stripe.errors.StripeInvalidGrantError) {
			return NextResponse.redirect(
				new URL('/settings/integrations?error=expired', baseUrl),
			)
		}

		// Log unexpected errors
		console.error('Stripe OAuth error:', err)

		return NextResponse.redirect(
			new URL('/settings/integrations?error=oauth_failed', baseUrl),
		)
	}
}
