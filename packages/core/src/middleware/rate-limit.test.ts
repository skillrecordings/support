import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRateLimiter, rateLimitMiddleware } from './rate-limit'
import type { RateLimitConfig } from './types'

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should allow requests under the limit', () => {
    const limiter = createRateLimiter({
      windowMs: 60000, // 1 minute
      maxRequests: 10,
    })

    const result = limiter.check('user-1')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(9)
  })

  it('should block requests over the limit', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 3,
    })

    // Make 3 requests (all should succeed)
    limiter.check('user-1')
    limiter.check('user-1')
    limiter.check('user-1')

    // 4th request should be blocked
    const result = limiter.check('user-1')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it('should reset after window expires (sliding window)', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 2,
    })

    // Make 2 requests
    limiter.check('user-1')
    limiter.check('user-1')

    // Should be blocked
    expect(limiter.check('user-1').allowed).toBe(false)

    // Advance time by 61 seconds (past window)
    vi.advanceTimersByTime(61000)

    // Should be allowed again
    const result = limiter.check('user-1')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(1)
  })

  it('should handle concurrent requests for same key', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 5,
    })

    // Simulate 10 concurrent requests
    const results = Array.from({ length: 10 }, () => limiter.check('user-1'))

    // First 5 should succeed
    expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true)
    // Last 5 should fail
    expect(results.slice(5).every((r) => !r.allowed)).toBe(true)
  })

  it('should track different keys independently', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 2,
    })

    // Exhaust user-1's quota
    limiter.check('user-1')
    limiter.check('user-1')

    // user-2 should still have full quota
    const result = limiter.check('user-2')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(1)
  })

  it('should implement sliding window (not fixed window)', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 3,
    })

    // Make 3 requests at t=0
    limiter.check('user-1')
    limiter.check('user-1')
    limiter.check('user-1')

    // Advance 30 seconds
    vi.advanceTimersByTime(30000)

    // Should still be blocked (oldest request is only 30s old)
    expect(limiter.check('user-1').allowed).toBe(false)

    // Advance another 31 seconds (oldest request now 61s old)
    vi.advanceTimersByTime(31000)

    // Should be allowed (oldest request expired)
    expect(limiter.check('user-1').allowed).toBe(true)
  })
})

describe('rateLimitMiddleware', () => {
  it('should pass through when under limit', async () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
    })

    const middleware = rateLimitMiddleware(limiter)
    const mockReq = {
      headers: new Headers(),
      url: 'http://localhost/api/test',
    }
    const mockContext = {
      appId: 'test-app',
      userId: 'user-1',
    }

    const next = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }))

    const response = await middleware(mockReq as any, mockContext as any, next)

    expect(next).toHaveBeenCalled()
    expect(response.status).toBe(200)
  })

  it('should return 429 when over limit', async () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 1,
    })

    const middleware = rateLimitMiddleware(limiter)
    const mockReq = {
      headers: new Headers(),
      url: 'http://localhost/api/test',
    }
    const mockContext = {
      appId: 'test-app',
      userId: 'user-1',
    }

    const next = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }))

    // First request succeeds
    await middleware(mockReq as any, mockContext as any, next)

    // Second request should fail with 429
    const response = await middleware(mockReq as any, mockContext as any, next)

    expect(next).toHaveBeenCalledTimes(1) // Only called once
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBeTruthy()
  })

  it('should set X-RateLimit headers', async () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 5,
    })

    const middleware = rateLimitMiddleware(limiter)
    const mockReq = {
      headers: new Headers(),
      url: 'http://localhost/api/test',
    }
    const mockContext = {
      appId: 'test-app',
      userId: 'user-1',
    }

    const next = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }))

    const response = await middleware(mockReq as any, mockContext as any, next)

    expect(response.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('4')
    expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy()
  })

  it('should use appId as rate limit key', async () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 2,
    })

    const middleware = rateLimitMiddleware(limiter)
    const next = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }))

    // App 1 makes 2 requests
    await middleware(
      { headers: new Headers(), url: 'http://localhost/api/test' } as any,
      { appId: 'app-1' } as any,
      next
    )
    await middleware(
      { headers: new Headers(), url: 'http://localhost/api/test' } as any,
      { appId: 'app-1' } as any,
      next
    )

    // App 1's 3rd request should fail
    const app1Response = await middleware(
      { headers: new Headers(), url: 'http://localhost/api/test' } as any,
      { appId: 'app-1' } as any,
      next
    )
    expect(app1Response.status).toBe(429)

    // App 2 should still have full quota
    const app2Response = await middleware(
      { headers: new Headers(), url: 'http://localhost/api/test' } as any,
      { appId: 'app-2' } as any,
      next
    )
    expect(app2Response.status).toBe(200)
  })
})
