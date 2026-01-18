import { type App, AppsTable, database, eq } from '@skillrecordings/database'

interface CacheEntry {
  app: App
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Retrieve an app by slug, with 5-minute in-memory cache.
 * Returns null if app doesn't exist.
 */
export async function getApp(slug: string): Promise<App | null> {
  const cached = cache.get(slug)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.app
  }

  const app = await database.query.AppsTable.findFirst({
    where: eq(AppsTable.slug, slug),
  })

  if (app) {
    cache.set(slug, { app, expiresAt: Date.now() + TTL_MS })
  }

  return app ?? null
}

/**
 * Retrieve an app by ID, with 5-minute in-memory cache.
 * Returns null if app doesn't exist.
 */
export async function getAppById(id: string): Promise<App | null> {
  // Check cache by id (scan values)
  for (const entry of cache.values()) {
    if (entry.app.id === id && entry.expiresAt > Date.now()) {
      return entry.app
    }
  }

  const app = await database.query.AppsTable.findFirst({
    where: eq(AppsTable.id, id),
  })

  if (app) {
    cache.set(app.slug, { app, expiresAt: Date.now() + TTL_MS })
  }

  return app ?? null
}

/**
 * Retrieve an app by Front inbox ID, with 5-minute in-memory cache.
 * Returns null if app doesn't exist.
 */
export async function getAppByInboxId(inboxId: string): Promise<App | null> {
  // Check cache by inbox ID (scan values)
  for (const entry of cache.values()) {
    if (entry.app.front_inbox_id === inboxId && entry.expiresAt > Date.now()) {
      return entry.app
    }
  }

  const app = await database.query.AppsTable.findFirst({
    where: eq(AppsTable.front_inbox_id, inboxId),
  })

  if (app) {
    cache.set(app.slug, { app, expiresAt: Date.now() + TTL_MS })
  }

  return app ?? null
}

/**
 * Clear all cached app entries.
 * Useful for testing or manual cache invalidation.
 */
export function clearCache(): void {
  cache.clear()
}
