import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET() {
	await headers()
	const baseUrl = process.env.VERCEL_URL
		? `https://${process.env.VERCEL_URL}`
		: 'http://localhost:3000'

	console.log(
		'refreshing inngest',
		await fetch(`${baseUrl}/api/inngest`, {
			method: 'PUT',
		}),
	)
	return new Response(null, {
		status: 200,
	})
}
