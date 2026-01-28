/**
 * KB Sync CLI Command
 *
 * Syncs FAQ sources to Upstash Vector + Redis knowledge base.
 * Supports single app sync, all apps sync, and stats viewing.
 */

import { createHash } from 'node:crypto'
import {
  type IngestResult,
  PRODUCT_SOURCES,
  ingest,
  listProductSources,
} from '@skillrecordings/core/knowledge/ingest'
import {
  type KnowledgeArticle,
  getKnowledgeNamespace,
  getKnowledgeRedisKey,
} from '@skillrecordings/core/knowledge/types'
import { getRedis } from '@skillrecordings/core/redis/client'
import {
  getVectorIndex,
  upsertVector,
} from '@skillrecordings/core/vector/client'
import type { Command } from 'commander'

/**
 * Hash content to enable idempotent updates
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * Fetch content from a URL
 */
async function fetchContent(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    )
  }
  return response.text()
}

/**
 * Get stored hash for an article from Redis
 */
async function getStoredHash(
  id: string,
  namespace: string
): Promise<string | null> {
  const redis = getRedis()
  const key = getKnowledgeRedisKey(id, namespace)
  const data = await redis.hget(key, 'content_hash')
  return data as string | null
}

/**
 * Store article in Redis with content hash
 */
async function storeArticle(
  article: KnowledgeArticle,
  contentHash: string
): Promise<void> {
  const redis = getRedis()
  const namespace = getKnowledgeNamespace(article.appId)
  const key = getKnowledgeRedisKey(article.id, namespace)

  await redis.hset(key, {
    id: article.id,
    title: article.title,
    question: article.question,
    answer: article.answer,
    appId: article.appId,
    metadata: JSON.stringify(article.metadata),
    content_hash: contentHash,
  })
}

/**
 * Store article in vector index
 */
async function storeVector(article: KnowledgeArticle): Promise<void> {
  const searchableText = `${article.title}\n\n${article.question}`
  await upsertVector({
    id: article.id,
    data: searchableText,
    metadata: {
      type: 'knowledge',
      appId: article.appId,
      category: article.metadata.category as any,
      source: article.metadata.source as any,
      trustScore: article.metadata.trust_score ?? 1.0,
    },
  })
}

/**
 * Sync result for a single app
 */
interface SyncResult {
  appId: string
  total: number
  added: number
  updated: number
  unchanged: number
  errors: string[]
}

/**
 * Sync a single app's knowledge base
 */
