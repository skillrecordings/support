#!/usr/bin/env bun
/**
 * Embedding Generation for Conversation Clustering
 *
 * Generates embeddings for all customer first-messages from DuckDB cache.
 * Phase 0.1 of FAQ Mining epic.
 *
 * Usage:
 *   bun scripts/embed-conversations.ts
 *   bun scripts/embed-conversations.ts --resume  # Resume from checkpoint
 *   bun scripts/embed-conversations.ts --dry-run # Count messages only
 *
 * Issue: https://github.com/skillrecordings/support/issues/95
 * Filter integration: https://github.com/skillrecordings/support/issues/112
 */

import * as path from 'path'
import * as fs from 'fs'
import OpenAI from 'openai'
import {
  shouldFilter,
  createFilterStats,
  updateFilterStats,
  formatFilterStats,
  type FilterStats,
} from '../packages/core/src/faq/filters'

// ============================================================================
// Configuration
// ============================================================================

const DB_PATH = path.join(process.env.HOME || '~', 'skill/data/front-cache.db')
const OUTPUT_DIR = path.join(
  process.env.HOME || '~',
  'Code/skillrecordings/support/artifacts/phase-0/embeddings'
)
const VERSION = 'v2'
const OUTPUT_PATH = path.join(OUTPUT_DIR, VERSION)
const PARQUET_FILE = path.join(OUTPUT_PATH, 'conversations.parquet')
const STATS_FILE = path.join(OUTPUT_PATH, 'stats.json')
const CHECKPOINT_FILE = path.join(OUTPUT_PATH, '.checkpoint.json')

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
const BATCH_SIZE = 100 // OpenAI limit is 2048, but 100 is safer
const CHECKPOINT_INTERVAL = 1000 // Save checkpoint every N conversations
const MAX_RETRIES = 5
const BASE_BACKOFF_MS = 1000

// Cost estimation: text-embedding-3-small is $0.02 per 1M tokens
const COST_PER_MILLION_TOKENS = 0.02

// ============================================================================
// Types
// ============================================================================

interface ConversationRow {
  conversation_id: string
  inbox_id: string
  tags: string[] | null  // DuckDB returns VARCHAR[] as native array
  first_message: string | null
  sender_email: string | null  // For domain-based filtering
}

interface EmbeddedConversation {
  conversation_id: string
  inbox_id: string
  tags: string[]
  first_message: string
  embedding: number[]
  token_count: number
}

interface Checkpoint {
  processedIds: string[]
  lastProcessedIndex: number
  totalRows: number
  startedAt: string
}

interface Stats {
  version: number
  total_conversations: number
  embedded_count: number
  skipped_empty: number
  skipped_filtered: number
  failed_count: number
  avg_token_count: number
  model: string
  dimensions: number
  cost_usd: number
  runtime_seconds: number
  created_at: string
  preprocessing: {
    html_stripped: boolean
    whitespace_normalized: boolean
    min_length: number
    filters_applied: boolean
  }
  filter_stats: FilterStats
}

// ============================================================================
// DuckDB Connection
// ============================================================================

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

function queryAll<T>(
  db: InstanceType<DuckDB['Database']>,
  sql: string
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err: Error | null, rows: T[]) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

function execQuery(
  db: InstanceType<DuckDB['Database']>,
  sql: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// ============================================================================
// OpenAI Embeddings
// ============================================================================

let openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI()
  }
  return openai
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get embeddings for a batch of texts with retry logic.
 */
