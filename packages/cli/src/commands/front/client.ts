import { createInstrumentedBaseClient } from '@skillrecordings/core/front/instrumented-client'
import {
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
import {
  DEFAULT_CACHE_CONFIG,
  type FrontCacheConfig,
  FrontResponseCache,
} from './cache'

// Module-level cache — shared across all getFrontClient() calls within a process
// Dies with the process for CLI mode, persists across tool calls in MCP mode
let sharedCache: FrontResponseCache | null = null

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
}) {
  const cache = config.cacheConfig
    ? new FrontResponseCache({ ...DEFAULT_CACHE_CONFIG, ...config.cacheConfig })
    : getSharedCache()
  const baseClient = createInstrumentedBaseClient({ apiToken: config.apiToken })

  const cachedBase = {
    get: async <T>(path: string, schema?: unknown): Promise<T> => {
      const cached = cache.get<T>(path)
      if (cached !== undefined) return cached
      const result = await baseClient.get<T>(path, schema as never)
      cache.set(path, result)
      return result
    },
    post: async <T>(
      path: string,
      body: unknown,
      schema?: unknown
    ): Promise<T> => {
      const result = await baseClient.post<T>(path, body, schema as never)
      cache.invalidate(extractResourcePath(path))
      return result
    },
    patch: async <T>(
      path: string,
      body: unknown,
      schema?: unknown
    ): Promise<T> => {
      const result = await baseClient.patch<T>(path, body, schema as never)
      cache.invalidate(extractResourcePath(path))
      return result
    },
    put: async <T>(
      path: string,
      body: unknown,
      schema?: unknown
    ): Promise<T> => {
      const result = await baseClient.put<T>(path, body, schema as never)
      cache.invalidate(extractResourcePath(path))
      return result
    },
    delete: async <T>(path: string, schema?: unknown): Promise<T> => {
      const result = await baseClient.delete<T>(path, schema as never)
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

export function getFrontClient() {
  return createCachedInstrumentedFrontClient({ apiToken: requireFrontToken() })
}

export function normalizeId(idOrUrl: string): string {
  return idOrUrl.startsWith('http') ? idOrUrl.split('/').pop()! : idOrUrl
}
