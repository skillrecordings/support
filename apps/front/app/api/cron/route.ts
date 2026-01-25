import { headers } from 'next/headers'
import { log, initializeAxiom } from '@skillrecordings/core/observability/axiom'

export const dynamic = 'force-dynamic'

/**
 * Cron endpoint that refreshes Inngest function registration.
 * Runs every 5 minutes via Vercel Crons.
 * 
 * This ensures new/updated workflows are registered with Inngest Cloud.
 */
export async function GET(request: Request) {
  initializeAxiom()
  
  // Verify this is a legitimate Vercel cron call (optional but good practice)
  const headersList = await headers()
  const isVercelCron = headersList.get('x-vercel-cron') === '1'
  const userAgent = headersList.get('user-agent') || ''
  
  await log('info', 'cron triggered', {
    workflow: 'inngest-refresh-cron',
    isVercelCron,
    userAgent: userAgent.slice(0, 100),
  })

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  try {
    const response = await fetch(`${baseUrl}/api/inngest`, {
      method: 'PUT',
    })

    const status = response.status
    const ok = response.ok

    await log('info', 'inngest refresh completed', {
      workflow: 'inngest-refresh-cron',
      baseUrl,
      status,
      ok,
    })

    if (!ok) {
      await log('error', 'inngest refresh failed', {
        workflow: 'inngest-refresh-cron',
        status,
        statusText: response.statusText,
      })
    }

    return new Response(JSON.stringify({ ok, status }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    await log('error', 'inngest refresh error', {
      workflow: 'inngest-refresh-cron',
      error: error instanceof Error ? error.message : String(error),
    })

    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