async function syncApp(appId: string, dryRun: boolean): Promise<SyncResult> {
  const result: SyncResult = {
    appId,
    total: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  }

  const source = PRODUCT_SOURCES[appId]
  if (!source) {
    result.errors.push(`Unknown app: ${appId}`)
    return result
  }

  if (!source.enabled) {
    result.errors.push(`App ${appId} is not enabled for sync`)
    return result
  }

  if (!source.sourceUrls || source.sourceUrls.length === 0) {
    result.errors.push(`No source URLs configured for ${appId}`)
    return result
  }

  const namespace = getKnowledgeNamespace(appId)

  // Fetch content from all source URLs
  const allContent: string[] = []
  for (const url of source.sourceUrls) {
    try {
      const content = await fetchContent(url)
      allContent.push(content)
    } catch (error) {
      result.errors.push(
        `Failed to fetch ${url}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  if (allContent.length === 0) {
    result.errors.push(`No content fetched for ${appId}`)
    return result
  }

  // Parse content based on format
  let ingestResult: IngestResult
  try {
    // For single URL, pass content directly; for multiple, pass as array
    const content =
      allContent.length === 1
        ? allContent[0]
        : allContent.map((c, i) => ({
            filePath: source.sourceUrls![i],
            content: c,
          }))

    ingestResult = await ingest({
      productId: appId,
      content: content as any,
      format: source.format,
    })

    if (ingestResult.errors.length > 0) {
      for (const error of ingestResult.errors) {
        result.errors.push(error.message)
      }
    }
  } catch (error) {
    result.errors.push(
      `Parse error: ${error instanceof Error ? error.message : String(error)}`
    )
    return result
  }

  result.total = ingestResult.articles.length

  // Process each article
  for (const article of ingestResult.articles) {
    const contentHash = hashContent(
      `${article.title}|${article.question}|${article.answer}`
    )
    const storedHash = await getStoredHash(article.id, namespace)

    if (storedHash === contentHash) {
      result.unchanged++
      continue
    }

    if (dryRun) {
      if (storedHash) {
        result.updated++
      } else {
        result.added++
      }
      continue
    }

    // Store in Redis and Vector
    try {
      await storeArticle(article, contentHash)
      await storeVector(article)

      if (storedHash) {
        result.updated++
      } else {
        result.added++
      }
    } catch (error) {
      result.errors.push(
        `Failed to store ${article.id}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  return result
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

/**
 * Sync knowledge base from FAQ sources
 */
export async function sync(options: {
  app?: string
  all?: boolean
  dryRun?: boolean
  json?: boolean
}): Promise<void> {
  const startTime = Date.now()

  try {
    // Determine which apps to sync
    let appsToSync: string[] = []

    if (options.all) {
      appsToSync = listProductSources()
        .filter((s) => s.enabled)
        .map((s) => s.appId)
    } else if (options.app) {
      appsToSync = [options.app]
    } else {
      if (options.json) {
        console.error(JSON.stringify({ error: 'Must specify --app or --all' }))
      } else {
        console.error('Error: Must specify --app <appId> or --all')
      }
      process.exit(1)
    }

    if (appsToSync.length === 0) {
      if (options.json) {
        console.error(JSON.stringify({ error: 'No apps enabled for sync' }))
      } else {
        console.error('No apps enabled for sync')
      }
      process.exit(1)
    }

    const results: SyncResult[] = []

    for (const appId of appsToSync) {
      if (!options.json) {
        console.log(
          `\n${options.dryRun ? '[DRY RUN] ' : ''}Syncing ${appId}...`
        )
      }

      const result = await syncApp(appId, options.dryRun ?? false)
      results.push(result)

      if (!options.json) {
        if (result.errors.length > 0) {
          console.log(`  ⚠️  Errors:`)
          for (const error of result.errors) {
            console.log(`     - ${error}`)
          }
        }
        console.log(`  📚 Total: ${result.total}`)
        console.log(`  ✅ Added: ${result.added}`)
        console.log(`  🔄 Updated: ${result.updated}`)
        console.log(`  ⏭️  Unchanged: ${result.unchanged}`)
      }
    }

    const elapsed = Date.now() - startTime

    // Summary
    const summary = {
      dryRun: options.dryRun ?? false,
      duration: formatDuration(elapsed),
      apps: results.length,
      total: results.reduce((sum, r) => sum + r.total, 0),
      added: results.reduce((sum, r) => sum + r.added, 0),
      updated: results.reduce((sum, r) => sum + r.updated, 0),
      unchanged: results.reduce((sum, r) => sum + r.unchanged, 0),
      errors: results.reduce((sum, r) => sum + r.errors.length, 0),
      results,
    }

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2))
    } else {
      console.log('\n' + '─'.repeat(50))
      console.log(
        `${options.dryRun ? '[DRY RUN] ' : ''}Sync complete in ${summary.duration}`
      )
      console.log(
        `Apps: ${summary.apps} | Total: ${summary.total} | Added: ${summary.added} | Updated: ${summary.updated} | Unchanged: ${summary.unchanged}`
      )
      if (summary.errors > 0) {
        console.log(`⚠️  ${summary.errors} errors occurred`)
      }
    }
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Display knowledge base statistics
 */
export async function stats(options: {
  app?: string
  json?: boolean
}): Promise<void> {
  try {
    const sources = listProductSources()
    const redis = getRedis()

    const appStats: Array<{
      appId: string
      enabled: boolean
      format: string
      articleCount: number
    }> = []

    for (const source of sources) {
      if (options.app && source.appId !== options.app) {
        continue
      }

      const namespace = getKnowledgeNamespace(source.appId)
      const pattern = `${namespace}:article:*`

      // Count articles using SCAN
      let cursor = 0
      let count = 0
      do {
        const [nextCursor, keys] = await redis.scan(cursor, {
          match: pattern,
          count: 100,
        })
        cursor = Number(nextCursor)
        count += keys.length
      } while (cursor !== 0)

      appStats.push({
        appId: source.appId,
        enabled: source.enabled ?? false,
        format: source.format,
        articleCount: count,
      })
    }

    if (options.json) {
      console.log(JSON.stringify(appStats, null, 2))
      return
    }

    console.log('\nKnowledge Base Statistics')
    console.log('─'.repeat(60))

    const total = appStats.reduce((sum, s) => sum + s.articleCount, 0)

    for (const stat of appStats) {
      const status = stat.enabled ? '✅' : '⏸️'
      console.log(`\n${status} ${stat.appId} (${stat.format})`)
      console.log(`   Articles: ${stat.articleCount}`)
    }

    console.log('\n' + '─'.repeat(60))
    console.log(`Total articles: ${total}`)
    console.log('')
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * List configured product sources
 */
export async function list(options: { json?: boolean }): Promise<void> {
  const sources = listProductSources()

  if (options.json) {
    console.log(JSON.stringify(sources, null, 2))
    return
  }

  console.log('\nConfigured Knowledge Sources')
  console.log('─'.repeat(60))

  for (const source of sources) {
    const status = source.enabled ? '✅' : '⏸️'
    console.log(`\n${status} ${source.appId}`)
    console.log(`   Format: ${source.format}`)
    console.log(`   Source: ${source.defaultSource || 'docs'}`)
    console.log(`   Category: ${source.defaultCategory || 'general'}`)
    if (source.sourceUrls && source.sourceUrls.length > 0) {
      console.log(`   URLs:`)
      for (const url of source.sourceUrls) {
        console.log(`     - ${url}`)
      }
    }
  }

  console.log('')
}

/**
 * Register kb commands with Commander
 */
export function registerKbCommands(program: Command): void {
  const kb = program.command('kb').description('Manage knowledge base content')

  kb.command('sync')
    .description('Sync FAQ sources to knowledge base')
    .option('--app <appId>', 'Sync specific app')
    .option('--all', 'Sync all enabled apps')
    .option('--dry-run', 'Show what would be synced without making changes')
    .option('--json', 'Output as JSON')
    .action(sync)

  kb.command('stats')
    .description('Show knowledge base statistics')
    .option('--app <appId>', 'Filter by app')
    .option('--json', 'Output as JSON')
    .action(stats)

  kb.command('list')
    .description('List configured knowledge sources')
    .option('--json', 'Output as JSON')
    .action(list)
}
