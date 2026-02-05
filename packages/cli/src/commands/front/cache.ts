export interface CacheEntry<T = unknown> {
  data: T
  timestamp: number
  url: string
}

export type CacheTier = 'static' | 'warm' | 'hot'

export interface FrontCacheConfig {
  /** Static tier TTL in ms — inboxes, teammates. Default: Infinity (never expires within session) */
  staticTtlMs: number
  /** Warm tier TTL in ms — tags. Default: 300_000 (5 min) */
  warmTtlMs: number
  /** Hot tier TTL in ms — conversations, messages. Default: 30_000 (30s) */
  hotTtlMs: number
  /** Whether caching is enabled at all. Default: true */
  enabled: boolean
}

export const DEFAULT_CACHE_CONFIG: FrontCacheConfig = {
  staticTtlMs: Number.POSITIVE_INFINITY,
  warmTtlMs: 300_000,
  hotTtlMs: 30_000,
  enabled: true,
}

function stripQueryAndHash(url: string): string {
  const [path] = url.split('?')
  return path?.split('#')[0] ?? url
}

export function classifyUrl(url: string): CacheTier {
  const path = url.startsWith('http')
    ? new URL(url).pathname
    : stripQueryAndHash(url)

  // Static: inbox list, teammate list (not conversations within an inbox)
  if (/^\/inboxes\/?$/.test(path) || /^\/teammates/.test(path)) return 'static'
  // Warm: tags
  if (/^\/tags/.test(path)) return 'warm'
  // Hot: everything else
  return 'hot'
}

export class FrontResponseCache {
  private entries = new Map<string, CacheEntry>()
  private config: FrontCacheConfig

  constructor(config: Partial<FrontCacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config }
  }

  /** Get cached response for a URL, or undefined if miss/expired */
  get<T>(url: string): T | undefined {
    if (!this.config.enabled) return undefined
    const entry = this.entries.get(url)
    if (!entry) return undefined
    const tier = classifyUrl(url)
    const ttl = this.ttlForTier(tier)
    if (Date.now() - entry.timestamp > ttl) {
      this.entries.delete(url)
      return undefined
    }
    return entry.data as T
  }

  /** Store a GET response */
  set(url: string, data: unknown): void {
    if (!this.config.enabled) return
    this.entries.set(url, { data, timestamp: Date.now(), url })
  }

  /** Invalidate entries matching a URL prefix pattern.
   *  Called after mutations (POST/PATCH/DELETE). */
  invalidate(urlPattern: string): void {
    for (const [key] of this.entries) {
      if (key.includes(urlPattern)) {
        this.entries.delete(key)
      }
    }
  }

  /** Invalidate entries by tier */
  invalidateTier(tier: CacheTier): void {
    for (const [key] of this.entries) {
      if (classifyUrl(key) === tier) {
        this.entries.delete(key)
      }
    }
  }

  /** Clear everything */
  clear(): void {
    this.entries.clear()
  }

  /** Stats for debugging */
  stats(): { size: number; tiers: Record<CacheTier, number> } {
    const tiers: Record<CacheTier, number> = { static: 0, warm: 0, hot: 0 }
    for (const [key] of this.entries) {
      tiers[classifyUrl(key)]++
    }
    return { size: this.entries.size, tiers }
  }

  private ttlForTier(tier: CacheTier): number {
    switch (tier) {
      case 'static':
        return this.config.staticTtlMs
      case 'warm':
        return this.config.warmTtlMs
      case 'hot':
        return this.config.hotTtlMs
    }
  }
}
