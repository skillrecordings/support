import { createHmac } from 'node:crypto'
import { AppsTable, closeDb, eq, getDb } from '@skillrecordings/database'
import { type CommandContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

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

const handleHealthError = (
  ctx: CommandContext,
  error: unknown,
  message: string,
  suggestion = 'Verify the app configuration and try again.'
): void => {
  const cliError =
    error instanceof CLIError
      ? error
      : new CLIError({
          userMessage: message,
          suggestion,
          cause: error,
        })

  ctx.output.error(formatError(cliError))
  process.exitCode = cliError.exitCode
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
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-support-signature': signature,
      },
      body,
    })

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
 * Look up an app by slug from the database
 */
async function lookupApp(
  slugOrUrl: string
): Promise<{ baseUrl: string; secret: string } | null> {
  // If it looks like a URL, return null (use direct mode)
  if (slugOrUrl.startsWith('http://') || slugOrUrl.startsWith('https://')) {
    return null
  }

  try {
    const db = getDb()
    const app = await db
      .select({
        integration_base_url: AppsTable.integration_base_url,
        webhook_secret: AppsTable.webhook_secret,
      })
      .from(AppsTable)
      .where(eq(AppsTable.slug, slugOrUrl))
      .limit(1)

    const record = app[0]
    if (!record) {
      return null
    }

    return {
      baseUrl: record.integration_base_url,
      secret: record.webhook_secret,
    }
  } catch (err) {
    throw new CLIError({
      userMessage: 'Database lookup failed.',
      suggestion: 'Ensure DATABASE_URL is configured and reachable.',
      cause: err,
    })
  }
}

/**
 * List all registered apps
 */
async function listApps(
  ctx: CommandContext,
  outputJson: boolean
): Promise<void> {
  try {
    const db = getDb()
    const apps = await db
      .select({
        slug: AppsTable.slug,
        name: AppsTable.name,
        integration_base_url: AppsTable.integration_base_url,
      })
      .from(AppsTable)

    if (!apps.length) {
      if (outputJson) {
        ctx.output.data([])
      } else {
        ctx.output.data('No apps registered.')
      }
      await closeDb()
      return
    }

    if (outputJson) {
      ctx.output.data(apps)
    } else {
      ctx.output.data('\nRegistered apps:\n')
      for (const app of apps) {
        ctx.output.data(`  ${app.slug}`)
        ctx.output.data(`    Name: ${app.name}`)
        ctx.output.data(`    URL:  ${app.integration_base_url}\n`)
      }
    }
    await closeDb()
  } catch (err) {
    await closeDb()
    throw err
  }
}

/**
 * Health check command - tests integration endpoint connectivity and capabilities
 *
 * Agent-friendly: all options are non-interactive.
 * Use --json for machine-readable output.
 *
 * Usage:
 *   skill health <slug>              - Look up app by slug from database
 *   skill health <url> --secret xxx  - Direct URL mode
 *   skill health --list              - List all registered apps
 *   skill health <slug> --json       - Output as JSON
 */
export async function health(
  ctx: CommandContext,
  slugOrUrl: string | undefined,
  options: { secret?: string; list?: boolean; json?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    // Handle --list flag
    if (options.list) {
      await listApps(ctx, outputJson)
      return
    }

    if (!slugOrUrl) {
      throw new CLIError({
        userMessage:
          'App slug or URL required. Usage: skill health <slug|url> [--secret <secret>].',
        suggestion: 'Run "skill health --list" to see registered apps.',
      })
    }

    let baseUrl: string
    let secret: string

    // Try database lookup first
    const appConfig = await lookupApp(slugOrUrl)

    if (appConfig) {
      // Found in database
      baseUrl = appConfig.baseUrl.endsWith('/api/support')
        ? appConfig.baseUrl
        : appConfig.baseUrl.replace(/\/$/, '') + '/api/support'
      secret = appConfig.secret
      if (!outputJson) {
        ctx.output.message(`Using app configuration for: ${slugOrUrl}`)
      }
    } else if (
      slugOrUrl.startsWith('http://') ||
      slugOrUrl.startsWith('https://')
    ) {
      // Direct URL mode
      const secretValue = options.secret || process.env.SUPPORT_WEBHOOK_SECRET
      if (!secretValue) {
        throw new CLIError({
          userMessage:
            'Webhook secret required for direct URL mode. Use --secret or set SUPPORT_WEBHOOK_SECRET.',
          suggestion:
            'Pass --secret or export SUPPORT_WEBHOOK_SECRET before running.',
        })
      }
      baseUrl = slugOrUrl.endsWith('/api/support')
        ? slugOrUrl
        : slugOrUrl.replace(/\/$/, '') + '/api/support'
      secret = secretValue
    } else {
      // Slug not found in database
      throw new CLIError({
        userMessage: `App "${slugOrUrl}" not found in database.`,
        suggestion: 'Use --list to see registered apps, or provide a full URL.',
      })
    }

    if (!outputJson) {
      ctx.output.data(`\nHealth check: ${baseUrl}\n`)
    }

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

    if (!outputJson) {
      ctx.output.data('Testing required actions...')
    }
    for (const { name, params } of requiredActions) {
      const result = await testAction(baseUrl, secret, name, params)
      results.actions.push({ name, ...result })

      if (!outputJson) {
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
        ctx.output.data(
          `  ${color}${icon}\x1b[0m ${name}${result.error ? ` - ${result.error}` : ''}`
        )
      }

      if (result.status === 'error') {
        results.status = 'error'
      }
    }

    if (!outputJson) {
      ctx.output.data('\nTesting optional actions...')
    }
    for (const { name, params } of optionalActions) {
      const result = await testAction(baseUrl, secret, name, params)
      results.actions.push({ name, ...result })

      if (!outputJson) {
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
        ctx.output.data(
          `  ${color}${icon}\x1b[0m ${name}${result.error ? ` - ${result.error}` : ''}`
        )
      }
    }

    results.responseTime = Date.now() - start

    // Summary
    const okCount = results.actions.filter((a) => a.status === 'ok').length
    const errorCount = results.actions.filter(
      (a) => a.status === 'error'
    ).length
    const notImplementedCount = results.actions.filter(
      (a) => a.status === 'not_implemented'
    ).length

    // JSON output includes success flag
    const jsonResult = {
      success: results.status !== 'error',
      ...results,
      summary: {
        ok: okCount,
        notImplemented: notImplementedCount,
        errors: errorCount,
      },
    }

    if (outputJson) {
      ctx.output.data(jsonResult)
    } else {
      ctx.output.data(`\n─────────────────────────────`)
      ctx.output.data(`Total time: ${results.responseTime}ms`)
      ctx.output.data(
        `Actions: \x1b[32m${okCount} ok\x1b[0m, \x1b[33m${notImplementedCount} not implemented\x1b[0m, \x1b[31m${errorCount} errors\x1b[0m`
      )

      if (results.status === 'error') {
        ctx.output.data(`\n\x1b[31m✗ Health check failed\x1b[0m\n`)
      } else {
        ctx.output.data(`\n\x1b[32m✓ Health check passed\x1b[0m\n`)
      }
    }

    await closeDb()
    process.exitCode = results.status === 'error' ? 1 : 0
  } catch (error) {
    await closeDb()
    handleHealthError(ctx, error, 'Health check failed.')
  }
}
