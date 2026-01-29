/**
 * Front → DuckDB Cache System
 *
 * Builds a durable local cache of ALL Front conversation data.
 * This is a long-running import (4-6 hours for full import).
 *
 * Usage:
 *   bun src/index.ts front cache --init      # Full import all inboxes
 *   bun src/index.ts front cache --sync      # Incremental sync
 *   bun src/index.ts front cache --stats     # Show cache stats
 *   bun src/index.ts front cache --resume    # Resume interrupted import
 *
 * Issue: https://github.com/skillrecordings/support/issues/91
 */

import * as path from 'path'
import type { Command } from 'commander'

// DuckDB types - dynamically imported at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DuckDB = typeof import('duckdb')
let duckdb: DuckDB | null = null

async function loadDuckDB(): Promise<DuckDB> {
  if (duckdb) return duckdb
  try {
    duckdb = await import('duckdb')
    return duckdb
  } catch {
    throw new Error(
      'DuckDB is not installed. Run: bun add duckdb (native module, requires compilation)'
    )
  }
}

// ============================================================================
// Configuration
// ============================================================================

const DB_PATH = path.join(process.env.HOME || '~', 'skill/data/front-cache.db')
const FRONT_API_BASE = 'https://api2.frontapp.com'
const REQUEST_DELAY_MS = 1000 // Base delay between sequential requests
const MAX_RETRIES = 5

// Rate limiting configuration - VERY CONSERVATIVE
// Front limit: 120 req/min, but we target ~40 req/min to be safe
const MAX_CONCURRENT_REQUESTS = 1 // Sequential to avoid burst rate limits
const MIN_REQUEST_INTERVAL_MS = 700 // ~85 rpm, safely under 100 rpm Pro limit
const MIN_429_BACKOFF_MS = 60000 // 60 second minimum backoff on rate limit
const REQUESTS_PER_MINUTE_LIMIT = 40 // Stay well under 120

// ============================================================================
// Rate Limiter - VERY Conservative Parallel Request Management
// ============================================================================

class RateLimiter {
  private activeRequests = 0
  private lastRequestTime = 0
  private requestTimestamps: number[] = [] // Track requests in last minute
  private readonly queue: Array<{
    resolve: () => void
    reject: (error: Error) => void
  }> = []

  constructor(
    private maxConcurrent: number = MAX_CONCURRENT_REQUESTS,
    private minInterval: number = MIN_REQUEST_INTERVAL_MS,
    private maxPerMinute: number = REQUESTS_PER_MINUTE_LIMIT
  ) {}

  /**
   * Get current number of active requests (for logging)
   */
  getActiveCount(): number {
    return this.activeRequests
  }

  /**
   * Get requests made in the last minute
   */
  getRequestsLastMinute(): number {
    const oneMinuteAgo = Date.now() - 60000
    this.requestTimestamps = this.requestTimestamps.filter(
      (t) => t > oneMinuteAgo
    )
    return this.requestTimestamps.length
  }

  /**
   * Acquire a slot for making a request
   */
  async acquire(): Promise<void> {
    // Wait for available slot
    while (this.activeRequests >= this.maxConcurrent) {
      await new Promise<void>((resolve, reject) => {
        this.queue.push({ resolve, reject })
      })
    }

    // Check requests per minute limit
    while (this.getRequestsLastMinute() >= this.maxPerMinute) {
      const oldestInWindow = this.requestTimestamps[0]
      if (oldestInWindow === undefined) break // No timestamps to wait on
      const waitTime = oldestInWindow + 60000 - Date.now() + 100 // Wait until oldest expires + buffer
      if (waitTime > 0) {
        console.log(
          `[${new Date().toISOString()}] ⏸️  Rate limit: ${this.getRequestsLastMinute()}/${this.maxPerMinute} req/min. Waiting ${(waitTime / 1000).toFixed(1)}s...`
        )
        await sleep(waitTime)
      }
    }

    // Enforce minimum interval between requests
    const now = Date.now()
    const elapsed = now - this.lastRequestTime
    if (elapsed < this.minInterval) {
      await sleep(this.minInterval - elapsed)
    }

    this.activeRequests++
    this.lastRequestTime = Date.now()
    this.requestTimestamps.push(Date.now())
  }