async function getEmbeddingsWithRetry(
  texts: string[],
  retries = MAX_RETRIES
): Promise<{ embeddings: number[][]; tokenCounts: number[] }> {
  if (texts.length === 0) {
    return { embeddings: [], tokenCounts: [] }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const client = getOpenAI()
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      })

      // Sort by index to ensure order matches input
      const sorted = response.data.sort((a, b) => a.index - b.index)
      const embeddings = sorted.map((item) => item.embedding)

      // Extract token counts from usage (approximate per-text)
      const totalTokens = response.usage.prompt_tokens
      const avgTokens = Math.ceil(totalTokens / texts.length)
      const tokenCounts = texts.map(() => avgTokens) // Approximate

      return { embeddings, tokenCounts }
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes('429') || error.message.includes('rate'))
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt)

      if (isRateLimit && attempt < retries) {
        console.log(
          `  ⚠️  Rate limited, backing off ${backoff / 1000}s (attempt ${attempt + 1}/${retries})`
        )
        await sleep(backoff)
        continue
      }

      if (attempt < retries) {
        console.log(
          `  ⚠️  Error, retrying in ${backoff / 1000}s: ${error instanceof Error ? error.message : error}`
        )
        await sleep(backoff)
        continue
      }

      throw error
    }
  }

  throw new Error('Exhausted retries')
}

// ============================================================================
// Text Preprocessing
// ============================================================================

/**
 * Strip HTML tags from text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ') // Remove HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Normalize whitespace in text.
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim()
}

/**
 * Clean and normalize a message for embedding.
 */
function cleanMessage(text: string | null): string | null {
  if (!text) return null

  let cleaned = stripHtml(text)
  cleaned = normalizeWhitespace(cleaned)

  // Skip very short messages (likely not useful)
  if (cleaned.length < 10) return null

  // Truncate very long messages (embedding model has limits)
  if (cleaned.length > 8000) {
    cleaned = cleaned.slice(0, 8000)
  }

  return cleaned
}

// ============================================================================
// Checkpoint Management
// ============================================================================

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch {
    console.log('  ⚠️  Could not load checkpoint, starting fresh')
  }
  return null
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
}

function clearCheckpoint(): void {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE)
  }
}

