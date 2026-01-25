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
  
  const headersList = await headers()
  const isVercelCron = headersList.get('x-vercel-cron') === '1'
  const userAgent = headersList.get('user-agent') || ''
  
  await log('info', 'cron triggered', {
    workflow: 'inngest-refresh-cron',
    isVercelCron,
    userAgent: userAgent.slice(0, 100),
  })

  // Use request URL origin to stay on the same deployment
  // VERCEL_URL can point to preview deploys with auth protection
  const url = new URL(request.url)
  const baseUrl = url.origin

  await log('debug', 'cron using baseUrl', {
    workflow: 'inngest-refresh-cron',
    baseUrl,
    vercelUrl: process.env.VERCEL_URL,
  })

  try {
    const response = await fetch(`${baseUrl}/api/inngest`, {
      method: 'PUT',
    })

    const status = response.status
    const ok = response.ok
    let body = ''
    try {
      body = await response.text()
    } catch {}

    await log('info', 'inngest refresh completed', {
      workflow: 'inngest-refresh-cron',
      baseUrl,
      status,
      ok,
      body: body.slice(0, 500),
    })

    if (!ok) {
      await log('error', 'inngest refresh failed', {
        workflow: 'inngest-refresh-cron',
        status,
        statusText: response.statusText,
        body: body.slice(0, 500),
      })
    }

    return new Response(JSON.stringify({ ok, status, body: body.slice(0, 200) }), {
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
