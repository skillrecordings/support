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
import { type CommandContext, createContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

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
  // Handle local file:// URLs
  if (url.startsWith('file://')) {
    const fs = await import('node:fs/promises')
    const filePath = url.replace('file://', '')
    return fs.readFile(filePath, 'utf-8')
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    )
  }
  return response.text()
}

const handleKbError = (
  ctx: CommandContext,
  error: unknown,
  message: string,
  suggestion = 'Verify knowledge sources and try again.'
): void => {
  const cliError =
    error instanceof CLIError
      ? error
      : new CLIError({
          userMessage: message,
          suggestion,
          cause: error,
        })

  ctx.output.error(formatError(cliError))
  process.exitCode = cliError.exitCode
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
export async function sync(
  ctx: CommandContext,
  options: {
    app?: string
    all?: boolean
    dryRun?: boolean
    json?: boolean
  }
): Promise<void> {
  const startTime = Date.now()
  const outputJson = options.json === true || ctx.format === 'json'

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
      throw new CLIError({
        userMessage: 'Must specify --app <appId> or --all.',
        suggestion: 'Use --app <appId> or --all to sync sources.',
      })
    }

    if (appsToSync.length === 0) {
      throw new CLIError({
        userMessage: 'No apps enabled for sync.',
        suggestion: 'Enable at least one product source before syncing.',
      })
    }

    const results: SyncResult[] = []

    for (const appId of appsToSync) {
      if (!outputJson) {
        ctx.output.data(
          `\n${options.dryRun ? '[DRY RUN] ' : ''}Syncing ${appId}...`
        )
      }

      const result = await syncApp(appId, options.dryRun ?? false)
      results.push(result)

      if (!outputJson) {
        if (result.errors.length > 0) {
          ctx.output.warn(`Errors:`)
          for (const error of result.errors) {
            ctx.output.data(`     - ${error}`)
          }
        }
        ctx.output.data(`  📚 Total: ${result.total}`)
        ctx.output.data(`  ✅ Added: ${result.added}`)
        ctx.output.data(`  🔄 Updated: ${result.updated}`)
        ctx.output.data(`  ⏭️  Unchanged: ${result.unchanged}`)
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

    if (outputJson) {
      ctx.output.data(summary)
    } else {
      ctx.output.data('\n' + '─'.repeat(50))
      ctx.output.data(
        `${options.dryRun ? '[DRY RUN] ' : ''}Sync complete in ${summary.duration}`
      )
      ctx.output.data(
        `Apps: ${summary.apps} | Total: ${summary.total} | Added: ${summary.added} | Updated: ${summary.updated} | Unchanged: ${summary.unchanged}`
      )
      if (summary.errors > 0) {
        ctx.output.warn(`${summary.errors} errors occurred`)
      }
    }
  } catch (error) {
    handleKbError(ctx, error, 'Knowledge base sync failed.')
  }
}

/**
 * Display knowledge base statistics
 */
export async function stats(
  ctx: CommandContext,
  options: {
    app?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
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

    if (outputJson) {
      ctx.output.data(appStats)
      return
    }

    ctx.output.data('\nKnowledge Base Statistics')
    ctx.output.data('─'.repeat(60))

    const total = appStats.reduce((sum, s) => sum + s.articleCount, 0)

    for (const stat of appStats) {
      const status = stat.enabled ? '✅' : '⏸️'
      ctx.output.data(`\n${status} ${stat.appId} (${stat.format})`)
      ctx.output.data(`   Articles: ${stat.articleCount}`)
    }

    ctx.output.data('\n' + '─'.repeat(60))
    ctx.output.data(`Total articles: ${total}`)
    ctx.output.data('')
  } catch (error) {
    handleKbError(ctx, error, 'Failed to load knowledge base stats.')
  }
}

/**
 * List configured product sources
 */
export async function list(
  ctx: CommandContext,
  options: { json?: boolean; idsOnly?: boolean }
): Promise<void> {
  const sources = listProductSources()
  const outputJson = options.json === true || ctx.format === 'json'
  const idsOnly = options.idsOnly === true && !outputJson

  if (outputJson) {
    ctx.output.data(sources)
    return
  }

  if (idsOnly) {
    for (const source of sources) {
      ctx.output.data(source.appId)
    }
    return
  }

  ctx.output.data('\nConfigured Knowledge Sources')
  ctx.output.data('─'.repeat(60))

  for (const source of sources) {
    const status = source.enabled ? '✅' : '⏸️'
    ctx.output.data(`\n${status} ${source.appId}`)
    ctx.output.data(`   Format: ${source.format}`)
    ctx.output.data(`   Source: ${source.defaultSource || 'docs'}`)
    ctx.output.data(`   Category: ${source.defaultCategory || 'general'}`)
    if (source.sourceUrls && source.sourceUrls.length > 0) {
      ctx.output.data(`   URLs:`)
      for (const url of source.sourceUrls) {
        ctx.output.data(`     - ${url}`)
      }
    }
  }

  ctx.output.data('')
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
    .action(async (options, command) => {
      const ctx = await createContext({
        format:
          options.json === true
            ? 'json'
            : typeof command.optsWithGlobals === 'function'
              ? command.optsWithGlobals().format
              : command.parent?.opts().format,
        verbose:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().verbose
            : command.parent?.opts().verbose,
        quiet:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().quiet
            : command.parent?.opts().quiet,
      })
      await sync(ctx, options)
    })

  kb.command('stats')
    .description('Show knowledge base statistics')
    .option('--app <appId>', 'Filter by app')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await createContext({
        format:
          options.json === true
            ? 'json'
            : typeof command.optsWithGlobals === 'function'
              ? command.optsWithGlobals().format
              : command.parent?.opts().format,
        verbose:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().verbose
            : command.parent?.opts().verbose,
        quiet:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().quiet
            : command.parent?.opts().quiet,
      })
      await stats(ctx, options)
    })

  kb.command('list')
    .description('List configured knowledge sources')
    .option('--ids-only', 'Output only IDs (one per line)')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await createContext({
        format:
          options.json === true
            ? 'json'
            : typeof command.optsWithGlobals === 'function'
              ? command.optsWithGlobals().format
              : command.parent?.opts().format,
        verbose:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().verbose
            : command.parent?.opts().verbose,
        quiet:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().quiet
            : command.parent?.opts().quiet,
      })
      await list(ctx, options)
    })
}
