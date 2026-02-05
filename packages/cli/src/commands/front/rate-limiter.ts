export interface RateLimiterConfig {
  /** Max requests per window. Default: 80 (leave 20% headroom for webhooks/other users) */
  maxRequests: number
  /** Window size in ms. Default: 60_000 (1 minute) */
  windowMs: number
  /** Minimum gap between requests in ms. Default: 200 (smooths burst) */
  minGapMs: number
  /** Whether to queue and wait, or reject immediately. Default: 'queue' */
  overflowStrategy: 'queue' | 'reject'
  /** Max queue depth before rejecting. Default: 50 */
  maxQueueDepth: number
}

export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  maxRequests: 80,
  windowMs: 60_000,
  minGapMs: 200,
  overflowStrategy: 'queue',
  maxQueueDepth: 50,
}

type QueueItem = {
  resolve: () => void
  reject: (err: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export class FrontRateLimiter {
  private timestamps: number[] = []
  private lastRequestMs = 0
  private pausedUntilMs = 0
  private queue: QueueItem[] = []
  private draining = false
  private config: RateLimiterConfig

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config }
  }

  /** Update rate limiter configuration at runtime */
  updateConfig(config: Partial<RateLimiterConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** Call before making a request. Resolves when it's safe to proceed. */
  async acquire(signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal)

    const now = Date.now()
    const windowStart = now - this.config.windowMs
    this.timestamps = this.timestamps.filter((ts) => ts > windowStart)
    const overBudget = this.timestamps.length >= this.config.maxRequests

    if (!overBudget && this.queue.length === 0) {
      const pauseMs = this.getPauseMs(now)
      if (pauseMs > 0) {
        await this.sleep(pauseMs, signal)
      }
      const gapMs = this.getMinGapMs(Date.now())
      if (gapMs > 0) {
        await this.sleep(gapMs, signal)
      }
      this.timestamps.push(Date.now())
      this.lastRequestMs = Date.now()
      return
    }

    if (
      this.config.overflowStrategy === 'reject' &&
      (overBudget || this.queue.length > 0)
    ) {
      throw new Error(
        `Rate limit exceeded: ${this.config.maxRequests} requests per ${this.config.windowMs}ms`
      )
    }

    return this.enqueue(signal)
  }

  /** Record that a request was served from cache (no API call made) */
  recordCacheHit(): void {
    // No-op for rate limiting — cache hits don't consume API budget
  }

  /** Record a 429 response — adjust our window estimate */
  record429(retryAfterMs?: number): void {
    if (retryAfterMs && retryAfterMs > 0) {
      this.pausedUntilMs = Math.max(
        this.pausedUntilMs,
        Date.now() + retryAfterMs
      )
    }
  }

  /** Get current utilization stats */
  stats(): {
    requestsInWindow: number
    maxRequests: number
    utilizationPct: number
    queueDepth: number
    estimatedWaitMs: number
  } {
    const now = Date.now()
    const windowStart = now - this.config.windowMs
    const inWindow = this.timestamps.filter((ts) => ts > windowStart).length
    const utilization = (inWindow / this.config.maxRequests) * 100

    let estimatedWaitMs = 0
    if (inWindow >= this.config.maxRequests && this.timestamps.length > 0) {
      const oldest = this.timestamps[0]!
      estimatedWaitMs = Math.max(0, oldest + this.config.windowMs - now)
    }
    if (this.pausedUntilMs > now) {
      estimatedWaitMs = Math.max(estimatedWaitMs, this.pausedUntilMs - now)
    }

    return {
      requestsInWindow: inWindow,
      maxRequests: this.config.maxRequests,
      utilizationPct: Math.round(utilization),
      queueDepth: this.queue.length,
      estimatedWaitMs,
    }
  }

  /** Reset limiter state (for testing) */
  reset(): void {
    this.timestamps = []
    this.lastRequestMs = 0
    this.pausedUntilMs = 0
    for (const waiter of this.queue) {
      this.cleanupQueueItem(waiter)
      waiter.reject(new Error('Rate limiter reset'))
    }
    this.queue = []
    this.draining = false
  }

  private async startDraining(): Promise<void> {
    if (this.draining) return
    this.draining = true

    while (this.queue.length > 0) {
      const now = Date.now()

      const pauseMs = this.getPauseMs(now)
      if (pauseMs > 0) {
        await this.sleep(pauseMs)
        continue
      }

      const windowStart = now - this.config.windowMs
      this.timestamps = this.timestamps.filter((ts) => ts > windowStart)

      if (this.timestamps.length >= this.config.maxRequests) {
        const oldest = this.timestamps[0]!
        const waitMs = Math.max(100, oldest + this.config.windowMs - Date.now())
        await this.sleep(waitMs)
        continue
      }

      const gapMs = this.getMinGapMs(now)
      if (gapMs > 0) {
        await this.sleep(gapMs)
        continue
      }

      const waiter = this.shiftNextWaiter()
      if (!waiter) continue

      this.timestamps.push(Date.now())
      this.lastRequestMs = Date.now()
      this.cleanupQueueItem(waiter)
      waiter.resolve()
    }

    this.draining = false
  }

  private enqueue(signal?: AbortSignal): Promise<void> {
    if (this.queue.length >= this.config.maxQueueDepth) {
      return Promise.reject(
        new Error(
          `Rate limiter queue full (${this.config.maxQueueDepth} pending)`
        )
      )
    }

    return new Promise<void>((resolve, reject) => {
      const item: QueueItem = { resolve, reject, signal }
      if (signal) {
        const onAbort = () => {
          this.removeFromQueue(item)
          reject(new Error('Request aborted'))
        }
        item.onAbort = onAbort
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.queue.push(item)
      this.startDraining()
    })
  }

  private shiftNextWaiter(): QueueItem | null {
    while (this.queue.length > 0) {
      const waiter = this.queue.shift()
      if (!waiter) return null
      if (waiter.signal?.aborted) {
        this.cleanupQueueItem(waiter)
        waiter.reject(new Error('Request aborted'))
        continue
      }
      return waiter
    }
    return null
  }

  private removeFromQueue(item: QueueItem): void {
    const index = this.queue.indexOf(item)
    if (index !== -1) {
      this.queue.splice(index, 1)
    }
    this.cleanupQueueItem(item)
  }

  private cleanupQueueItem(item: QueueItem): void {
    if (item.signal && item.onAbort) {
      item.signal.removeEventListener('abort', item.onAbort)
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('Request aborted')
    }
  }

  private getPauseMs(now: number): number {
    if (this.pausedUntilMs > now) {
      return this.pausedUntilMs - now
    }
    return 0
  }

  private getMinGapMs(now: number): number {
    const timeSinceLast = now - this.lastRequestMs
    if (timeSinceLast < this.config.minGapMs) {
      return this.config.minGapMs - timeSinceLast
    }
    return 0
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ms <= 0) {
        resolve()
        return
      }
      let settled = false
      const onTimeout = () => {
        if (settled) return
        settled = true
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        reject(new Error('Request aborted'))
      }

      const timer = setTimeout(onTimeout, ms)
      timer.unref?.()

      if (!signal) return
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