  /**
   * Release a slot after request completes
   */
  release(): void {
    this.activeRequests--
    const next = this.queue.shift()
    if (next) {
      next.resolve()
    }
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter()

// ============================================================================
// Types
// ============================================================================

interface FrontInbox {
  id: string
  name: string
  address?: string
}

interface FrontTag {
  id: string
  name: string
}

interface FrontConversation {
  id: string
  subject: string | null
  status: string
  created_at: number
  last_message_at?: number
  tags: FrontTag[]
  recipient?: { handle: string; name?: string }
  assignee?: { email: string }
  _links?: {
    related?: {
      parent?: { url: string }
    }
  }
}

interface FrontMessage {
  id: string
  type: string
  is_inbound: boolean
  created_at: number
  subject?: string
  body?: string
  text?: string
  author?: { email?: string; name?: string }
}

interface CacheOptions {
  init?: boolean
  sync?: boolean
  stats?: boolean
  resume?: boolean
  inbox?: string
  limit?: number
  json?: boolean
}

interface SyncState {
  inbox_id: string
  last_sync_at: string | null
  last_conversation_at: string | null
  total_synced: number
}

// ============================================================================
// Logging - TIMESTAMPS ON EVERY LINE
// ============================================================================

function timestamp(): string {
  return new Date().toISOString()
}

function log(message: string, ...args: unknown[]): void {
  console.log(`[${timestamp()}] ${message}`, ...args)
}

function logProgress(
  inboxIndex: number,
  totalInboxes: number,
  inboxName: string,
  page: number,
  totalPages: string,
  conversationCount: number
): void {
  console.log(
    `[${timestamp()}] [${inboxIndex}/${totalInboxes}] ${inboxName} - page ${page}/${totalPages} (${conversationCount} conversations)`
  )
}

function logError(context: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[${timestamp()}] ❌ ERROR in ${context}: ${msg}`)
}

function logRateLimit(waitMs: number, attempt: number): void {
  console.log(
    `[${timestamp()}] ⚠️⚠️⚠️ RATE LIMITED (429)! Waiting ${(waitMs / 1000).toFixed(1)}s before retry (attempt ${attempt}/${MAX_RETRIES}) ⚠️⚠️⚠️`
  )
}

function logConcurrent(action: string, count: number): void {
  const rpm = rateLimiter.getRequestsLastMinute()
  console.log(
    `[${timestamp()}] 🔄 ${action} [concurrent: ${count}/${MAX_CONCURRENT_REQUESTS}] [rpm: ${rpm}/${REQUESTS_PER_MINUTE_LIMIT}]`
  )
}

function logThread(convId: string, parentId: string, depth: number): void {
  console.log(
    `[${timestamp()}] 🧵 Thread: ${convId} → parent: ${parentId} (depth: ${depth})`
  )
}

// ============================================================================
// Database Helper
// ============================================================================

// Type alias for DuckDB database instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseInstance = any

async function createDb(): Promise<DatabaseInstance> {
  const duck = await loadDuckDB()
  return new duck.Database(DB_PATH)
}

function runQuery(
  db: DatabaseInstance,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, ...params, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function allQuery<T>(
  db: DatabaseInstance,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, ...params, (err: Error | null, rows: T[]) => {
      if (err) reject(err)
      else resolve(rows as T[])
    })
  })
}

/**
 * Run schema migrations for thread tracking
 * Adds parent_id and thread_depth columns if they don't exist
 */
async function runMigrations(db: DatabaseInstance): Promise<void> {
  log('🔧 Running schema migrations...')

  // Check if parent_id column exists
  const columns = await allQuery<{ column_name: string }>(
    db,
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = 'conversations' AND column_name = 'parent_id'`
  )

  if (columns.length === 0) {
    log('   Adding parent_id column...')
    await runQuery(db, `ALTER TABLE conversations ADD COLUMN parent_id VARCHAR`)

    log('   Adding thread_depth column...')
    await runQuery(
      db,
      `ALTER TABLE conversations ADD COLUMN thread_depth INTEGER DEFAULT 0`
    )

    log('   Creating index on parent_id...')
    await runQuery(
      db,
      `CREATE INDEX IF NOT EXISTS idx_conv_parent ON conversations(parent_id)`
    )

    log('   ✅ Thread tracking columns added')
  } else {
    log('   ✓ Thread tracking columns already exist')
  }
}

/**
 * Extract conversation ID from Front API URL
 * e.g., "https://api2.frontapp.com/conversations/cnv_abc123" → "cnv_abc123"
 */
function extractConversationIdFromUrl(url: string): string | null {
  const match = url.match(/\/conversations\/(cnv_[a-zA-Z0-9]+)/)
  return match?.[1] ?? null
}

// ============================================================================
// API Client with Rate Limiting
// ============================================================================

async function fetchWithRetry<T>(
  url: string,
  headers: Record<string, string>,
  attempt = 1,
  useRateLimiter = true
): Promise<T> {
  const doFetch = async (): Promise<T> => {
    const response = await fetch(url, { headers })

    if (response.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Rate limited after ${MAX_RETRIES} attempts`)
      }
      const retryAfter = response.headers.get('Retry-After')
      // VERY conservative backoff: 60s minimum, respect Retry-After if higher
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0
      const exponentialMs = MIN_429_BACKOFF_MS * Math.pow(1.5, attempt - 1) // 60s, 90s, 135s...
      const waitMs = Math.max(MIN_429_BACKOFF_MS, retryAfterMs, exponentialMs)

      logRateLimit(waitMs, attempt)
      await sleep(waitMs)
      // Recursive call outside rate limiter for retry
      return fetchWithRetry(url, headers, attempt + 1, false)
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json() as Promise<T>
  }

  if (useRateLimiter) {
    return rateLimiter.execute(doFetch)
  }
  return doFetch()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getHeaders(): Record<string, string> {
  const token = process.env.FRONT_API_TOKEN
  if (!token) {
    throw new Error('FRONT_API_TOKEN environment variable required')
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

// ============================================================================
// Core Sync Functions
// ============================================================================

async function fetchAllInboxes(
  headers: Record<string, string>
): Promise<FrontInbox[]> {
  log('📥 Fetching inboxes...')
  const data = await fetchWithRetry<{ _results: FrontInbox[] }>(
    `${FRONT_API_BASE}/inboxes`,
    headers
  )
  const inboxes = data._results || []
  log(`   Found ${inboxes.length} inboxes`)
  return inboxes
}

async function syncInboxes(
  db: DatabaseInstance,
  inboxes: FrontInbox[]
): Promise<void> {
  log('💾 Syncing inboxes to database...')
  for (const inbox of inboxes) {
    await runQuery(
      db,
      `INSERT INTO inboxes (id, name, conversation_count)
       VALUES (?, ?, 0)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
      [inbox.id, inbox.name]
    )
  }
  log(`   Synced ${inboxes.length} inboxes`)
}

async function fetchConversationsPage(
  inboxId: string,
  url: string,
  headers: Record<string, string>
): Promise<{
  conversations: FrontConversation[]
  nextUrl: string | null
}> {
  const data = await fetchWithRetry<{
    _results: FrontConversation[]
    _pagination?: { next?: string }
  }>(url, headers)

  return {
    conversations: data._results || [],
    nextUrl: data._pagination?.next || null,
  }
}

async function fetchMessages(
  conversationId: string,
  headers: Record<string, string>
): Promise<FrontMessage[]> {
  const data = await fetchWithRetry<{ _results: FrontMessage[] }>(
    `${FRONT_API_BASE}/conversations/${conversationId}/messages`,
    headers
  )
  return data._results || []
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function insertConversation(
  db: DatabaseInstance,
  conv: FrontConversation,
  inboxId: string
): Promise<{ parentId: string | null; threadDepth: number }> {
  const tags = conv.tags?.map((t) => t.name) || []
  const tagsJson = JSON.stringify(tags)
  const now = new Date().toISOString()
  const createdAt = new Date(conv.created_at * 1000).toISOString()
  const lastMessageAt = new Date(
    (conv.last_message_at || conv.created_at) * 1000
  ).toISOString()

  // Extract parent conversation ID from _links if present
  let parentId: string | null = null
  let threadDepth = 0

  if (conv._links?.related?.parent?.url) {
    parentId = extractConversationIdFromUrl(conv._links.related.parent.url)
    if (parentId) {
      // Try to get parent's thread depth to calculate this conversation's depth
      const parentRows = await allQuery<{ thread_depth: number }>(
        db,
        `SELECT thread_depth FROM conversations WHERE id = ?`,
        [parentId]
      )
      threadDepth = (parentRows[0]?.thread_depth ?? 0) + 1
      logThread(conv.id, parentId, threadDepth)
    }
  }

  await runQuery(
    db,
    `INSERT INTO conversations 
     (id, inbox_id, subject, status, customer_email, customer_name, tags, 
      assignee_email, created_at, last_message_at, synced_at, parent_id, thread_depth)
     VALUES (?, ?, ?, ?, ?, ?, ?::VARCHAR[], ?, 
             ?::TIMESTAMP, ?::TIMESTAMP, ?::TIMESTAMP, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       status = excluded.status,
       tags = excluded.tags,
       assignee_email = excluded.assignee_email,
       last_message_at = excluded.last_message_at,
       synced_at = excluded.synced_at,
       parent_id = excluded.parent_id,
       thread_depth = excluded.thread_depth`,
    [
      conv.id,
      inboxId,
      conv.subject || null,
      conv.status,
      conv.recipient?.handle || null,
      conv.recipient?.name || null,
      tagsJson,
      conv.assignee?.email || null,
      createdAt,
      lastMessageAt,
      now,
      parentId,
      threadDepth,
    ]
  )

  return { parentId, threadDepth }
}

async function insertMessage(
  db: DatabaseInstance,
  msg: FrontMessage,
  conversationId: string
): Promise<void> {
  const bodyText = msg.text || (msg.body ? stripHtml(msg.body) : null)
  const createdAt = new Date(msg.created_at * 1000).toISOString()

  await runQuery(
    db,
    `INSERT INTO messages
     (id, conversation_id, is_inbound, author_email, author_name, 
      body_text, body_html, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?::TIMESTAMP)
     ON CONFLICT (id) DO NOTHING`,
    [
      msg.id,
      conversationId,
      msg.is_inbound,
      msg.author?.email || null,
      msg.author?.name || null,
      bodyText,
      msg.body || null,
      createdAt,
    ]
  )
}

async function updateSyncState(
  db: DatabaseInstance,
  inboxId: string,
  totalSynced: number,
  lastConversationAt?: number
): Promise<void> {
  const now = new Date().toISOString()
  const lastConvTs = lastConversationAt
    ? new Date(lastConversationAt * 1000).toISOString()
    : null

  await runQuery(
    db,
    `INSERT INTO sync_state (inbox_id, last_sync_at, last_conversation_at, total_synced)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (inbox_id) DO UPDATE SET
       last_sync_at = excluded.last_sync_at,
       last_conversation_at = COALESCE(excluded.last_conversation_at, sync_state.last_conversation_at),
       total_synced = excluded.total_synced`,
    [inboxId, now, lastConvTs, totalSynced]
  )
}

async function getSyncState(
  db: DatabaseInstance,
  inboxId: string
): Promise<SyncState | null> {
  const rows = await allQuery<SyncState>(
    db,
    `SELECT inbox_id, 
            last_sync_at::VARCHAR as last_sync_at, 
            last_conversation_at::VARCHAR as last_conversation_at, 
            total_synced 
     FROM sync_state WHERE inbox_id = ?`,
    [inboxId]
  )
  return rows[0] || null
}

async function updateInboxCount(
  db: DatabaseInstance,
  inboxId: string
): Promise<void> {
  const now = new Date().toISOString()
  await runQuery(
    db,
    `UPDATE inboxes 
     SET conversation_count = (SELECT COUNT(*) FROM conversations WHERE inbox_id = ?),
         last_sync_at = ?::TIMESTAMP
     WHERE id = ?`,
    [inboxId, now, inboxId]
  )
}

// ============================================================================
// Main Sync Logic
// ============================================================================

async function syncInbox(
  db: DatabaseInstance,
  inbox: FrontInbox,
  headers: Record<string, string>,
  inboxIndex: number,
  totalInboxes: number,
  limit?: number,
  resumeFromConversation?: string
): Promise<{
  conversationCount: number
  messageCount: number
  threadCount: number
}> {
  log(
    `\n📬 [${inboxIndex}/${totalInboxes}] Starting sync: ${inbox.name} (${inbox.id})`
  )

  let url: string | null =
    `${FRONT_API_BASE}/inboxes/${inbox.id}/conversations?limit=50`
  let page = 1
  let totalConversations = 0
  let totalMessages = 0
  let totalThreads = 0
  let latestConversationAt: number | undefined
  let skipUntilFound = !!resumeFromConversation
  let foundResumePoint = false

  while (url) {
    await sleep(REQUEST_DELAY_MS)

    try {
      const { conversations, nextUrl } = await fetchConversationsPage(
        inbox.id,
        url,
        headers
      )

      logProgress(
        inboxIndex,
        totalInboxes,
        inbox.name,
        page,
        nextUrl ? '?' : `${page}`,
        totalConversations
      )

      // Filter conversations based on limit and resume point
      const toProcess: FrontConversation[] = []

      for (const conv of conversations) {
        // Check limit FIRST before processing
        if (limit && totalConversations + toProcess.length >= limit) {
          log(`   ⏹ Reached limit of ${limit} conversations`)
          url = null
          break
        }

        // Handle resume: skip until we find the resume point
        if (skipUntilFound) {
          if (conv.id === resumeFromConversation) {
            foundResumePoint = true
            skipUntilFound = false
            log(`   ✓ Found resume point: ${conv.id}`)
          }
          continue
        }

        toProcess.push(conv)
      }

      // Process conversations: insert first, then parallel message fetch
      const conversationsWithMeta: Array<{
        conv: FrontConversation
        hasThread: boolean
      }> = []

      for (const conv of toProcess) {
        // Track latest conversation timestamp
        if (!latestConversationAt || conv.created_at > latestConversationAt) {
          latestConversationAt = conv.created_at
        }

        // Insert conversation (sync - needs parent lookup)
        const { parentId } = await insertConversation(db, conv, inbox.id)
        conversationsWithMeta.push({ conv, hasThread: !!parentId })
        totalConversations++
        if (parentId) totalThreads++
      }

      // Parallel message fetching with rate limiting
      if (conversationsWithMeta.length > 0) {
        logConcurrent(
          `Fetching messages for ${conversationsWithMeta.length} conversations`,
          rateLimiter.getActiveCount()
        )

        const messageResults = await Promise.all(
          conversationsWithMeta.map(({ conv }) =>
            fetchMessages(conv.id, headers)
              .then((messages) => ({ convId: conv.id, messages, error: null }))
              .catch((err) => ({
                convId: conv.id,
                messages: [] as FrontMessage[],
                error: err,
              }))
          )
        )

        // Insert messages (sequential DB writes to avoid conflicts)
        for (const result of messageResults) {
          if (result.error) {
            logError(`fetching messages for ${result.convId}`, result.error)
            continue
          }
          for (const msg of result.messages) {
            await insertMessage(db, msg, result.convId)
            totalMessages++
          }
        }

        logConcurrent(`Completed page ${page}`, rateLimiter.getActiveCount())
      }

      // Break out of while loop if limit reached
      if (limit && totalConversations >= limit) {
        break
      }

      // Update sync state periodically (every page)
      await updateSyncState(
        db,
        inbox.id,
        totalConversations,
        latestConversationAt
      )

      url = nextUrl
      page++
    } catch (err) {
      logError(`page ${page} of ${inbox.name}`, err)
      // Save progress and continue
      await updateSyncState(
        db,
        inbox.id,
        totalConversations,
        latestConversationAt
      )
      break
    }
  }

  // Final sync state update
  await updateSyncState(db, inbox.id, totalConversations, latestConversationAt)
  await updateInboxCount(db, inbox.id)

  if (resumeFromConversation && !foundResumePoint) {
    log(
      `   ⚠️ Resume point ${resumeFromConversation} not found - may have completed`
    )
  }

  log(
    `   ✅ ${inbox.name} complete: ${totalConversations} conversations, ${totalMessages} messages, ${totalThreads} threads`
  )

  return {
    conversationCount: totalConversations,
    messageCount: totalMessages,
    threadCount: totalThreads,
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleInit(options: CacheOptions): Promise<void> {
  const startTime = Date.now()
  log('🚀 Starting FULL IMPORT of Front conversations')
  log(`   Database: ${DB_PATH}`)
  log(`   Limit per inbox: ${options.limit || 'unlimited'}`)

  const db = await createDb()
  const headers = getHeaders()

  try {
    // Run schema migrations for thread tracking
    await runMigrations(db)

    // Get inboxes
    let inboxes = await fetchAllInboxes(headers)

    // Filter by inbox if specified
    if (options.inbox) {
      inboxes = inboxes.filter((i) => i.id === options.inbox)
      if (inboxes.length === 0) {
        throw new Error(`Inbox ${options.inbox} not found`)
      }
      log(`   Filtering to inbox: ${options.inbox}`)
    }

    // Sync inboxes table
    await syncInboxes(db, inboxes)

    // Sync each inbox
    let totalConversations = 0
    let totalMessages = 0
    let totalThreads = 0

    for (const [i, inbox] of inboxes.entries()) {
      const result = await syncInbox(
        db,
        inbox,
        headers,
        i + 1,
        inboxes.length,
        options.limit
      )
      totalConversations += result.conversationCount
      totalMessages += result.messageCount
      totalThreads += result.threadCount
    }

    // Final summary
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
    log('\n' + '='.repeat(60))
    log('📊 IMPORT COMPLETE')
    log('='.repeat(60))
    log(`   Duration:      ${duration} minutes`)
    log(`   Inboxes:       ${inboxes.length}`)
    log(`   Conversations: ${totalConversations}`)
    log(`   Messages:      ${totalMessages}`)
    log(`   Threads:       ${totalThreads}`)

    // Get DB size
    const dbStats = await allQuery<{ database_size: string }>(
      db,
      `SELECT database_size FROM pragma_database_size()`
    )
    log(`   DB Size:       ${dbStats[0]?.database_size || 'unknown'}`)
    log('='.repeat(60))
  } finally {
    db.close?.() || db.terminate?.() || true
  }
}

async function handleResume(options: CacheOptions): Promise<void> {
  const startTime = Date.now()
  log('🔄 Resuming interrupted import')
  log(`   Database: ${DB_PATH}`)

  const db = await createDb()
  const headers = getHeaders()

  try {
    // Run schema migrations for thread tracking
    await runMigrations(db)

    // Get inboxes that have incomplete sync (or no sync)
    const inboxes = await fetchAllInboxes(headers)
    await syncInboxes(db, inboxes)

    let totalConversations = 0
    let totalMessages = 0
    let totalThreads = 0

    for (const [i, inbox] of inboxes.entries()) {
      // Check sync state
      const state = await getSyncState(db, inbox.id)

      if (options.inbox && inbox.id !== options.inbox) {
        continue
      }

      // Get last conversation ID to resume from
      const lastConv = await allQuery<{ id: string }>(
        db,
        `SELECT id FROM conversations WHERE inbox_id = ? ORDER BY synced_at DESC LIMIT 1`,
        [inbox.id]
      )

      const resumeFrom = lastConv[0]?.id
      if (resumeFrom) {
        log(
          `   Resuming ${inbox.name} from ${resumeFrom} (${state?.total_synced || 0} already synced)`
        )
      }

      const result = await syncInbox(
        db,
        inbox,
        headers,
        i + 1,
        inboxes.length,
        options.limit,
        resumeFrom
      )
      totalConversations += result.conversationCount
      totalMessages += result.messageCount
      totalThreads += result.threadCount
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
    log('\n📊 RESUME COMPLETE')
    log(`   Duration:      ${duration} minutes`)
    log(`   Conversations: ${totalConversations}`)
    log(`   Threads:       ${totalThreads}`)
    log(`   Messages:      ${totalMessages}`)
  } finally {
    db.close?.() || db.terminate?.() || true
  }
}

async function handleSync(options: CacheOptions): Promise<void> {
  const startTime = Date.now()
  log('🔄 Starting INCREMENTAL SYNC')
  log(`   Database: ${DB_PATH}`)
  log('   Fetching only conversations updated since last sync')

  const db = await createDb()
  const headers = getHeaders()

  try {
    // Run schema migrations for thread tracking
    await runMigrations(db)

    let inboxes = await fetchAllInboxes(headers)

    if (options.inbox) {
      inboxes = inboxes.filter((i) => i.id === options.inbox)
    }

    await syncInboxes(db, inboxes)

    let totalConversations = 0
    let totalMessages = 0
    let totalThreads = 0

    for (const [i, inbox] of inboxes.entries()) {
      const state = await getSyncState(db, inbox.id)

      log(`\n📬 [${i + 1}/${inboxes.length}] ${inbox.name}`)
      log(`   Last sync: ${state?.last_sync_at || 'never'}`)

      // For incremental sync, we fetch recent conversations and check for updates
      // Front API doesn't support filtering by updated_at, so we fetch pages
      // and stop when we hit conversations older than last sync

      let url: string | null =
        `${FRONT_API_BASE}/inboxes/${inbox.id}/conversations?limit=50`
      let page = 1
      let conversationCount = 0
      let messageCount = 0
      let threadCount = 0
      let shouldContinue = true

      while (url && shouldContinue) {
        await sleep(REQUEST_DELAY_MS)

        const { conversations, nextUrl } = await fetchConversationsPage(
          inbox.id,
          url,
          headers
        )

        // Filter conversations that need processing
        const toProcess: FrontConversation[] = []

        for (const conv of conversations) {
          // Check if conversation was updated since last sync
          const lastSync = state?.last_sync_at
            ? new Date(state.last_sync_at)
            : new Date(0)

          if (
            conv.last_message_at &&
            conv.last_message_at * 1000 < lastSync.getTime()
          ) {
            // Conversation is older than last sync, we can stop
            shouldContinue = false
            break
          }

          toProcess.push(conv)

          if (
            options.limit &&
            conversationCount + toProcess.length >= options.limit
          ) {
            shouldContinue = false
            break
          }
        }

        // Insert conversations first
        for (const conv of toProcess) {
          const { parentId } = await insertConversation(db, conv, inbox.id)
          conversationCount++
          if (parentId) threadCount++
        }

        // Parallel message fetching with rate limiting
        if (toProcess.length > 0) {
          logConcurrent(
            `Fetching messages for ${toProcess.length} conversations`,
            rateLimiter.getActiveCount()
          )

          const messageResults = await Promise.all(
            toProcess.map((conv) =>
              fetchMessages(conv.id, headers)
                .then((messages) => ({
                  convId: conv.id,
                  messages,
                  error: null,
                }))
                .catch((err) => ({
                  convId: conv.id,
                  messages: [] as FrontMessage[],
                  error: err,
                }))
            )
          )

          for (const result of messageResults) {
            if (result.error) {
              logError(`fetching messages for ${result.convId}`, result.error)
              continue
            }
            for (const msg of result.messages) {
              await insertMessage(db, msg, result.convId)
              messageCount++
            }
          }
        }

        logProgress(
          i + 1,
          inboxes.length,
          inbox.name,
          page,
          nextUrl ? '?' : `${page}`,
          conversationCount
        )

        url = nextUrl
        page++
      }

      await updateSyncState(
        db,
        inbox.id,
        (state?.total_synced || 0) + conversationCount
      )
      await updateInboxCount(db, inbox.id)

      totalConversations += conversationCount
      totalMessages += messageCount
      totalThreads += threadCount

      log(
        `   ✅ Synced ${conversationCount} conversations, ${messageCount} messages, ${threadCount} threads`
      )
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
    log('\n📊 SYNC COMPLETE')
    log(`   Duration:      ${duration} minutes`)
    log(`   Conversations: ${totalConversations}`)
    log(`   Messages:      ${totalMessages}`)
    log(`   Threads:       ${totalThreads}`)
  } finally {
    db.close?.() || db.terminate?.() || true
  }
}

async function handleStats(options: CacheOptions): Promise<void> {
  log('📊 Cache Statistics')
  log(`   Database: ${DB_PATH}`)
  log('')

  const db = await createDb()

  try {
    // Get DB size
    const size = await allQuery<{ database_size: string }>(
      db,
      `SELECT database_size FROM pragma_database_size()`
    )
    const sizeStr = size[0]?.database_size || 'unknown'

    // Total counts
    const inboxCount = await allQuery<{ c: number }>(
      db,
      `SELECT COUNT(*) as c FROM inboxes`
    )
    const convCount = await allQuery<{ c: number }>(
      db,
      `SELECT COUNT(*) as c FROM conversations`
    )
    const msgCount = await allQuery<{ c: number }>(
      db,
      `SELECT COUNT(*) as c FROM messages`
    )

    console.log('='.repeat(50))
    console.log('Overall Stats')
    console.log('='.repeat(50))
    console.log(`Database Size:    ${sizeStr}`)
    console.log(`Total Inboxes:    ${inboxCount[0]?.c || 0}`)
    console.log(`Total Conversations: ${convCount[0]?.c || 0}`)
    console.log(`Total Messages:   ${msgCount[0]?.c || 0}`)
    console.log('')

    // Per-inbox breakdown
    console.log('='.repeat(50))
    console.log('Per-Inbox Breakdown')
    console.log('='.repeat(50))

    const inboxStats = await allQuery<{
      name: string
      id: string
      conversation_count: number
      last_sync_at: string | null
    }>(
      db,
      `SELECT i.name, i.id, i.conversation_count, 
              s.last_sync_at::VARCHAR as last_sync_at
       FROM inboxes i
       LEFT JOIN sync_state s ON i.id = s.inbox_id
       ORDER BY i.conversation_count DESC`
    )

    for (const inbox of inboxStats) {
      const syncTime = inbox.last_sync_at
        ? new Date(inbox.last_sync_at).toLocaleString()
        : 'never'
      console.log(
        `${inbox.name.padEnd(30)} ${String(inbox.conversation_count).padStart(6)} convs  (last sync: ${syncTime})`
      )
    }

    // Status breakdown
    console.log('')
    console.log('='.repeat(50))
    console.log('By Status')
    console.log('='.repeat(50))

    const statusStats = await allQuery<{ status: string; c: number }>(
      db,
      `SELECT status, COUNT(*) as c FROM conversations GROUP BY status ORDER BY c DESC`
    )

    for (const s of statusStats) {
      console.log(
        `${(s.status || 'unknown').padEnd(20)} ${String(s.c).padStart(8)}`
      )
    }

    // Thread statistics
    console.log('')
    console.log('='.repeat(50))
    console.log('Thread Statistics')
    console.log('='.repeat(50))

    const threadStats = await allQuery<{ c: number }>(
      db,
      `SELECT COUNT(*) as c FROM conversations WHERE parent_id IS NOT NULL`
    ).catch(() => [{ c: 0 }]) // Handle case where column doesn't exist yet

    const depthStats = await allQuery<{ depth: number; c: number }>(
      db,
      `SELECT thread_depth as depth, COUNT(*) as c 
       FROM conversations 
       WHERE thread_depth > 0 
       GROUP BY thread_depth 
       ORDER BY thread_depth`
    ).catch(() => [])

    console.log(`Total Threaded:      ${threadStats[0]?.c || 0}`)
    if (depthStats.length > 0) {
      for (const d of depthStats) {
        console.log(`  Depth ${d.depth}:           ${String(d.c).padStart(6)}`)
      }
    }

    if (options.json) {
      console.log(
        '\n' +
          JSON.stringify(
            {
              size: sizeStr,
              inboxes: inboxCount[0]?.c,
              conversations: convCount[0]?.c,
              messages: msgCount[0]?.c,
              inboxBreakdown: inboxStats,
              statusBreakdown: statusStats,
            },
            null,
            2
          )
      )
    }
  } finally {
    db.close?.() || db.terminate?.() || true
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function frontCache(options: CacheOptions): Promise<void> {
  try {
    if (options.stats) {
      await handleStats(options)
    } else if (options.init) {
      await handleInit(options)
    } else if (options.resume) {
      await handleResume(options)
    } else if (options.sync) {
      await handleSync(options)
    } else {
      console.log('Usage: front cache [--init|--sync|--stats|--resume]')
      console.log('')
      console.log('Options:')
      console.log('  --init         Full import all inboxes')
      console.log('  --sync         Incremental sync (new conversations only)')
      console.log('  --stats        Show cache statistics')
      console.log('  --resume       Resume interrupted import')
      console.log('  --inbox <id>   Filter to specific inbox')
      console.log('  --limit <n>    Limit conversations per inbox')
      console.log('  --json         JSON output (stats only)')
    }
  } catch (error) {
    logError('main', error)
    process.exit(1)
  }
}

// ============================================================================
// Register Command
// ============================================================================

export function registerCacheCommand(parent: Command): void {
  parent
    .command('cache')
    .description('Build and maintain DuckDB cache of Front conversations')
    .option('--init', 'Full import all inboxes')
    .option('--sync', 'Incremental sync (new conversations only)')
    .option('--stats', 'Show cache statistics')
    .option('--resume', 'Resume interrupted import')
    .option('-i, --inbox <id>', 'Filter to specific inbox')
    .option('-l, --limit <n>', 'Limit conversations per inbox', parseInt)
    .option('--json', 'JSON output')
    .action(frontCache)
}
