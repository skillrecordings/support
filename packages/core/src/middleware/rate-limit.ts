import type {
  Middleware,
  RateLimitConfig,
  RateLimitResult,
  RateLimiter,
} from './types'

/**
 * Sliding window rate limiter implementation
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const { windowMs, maxRequests } = config

  // Store timestamps of requests per key
  const requestTimestamps = new Map<string, number[]>()

  return {
    check(key: string): RateLimitResult {
      const now = Date.now()
      const windowStart = now - windowMs

      // Get existing timestamps for this key
      let timestamps = requestTimestamps.get(key) || []

      // Remove timestamps outside the sliding window (cleanup)
      timestamps = timestamps.filter((timestamp) => timestamp > windowStart)

      // Check if under limit
      if (timestamps.length < maxRequests) {
        // Add current timestamp
        timestamps.push(now)
        requestTimestamps.set(key, timestamps)

        return {
          allowed: true,
          remaining: maxRequests - timestamps.length,
          resetAt: now + windowMs,
        }
      }

      // Over limit - calculate retry after
      const oldestTimestamp = timestamps[0] ?? now
      const resetAt = oldestTimestamp + windowMs
      const retryAfter = Math.ceil((resetAt - now) / 1000) // seconds

      return {
        allowed: false,
        remaining: 0,
        retryAfter,
        resetAt,
      }
    },
  }
}

/**
 * Rate limiting middleware factory
 *
 * Returns 429 with Retry-After header when limit exceeded
 */
export function rateLimitMiddleware(limiter: RateLimiter): Middleware {
  return async (req, context, next) => {
    const key = context.appId
    const result = limiter.check(key)

    if (!result.allowed) {
      return createRateLimitResponse(result)
    }

    const response = await next()
    return addRateLimitHeaders(response, result)
  }
}

/**
 * Create 429 response with rate limit headers
 */
function createRateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfter),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(
          result.resetAt ? Math.floor(result.resetAt / 1000) : 0
        ),
      },
    }
  )
}

/**
 * Add rate limit headers to response
 */
function addRateLimitHeaders(
  response: Response,
  result: RateLimitResult
): Response {
  const headers = new Headers(response.headers)
  const limit = result.remaining + 1 // remaining + current = max
  headers.set('X-RateLimit-Limit', String(limit))
  headers.set('X-RateLimit-Remaining', String(result.remaining))
  headers.set(
    'X-RateLimit-Reset',
    String(result.resetAt ? Math.floor(result.resetAt / 1000) : 0)
  )

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