// ============================================================================
// Main Processing
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const resume = args.includes('--resume')
  const dryRun = args.includes('--dry-run')

  console.log('📊 Embedding Generation for Conversation Clustering')
  console.log('=' .repeat(60))
  console.log(`Model: ${EMBEDDING_MODEL}`)
  console.log(`Dimensions: ${EMBEDDING_DIMENSIONS}`)
  console.log(`Batch size: ${BATCH_SIZE}`)
  console.log(`Output: ${PARQUET_FILE}`)
  console.log()

  const startTime = Date.now()

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_PATH, { recursive: true })

  // Connect to DuckDB
  console.log('🔗 Connecting to DuckDB...')
  const ddb = await loadDuckDB()
  const db = new ddb.Database(DB_PATH, ddb.OPEN_READONLY)

  // Query first messages
  console.log('📥 Querying first messages from archived conversations...')

  const query = `
    WITH first_messages AS (
      SELECT 
        c.id as conversation_id,
        c.tags,
        c.inbox_id,
        m.body_text as first_message,
        m.author_email as sender_email,
        ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY m.created_at) as rn
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      WHERE m.is_inbound = true
        AND c.status = 'archived'
    )
    SELECT conversation_id, inbox_id, tags, first_message, sender_email
    FROM first_messages WHERE rn = 1
    ORDER BY conversation_id
  `

  const rows = await queryAll<ConversationRow>(db, query)
  console.log(`  Found ${rows.length} archived conversations with inbound messages`)

  if (dryRun) {
    console.log('\n🏃 Dry run - counting only')
    let validCount = 0
    let emptyCount = 0
    const dryRunFilterStats = createFilterStats()
    for (const row of rows) {
      const cleaned = cleanMessage(row.first_message)
      if (!cleaned) {
        emptyCount++
        continue
      }
      // Apply noise filters
      const filterResult = shouldFilter(cleaned, row.sender_email ?? undefined)
      updateFilterStats(dryRunFilterStats, filterResult)
      if (!filterResult.filtered) {
        validCount++
      }
    }
    console.log(`  Valid messages (after filtering): ${validCount}`)
    console.log(`  Empty/short: ${emptyCount}`)
    console.log(`\n${formatFilterStats(dryRunFilterStats)}`)
    console.log(`  Estimated cost: $${((validCount * 100 * COST_PER_MILLION_TOKENS) / 1_000_000).toFixed(2)} - $${((validCount * 200 * COST_PER_MILLION_TOKENS) / 1_000_000).toFixed(2)}`)
    db.close()
    return
  }

  // Check for checkpoint
  let checkpoint = resume ? loadCheckpoint() : null
  const processedSet = new Set<string>(checkpoint?.processedIds || [])
  let startIndex = checkpoint?.lastProcessedIndex || 0

  if (checkpoint) {
    console.log(`\n📍 Resuming from checkpoint at index ${startIndex}`)
    console.log(`  Already processed: ${processedSet.size} conversations`)
  }

  // Process in batches
  const embedded: EmbeddedConversation[] = []
  let skippedEmpty = 0
  let skippedFiltered = 0
  let failedCount = 0
  let totalTokens = 0
  const filterStats = createFilterStats()

  console.log('\n🚀 Starting embedding generation (with noise filtering)...')

  for (let i = startIndex; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const validBatch: { row: ConversationRow; cleaned: string }[] = []

    // Filter and clean batch
    for (const row of batch) {
      if (processedSet.has(row.conversation_id)) continue

      const cleaned = cleanMessage(row.first_message)
      if (!cleaned) {
        skippedEmpty++
        processedSet.add(row.conversation_id)
        continue
      }

      // Apply noise filters BEFORE embedding (Issue #112)
      const filterResult = shouldFilter(cleaned, row.sender_email ?? undefined)
      updateFilterStats(filterStats, filterResult)
      if (filterResult.filtered) {
        skippedFiltered++
        processedSet.add(row.conversation_id)
        continue
      }

      validBatch.push({ row, cleaned })
    }

    if (validBatch.length === 0) {
      continue
    }

    // Get embeddings
    try {
      const texts = validBatch.map((v) => v.cleaned)
      const { embeddings, tokenCounts } = await getEmbeddingsWithRetry(texts)

      // Store results
      for (let j = 0; j < validBatch.length; j++) {
        const { row, cleaned } = validBatch[j]!
        const embedding = embeddings[j]!
        const tokenCount = tokenCounts[j]!

        // Tags come as native array from DuckDB VARCHAR[]
        let tags: string[] = []
        if (row.tags && Array.isArray(row.tags)) {
          tags = row.tags
        } else if (typeof row.tags === 'string') {
          // Fallback: try JSON parse if somehow stringified
          try {
            tags = JSON.parse(row.tags)
          } catch {
            tags = []
          }
        }

        embedded.push({
          conversation_id: row.conversation_id,
          inbox_id: row.inbox_id,
          tags,
          first_message: cleaned,
          embedding,
          token_count: tokenCount,
        })

        totalTokens += tokenCount
        processedSet.add(row.conversation_id)
      }

      const progress = Math.min(i + BATCH_SIZE, rows.length)
      const percent = ((progress / rows.length) * 100).toFixed(1)
      console.log(
        `  [${progress}/${rows.length}] ${percent}% - Embedded ${embedded.length}, Empty ${skippedEmpty}, Filtered ${skippedFiltered}`
      )
    } catch (error) {
      console.error(`  ❌ Failed batch at index ${i}:`, error)
      failedCount += validBatch.length
      for (const { row } of validBatch) {
        processedSet.add(row.conversation_id)
      }
    }

    // Save checkpoint periodically
    if ((i + BATCH_SIZE) % CHECKPOINT_INTERVAL < BATCH_SIZE) {
      saveCheckpoint({
        processedIds: Array.from(processedSet),
        lastProcessedIndex: i + BATCH_SIZE,
        totalRows: rows.length,
        startedAt: checkpoint?.startedAt || new Date().toISOString(),
      })
      console.log(`  💾 Checkpoint saved at index ${i + BATCH_SIZE}`)
    }
  }

  const endTime = Date.now()
  const runtimeSeconds = (endTime - startTime) / 1000

  console.log('\n✅ Embedding generation complete!')
  console.log(`  Total embedded: ${embedded.length}`)
  console.log(`  Skipped (empty/short): ${skippedEmpty}`)
  console.log(`  Skipped (filtered noise): ${skippedFiltered}`)
  console.log(`  Failed: ${failedCount}`)
  console.log(`  Runtime: ${runtimeSeconds.toFixed(1)}s`)
  console.log(`\n${formatFilterStats(filterStats)}`)

  // Write to Parquet using DuckDB
  console.log('\n📦 Writing Parquet file...')

  // Create a new DuckDB connection for writing
  const writeDb = new ddb.Database(path.join(OUTPUT_PATH, 'temp.duckdb'))

  // Create table with proper schema
  await execQuery(
    writeDb,
    `
    CREATE TABLE conversations (
      conversation_id VARCHAR,
      inbox_id VARCHAR,
      tags VARCHAR[],
      first_message VARCHAR,
      embedding FLOAT[${EMBEDDING_DIMENSIONS}],
      token_count INTEGER
    )
  `
  )

  // Insert data in batches (DuckDB doesn't like huge single inserts)
  const INSERT_BATCH = 500
  for (let i = 0; i < embedded.length; i += INSERT_BATCH) {
    const insertBatch = embedded.slice(i, i + INSERT_BATCH)

    for (const row of insertBatch) {
      const tagsStr = `['${row.tags.map((t) => t.replace(/'/g, "''")).join("','")}']`
      const embeddingStr = `[${row.embedding.join(',')}]`
      const messageEscaped = row.first_message.replace(/'/g, "''")

      await execQuery(
        writeDb,
        `
        INSERT INTO conversations VALUES (
          '${row.conversation_id}',
          '${row.inbox_id}',
          ${row.tags.length > 0 ? tagsStr : '[]::VARCHAR[]'},
          '${messageEscaped}',
          ${embeddingStr}::FLOAT[${EMBEDDING_DIMENSIONS}],
          ${row.token_count}
        )
      `
      )
    }

    if ((i + INSERT_BATCH) % 2000 === 0) {
      console.log(`  Inserted ${Math.min(i + INSERT_BATCH, embedded.length)}/${embedded.length}`)
    }
  }

  // Export to Parquet
  await execQuery(writeDb, `COPY conversations TO '${PARQUET_FILE}' (FORMAT PARQUET)`)
  console.log(`  ✅ Written to ${PARQUET_FILE}`)

  writeDb.close()

  // Generate stats
  const avgTokenCount =
    embedded.length > 0 ? Math.round(totalTokens / embedded.length) : 0
  const costUsd = (totalTokens * COST_PER_MILLION_TOKENS) / 1_000_000

  const stats: Stats = {
    version: 2,
    total_conversations: rows.length,
    embedded_count: embedded.length,
    skipped_empty: skippedEmpty,
    skipped_filtered: skippedFiltered,
    failed_count: failedCount,
    avg_token_count: avgTokenCount,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    cost_usd: Math.round(costUsd * 100) / 100,
    runtime_seconds: Math.round(runtimeSeconds),
    created_at: new Date().toISOString(),
    preprocessing: {
      html_stripped: true,
      whitespace_normalized: true,
      min_length: 10,
      filters_applied: true,
    },
    filter_stats: filterStats,
  }

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
  console.log(`  ✅ Stats written to ${STATS_FILE}`)

  // Create latest symlink
  const latestLink = path.join(OUTPUT_DIR, 'latest')
  if (fs.existsSync(latestLink)) {
    fs.unlinkSync(latestLink)
  }
  fs.symlinkSync(VERSION, latestLink)
  console.log(`  ✅ Symlink created: latest -> ${VERSION}`)

  // Clear checkpoint on success
  clearCheckpoint()

  // Close DB
  db.close()

  console.log('\n📊 Final Stats:')
  console.log(JSON.stringify(stats, null, 2))
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
