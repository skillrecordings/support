import type {
  ContentSearchRequest,
  ContentSearchResponse,
  ContentSearchResult,
} from '@skillrecordings/sdk/types'

/** 5 minutes for search results */
const CACHE_TTL = 5 * 60 * 1000

/** 24 hours for quick links (semi-static) */
const QUICK_LINKS_TTL = 24 * 60 * 60 * 1000

interface CacheEntry {
  response: ContentSearchResponse
  timestamp: number
}

interface QuickLinksCacheEntry {
  links: ContentSearchResult[]
  timestamp: number
}

/** In-memory cache for search results */
const cache = new Map<string, CacheEntry>()

/** Separate cache for quick links (longer TTL) */
const quickLinksCache = new Map<string, QuickLinksCacheEntry>()

/**
 * Generate cache key from appId and request parameters
 * Format: appId:query:types:limit
 */
export function getCacheKey(
  appId: string,
  request: ContentSearchRequest
): string {
  const typesKey = request.types?.join(',') ?? ''
  return `${appId}:${request.query}:${typesKey}:${request.limit ?? 5}`
}

/**
 * Generate cache key for quick links
 * Format: appId:quicklinks
 */
function getQuickLinksCacheKey(appId: string): string {
  return `${appId}:quicklinks`
}

/**
 * Cached content search with TTL-based expiration
 * - Search results cached for 5 minutes
 * - Quick links cached for 24 hours
 */
export async function cachedContentSearch(
  appId: string,
  request: ContentSearchRequest,
  fetcher: () => Promise<ContentSearchResponse>
): Promise<ContentSearchResponse> {
  const key = getCacheKey(appId, request)
  const cached = cache.get(key)
  const now = Date.now()

  // Return cached search results if fresh
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.response
  }

  // Fetch fresh results
  const response = await fetcher()

  // Cache the full response
  cache.set(key, { response, timestamp: now })

  // Separately cache quick links for longer TTL
  if (response.quickLinks?.length) {
    const quickLinksKey = getQuickLinksCacheKey(appId)
    quickLinksCache.set(quickLinksKey, {
      links: response.quickLinks,
      timestamp: now,
    })
  }

  return response
}

/**
 * Get cached quick links if available (24h TTL)
 * Useful for returning quick links even when main search cache is stale
 */
export function getCachedQuickLinks(
  appId: string
): ContentSearchResult[] | null {
  const key = getQuickLinksCacheKey(appId)
  const cached = quickLinksCache.get(key)

  if (cached && Date.now() - cached.timestamp < QUICK_LINKS_TTL) {
    return cached.links
  }

  return null
}

/**
 * Clear all cache entries (useful for testing or forced refresh)
 */
export function clearContentCache(): void {
  cache.clear()
  quickLinksCache.clear()
}

/**
 * Clear cache for a specific app
 */
export function clearAppCache(appId: string): void {
  // Clear all entries for this app
  for (const key of cache.keys()) {
    if (key.startsWith(`${appId}:`)) {
      cache.delete(key)
    }
  }

  // Clear quick links
  quickLinksCache.delete(getQuickLinksCacheKey(appId))
}
