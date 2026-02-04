import { createInstrumentedBaseClient } from '@skillrecordings/core/front/instrumented-client'
import {
  FrontApiError,
  createChannelsClient,
  createContactsClient,
  createConversationsClient,
  createDraftsClient,
  createInboxesClient,
  createMessagesClient,
  createTagsClient,
  createTeammatesClient,
  createTemplatesClient,
} from '@skillrecordings/front-sdk'
import { CLIError } from '../../core/errors'
import type { OutputFormatter } from '../../core/output'
import {
  DEFAULT_CACHE_CONFIG,
  type FrontCacheConfig,
  FrontResponseCache,
} from './cache'
import {
  DEFAULT_RATE_LIMITER_CONFIG,
  FrontRateLimiter,
  type RateLimiterConfig,
} from './rate-limiter'

// Module-level cache — shared across all getFrontClient() calls within a process
// Dies with the process for CLI mode, persists across tool calls in MCP mode
let sharedCache: FrontResponseCache | null = null
let sharedRateLimiter: FrontRateLimiter | null = null
let sharedRateLimiterConfig: Partial<RateLimiterConfig> = {}

function getSharedCache(): FrontResponseCache {
  if (!sharedCache) {
    sharedCache = new FrontResponseCache(DEFAULT_CACHE_CONFIG)
  }
  return sharedCache
}

/** Reset cache (for testing or explicit invalidation) */
export function resetFrontCache(): void {
  sharedCache = null
}

/** Get cache stats (for debugging / health command) */
export function getFrontCacheStats() {
  return (
    sharedCache?.stats() ?? { size: 0, tiers: { static: 0, warm: 0, hot: 0 } }
  )
}

function getSharedRateLimiter(
  config: Partial<RateLimiterConfig> = {}
): FrontRateLimiter {
  if (Object.keys(config).length > 0) {
    sharedRateLimiterConfig = { ...sharedRateLimiterConfig, ...config }
  }

  if (!sharedRateLimiter) {
    sharedRateLimiter = new FrontRateLimiter(sharedRateLimiterConfig)
  } else if (Object.keys(config).length > 0) {
    sharedRateLimiter.updateConfig(sharedRateLimiterConfig)
  }

  return sharedRateLimiter
}

export function resetFrontRateLimiter(): void {
  sharedRateLimiter?.reset()
  sharedRateLimiter = null
  sharedRateLimiterConfig = {}
}

export function getFrontRateLimiterStats() {
  if (sharedRateLimiter) return sharedRateLimiter.stats()
  const maxRequests =
    typeof sharedRateLimiterConfig.maxRequests === 'number'
      ? sharedRateLimiterConfig.maxRequests
      : DEFAULT_RATE_LIMITER_CONFIG.maxRequests
  return {
    requestsInWindow: 0,
    maxRequests,
    utilizationPct: 0,
    queueDepth: 0,
    estimatedWaitMs: 0,
  }
}

export function requireFrontToken(): string {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new CLIError({
      userMessage: 'FRONT_API_TOKEN environment variable is required.',
      suggestion:
        'Set FRONT_API_TOKEN in your shell or .env.local, or run: skill auth setup',
    })
  }
  return apiToken
}

function extractPath(url: string): string {
  if (url.startsWith('http')) {
    return new URL(url).pathname
  }
  const [path] = url.split('?')
  return path?.split('#')[0] ?? url
}

export function extractResourcePath(url: string): string {
  // /conversations/cnv_xxx/tags → invalidate anything with /conversations/cnv_xxx
  // /tags → invalidate /tags
  const path = extractPath(url)
  const segments = path.split('/').filter(Boolean)
  if (segments.length >= 2) return `/${segments[0]}/${segments[1]}`
  return `/${segments[0] ?? ''}`
}

