import { createHmac } from 'node:crypto'

interface HealthCheckResult {
  endpoint: string
  status: 'ok' | 'error'
  responseTime: number
  actions: {
    name: string
    status: 'ok' | 'error' | 'not_implemented'
    error?: string
  }[]
}

/**
 * Sign a request payload with HMAC-SHA256
 */
function signRequest(body: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const payload = `${timestamp}.${body}`
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return `timestamp=${timestamp},v1=${signature}`
}

/**
 * Test a single action against the integration endpoint
 */
async function testAction(
  baseUrl: string,
  secret: string,
  action: string,
  params: Record<string, unknown>
): Promise<{ status: 'ok' | 'error' | 'not_implemented'; error?: string }> {
  const body = JSON.stringify({ action, ...params })
  const signature = signRequest(body, secret)

  try {
    const start = Date.now()
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-support-signature': signature,
      },
      body,
    })
    const elapsed = Date.now() - start

    if (response.status === 501) {
      return { status: 'not_implemented' }
    }

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      return {
        status: 'error',
        error: `${response.status}: ${data.error || response.statusText}`,
      }
    }

    return { status: 'ok' }
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Health check command - tests integration endpoint connectivity and capabilities
 */
export async function health(
  url: string,
  options: { secret?: string }
): Promise<void> {
  const secret = options.secret || process.env.SUPPORT_WEBHOOK_SECRET

  if (!secret) {
    console.error(
      'Error: Webhook secret required. Use --secret or set SUPPORT_WEBHOOK_SECRET'
    )
    process.exit(1)
  }

  // Normalize URL
  const baseUrl = url.endsWith('/api/support')
    ? url
    : url.replace(/\/$/, '') + '/api/support'

  console.log(`\nHealth check: ${baseUrl}\n`)

  const start = Date.now()
  const results: HealthCheckResult = {
    endpoint: baseUrl,
    status: 'ok',
    responseTime: 0,
    actions: [],
  }

  // Test required actions
  const requiredActions = [
    { name: 'lookupUser', params: { email: '[EMAIL]' } },
    { name: 'getPurchases', params: { userId: 'health-check-user-id' } },
  ]

  // Test optional actions
  const optionalActions = [
    { name: 'getSubscriptions', params: { userId: 'health-check-user-id' } },
    {
      name: 'generateMagicLink',
      params: { email: '[EMAIL]', expiresIn: 60 },
    },
    {
      name: 'getClaimedSeats',
      params: { bulkCouponId: 'health-check-coupon-id' },
    },
  ]

  console.log('Testing required actions...')
  for (const { name, params } of requiredActions) {
    const result = await testAction(baseUrl, secret, name, params)
    results.actions.push({ name, ...result })

    const icon =
      result.status === 'ok'
        ? '✓'
        : result.status === 'not_implemented'
          ? '○'
          : '✗'
    const color =
      result.status === 'ok'
        ? '\x1b[32m'
        : result.status === 'not_implemented'
          ? '\x1b[33m'
          : '\x1b[31m'
    console.log(
      `  ${color}${icon}\x1b[0m ${name}${result.error ? ` - ${result.error}` : ''}`
    )

    if (result.status === 'error') {
      results.status = 'error'
    }
  }

  console.log('\nTesting optional actions...')
  for (const { name, params } of optionalActions) {
    const result = await testAction(baseUrl, secret, name, params)
    results.actions.push({ name, ...result })

    const icon =
      result.status === 'ok'
        ? '✓'
        : result.status === 'not_implemented'
          ? '○'
          : '✗'
    const color =
      result.status === 'ok'
        ? '\x1b[32m'
        : result.status === 'not_implemented'
          ? '\x1b[33m'
          : '\x1b[31m'
    console.log(
      `  ${color}${icon}\x1b[0m ${name}${result.error ? ` - ${result.error}` : ''}`
    )
  }

  results.responseTime = Date.now() - start

  // Summary
  const okCount = results.actions.filter((a) => a.status === 'ok').length
  const errorCount = results.actions.filter((a) => a.status === 'error').length
  const notImplementedCount = results.actions.filter(
    (a) => a.status === 'not_implemented'
  ).length

  console.log(`\n─────────────────────────────`)
  console.log(`Total time: ${results.responseTime}ms`)
  console.log(
    `Actions: \x1b[32m${okCount} ok\x1b[0m, \x1b[33m${notImplementedCount} not implemented\x1b[0m, \x1b[31m${errorCount} errors\x1b[0m`
  )

  if (results.status === 'error') {
    console.log(`\n\x1b[31m✗ Health check failed\x1b[0m\n`)
    process.exit(1)
  } else {
    console.log(`\n\x1b[32m✓ Health check passed\x1b[0m\n`)
  }
}
