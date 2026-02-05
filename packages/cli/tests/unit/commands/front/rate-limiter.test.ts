import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RATE_LIMITER_CONFIG,
  FrontRateLimiter,
} from '../../../../src/commands/front/rate-limiter'

describe('FrontRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-04T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests under budget', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      minGapMs: 0,
    })

    await limiter.acquire()
    await limiter.acquire()

    const stats = limiter.stats()
    expect(stats.requestsInWindow).toBe(2)
  })

  it('queues requests over budget', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      minGapMs: 0,
    })

    await limiter.acquire()

    let resolved = false
    const queued = limiter.acquire().then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    vi.advanceTimersByTime(1000)
    await vi.runOnlyPendingTimersAsync()
    await queued

    expect(resolved).toBe(true)
  })

  it('rejects when queue is full', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      minGapMs: 0,
      maxQueueDepth: 1,
    })

    await limiter.acquire()
    const queued = limiter.acquire()

    await expect(limiter.acquire()).rejects.toThrow('Rate limiter queue full')

    vi.advanceTimersByTime(1000)
    await vi.runOnlyPendingTimersAsync()
    await queued
  })

  it('enforces minimum gap between requests', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      minGapMs: 200,
    })

    await limiter.acquire()

    let resolved = false
    const next = limiter.acquire().then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    vi.advanceTimersByTime(200)
    await vi.runOnlyPendingTimersAsync()
    await next
    expect(resolved).toBe(true)
  })

  it('drains queue as budget replenishes', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      minGapMs: 0,
    })

    await limiter.acquire()
    let resolved = false
    const queued = limiter.acquire().then(() => {
      resolved = true
    })

    vi.advanceTimersByTime(1000)
    await vi.runOnlyPendingTimersAsync()
    await queued
    expect(resolved).toBe(true)
  })

  it('record429 pauses requests for retry-after duration', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      minGapMs: 0,
    })

    limiter.record429(500)

    let resolved = false
    const pending = limiter.acquire().then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    vi.advanceTimersByTime(500)
    await vi.runOnlyPendingTimersAsync()
    await pending
    expect(resolved).toBe(true)
  })

  it('stats returns correct utilization', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 4,
      windowMs: 1000,
      minGapMs: 0,
    })

    await limiter.acquire()
    await limiter.acquire()

    const stats = limiter.stats()
    expect(stats.requestsInWindow).toBe(2)
    expect(stats.maxRequests).toBe(4)
    expect(stats.utilizationPct).toBe(50)
  })

  it('reset clears all state and rejects queued', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      minGapMs: 0,
    })

    await limiter.acquire()
    const queued = limiter.acquire()
    limiter.reset()

    await expect(queued).rejects.toThrow('Rate limiter reset')
    expect(limiter.stats().requestsInWindow).toBe(0)
  })

  it('handles concurrent acquire calls', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      minGapMs: 0,
    })

    const events: string[] = []
    const a = limiter.acquire().then(() => events.push('a'))
    const b = limiter.acquire().then(() => events.push('b'))
    const c = limiter.acquire().then(() => events.push('c'))

    await vi.runAllTicks()
    expect(events).toEqual(['a', 'b'])

    vi.advanceTimersByTime(1000)
    await vi.runOnlyPendingTimersAsync()
    await Promise.all([a, b, c])

    expect(events).toEqual(['a', 'b', 'c'])
  })

  it('prunes old timestamps from window', async () => {
    const limiter = new FrontRateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      minGapMs: 0,
    })

    await limiter.acquire()
    await limiter.acquire()

    vi.advanceTimersByTime(1001)
    await vi.runOnlyPendingTimersAsync()

    await limiter.acquire()
    const stats = limiter.stats()
    expect(stats.requestsInWindow).toBe(1)
  })

  it('uses default configuration when no overrides provided', () => {
    const limiter = new FrontRateLimiter()
    const stats = limiter.stats()
    expect(stats.maxRequests).toBe(DEFAULT_RATE_LIMITER_CONFIG.maxRequests)
  })
})