export function createCachedInstrumentedFrontClient(config: {
  apiToken: string
  cacheConfig?: Partial<FrontCacheConfig>
  rateLimit?: number
  output?: OutputFormatter
  signal?: AbortSignal
}) {
  const cache = config.cacheConfig
    ? new FrontResponseCache({ ...DEFAULT_CACHE_CONFIG, ...config.cacheConfig })
    : getSharedCache()
  const baseClient = createInstrumentedBaseClient({ apiToken: config.apiToken })
  const rateLimiter = getSharedRateLimiter(
    typeof config.rateLimit === 'number'
      ? { maxRequests: config.rateLimit }
      : {}
  )

  const warnIfHighUtilization = () => {
    if (!config.output) return
    const stats = rateLimiter.stats()
    if (stats.utilizationPct >= 80) {
      config.output.warn(
        `Front API usage high: ${stats.utilizationPct}% (${stats.requestsInWindow}/${stats.maxRequests} in window), queue=${stats.queueDepth}, wait≈${stats.estimatedWaitMs}ms`
      )
    }
  }

  const handleRateLimitError = (error: unknown) => {
    if (error instanceof FrontApiError && error.status === 429) {
      rateLimiter.record429()
    }
  }

  const cachedBase = {
    get: async <T>(path: string, schema?: unknown): Promise<T> => {
      const cached = cache.get<T>(path)
      if (cached !== undefined) {
        rateLimiter.recordCacheHit()
        return cached
      }
      await rateLimiter.acquire(config.signal)
      warnIfHighUtilization()
      const result = await baseClient
        .get<T>(path, schema as never)
        .catch((error) => {
          handleRateLimitError(error)
          throw error
        })
      cache.set(path, result)
      return result
    },
    post: async <T>(
      path: string,
      body: unknown,
      schema?: unknown
    ): Promise<T> => {
      await rateLimiter.acquire(config.signal)
      warnIfHighUtilization()
      const result = await baseClient
        .post<T>(path, body, schema as never)
        .catch((error) => {
          handleRateLimitError(error)
          throw error
        })
      cache.invalidate(extractResourcePath(path))
      return result
    },
    patch: async <T>(
      path: string,
      body: unknown,
      schema?: unknown
    ): Promise<T> => {
      await rateLimiter.acquire(config.signal)
      warnIfHighUtilization()
      const result = await baseClient
        .patch<T>(path, body, schema as never)
        .catch((error) => {
          handleRateLimitError(error)
          throw error
        })
      cache.invalidate(extractResourcePath(path))
      return result
    },
    put: async <T>(
      path: string,
      body: unknown,
      schema?: unknown
    ): Promise<T> => {
      await rateLimiter.acquire(config.signal)
      warnIfHighUtilization()
      const result = await baseClient
        .put<T>(path, body, schema as never)
        .catch((error) => {
          handleRateLimitError(error)
          throw error
        })
      cache.invalidate(extractResourcePath(path))
      return result
    },
    delete: async <T>(path: string, schema?: unknown): Promise<T> => {
      await rateLimiter.acquire(config.signal)
      warnIfHighUtilization()
      const result = await baseClient
        .delete<T>(path, schema as never)
        .catch((error) => {
          handleRateLimitError(error)
          throw error
        })
      cache.invalidate(extractResourcePath(path))
      return result
    },
  }

  return {
    raw: cachedBase,
    conversations: createConversationsClient(cachedBase),
    messages: createMessagesClient(cachedBase),
    drafts: createDraftsClient(cachedBase),
    templates: createTemplatesClient(cachedBase),
    tags: createTagsClient(cachedBase),
    inboxes: createInboxesClient(cachedBase),
    channels: createChannelsClient(cachedBase),
    contacts: createContactsClient(cachedBase),
    teammates: createTeammatesClient(cachedBase),
  }
}

export type CachedInstrumentedFrontClient = ReturnType<
  typeof createCachedInstrumentedFrontClient
>

export function getFrontClient(ctx?: {
  signal?: AbortSignal
  output?: OutputFormatter
  config?: Record<string, unknown>
}) {
  const rateLimit =
    typeof ctx?.config?.frontRateLimit === 'number'
      ? ctx.config.frontRateLimit
      : undefined
  return createCachedInstrumentedFrontClient({
    apiToken: requireFrontToken(),
    rateLimit,
    output: ctx?.output,
    signal: ctx?.signal,
  })
}

export function normalizeId(idOrUrl: string): string {
  return idOrUrl.startsWith('http') ? idOrUrl.split('/').pop()! : idOrUrl
}
