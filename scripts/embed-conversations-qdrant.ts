#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const DUCKDB_PATH = path.join(process.cwd(), 'artifacts/phase-0/embeddings/v2/temp.duckdb')
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const EMBEDDING_MODEL = 'mxbai-embed-large'
const CHECKPOINT_DIR = path.join(process.cwd(), 'artifacts/conversation-embeddings')
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, 'checkpoint.json')
const BATCH_SIZE = 100  // Process 100, then checkpoint
const DELAY_MS = 10
const PROGRESS_INTERVAL = 500

interface ConversationRow {
  conversation_id: string
  inbox_id: string
  tags: string
  first_message: string
  token_count: number
}

interface Checkpoint {
  processedIds: string[]
  embedded: number
  skipped: number
  lastIndex: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function ensureCollection() {
  const check = await fetch(`${QDRANT_URL}/collections/conversations`)
  if (check.ok) {
    const data = await check.json()
    if (data.result?.config?.params?.vectors?.size === 1024) {
      console.log('Collection "conversations" already exists')
      return
    }
    await fetch(`${QDRANT_URL}/collections/conversations`, { method: 'DELETE' })
  }
  
  const response = await fetch(`${QDRANT_URL}/collections/conversations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vectors: { size: 1024, distance: 'Cosine' } })
  })
  
  if (!response.ok) throw new Error(`Failed to create collection: ${response.status}`)
  console.log('Created collection "conversations"')
}

async function getOllamaEmbedding(text: string, retries = 2): Promise<number[] | null> {
  const cleanText = text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)
  
  if (cleanText.length < 10) return null
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await sleep(DELAY_MS)
      const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: cleanText }),
      })
      if (!response.ok) {
        if (attempt < retries) { await sleep(300); continue }
        return null
      }
      const data = await response.json()
      return data.embedding
    } catch {
      if (attempt >= retries) return null
      await sleep(300)
    }
  }
  return null
}

async function upsertBatch(points: Array<{ id: number; vector: number[]; payload: Record<string, unknown> }>) {
  const response = await fetch(`${QDRANT_URL}/collections/conversations/points?wait=true`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points })
  })
  if (!response.ok) console.error(`Upsert failed: ${response.status}`)
}

async function getExistingCount(): Promise<number> {
  const response = await fetch(`${QDRANT_URL}/collections/conversations`)
  if (!response.ok) return 0
  const data = await response.json()
  return data.result?.points_count || 0
}

async function loadCheckpoint(): Promise<Checkpoint | null> {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await fs.mkdir(CHECKPOINT_DIR, { recursive: true })
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(cp, null, 2))
}

async function main() {
  console.log('=== Embed Conversations to Qdrant (Resumable) ===\n')
  
  await fs.mkdir(CHECKPOINT_DIR, { recursive: true })
  await ensureCollection()
  
  // Load checkpoint
  let checkpoint = await loadCheckpoint()
  const processedSet = new Set(checkpoint?.processedIds || [])
  let embedded = checkpoint?.embedded || 0
  let skipped = checkpoint?.skipped || 0
  
  if (checkpoint) {
    console.log(`Resuming from checkpoint: ${processedSet.size} already processed`)
    console.log(`  Embedded: ${embedded}, Skipped: ${skipped}\n`)
  }
  
  // Load conversations
  console.log('Loading conversations from DuckDB...')
  const { Database } = await import('duckdb-async')
  const db = await Database.create(DUCKDB_PATH, { access_mode: 'READ_ONLY' })
  
  const rows = await db.all<ConversationRow>(`
    SELECT conversation_id, inbox_id, tags, first_message, token_count
    FROM conversations
    WHERE first_message IS NOT NULL AND length(first_message) > 10
    ORDER BY conversation_id
  `)
  await db.close()
  
  console.log(`Total conversations: ${rows.length}`)
  
  // Filter already processed
  const remaining = rows.filter(r => !processedSet.has(r.conversation_id))
  console.log(`Remaining to process: ${remaining.length}\n`)
  
  if (remaining.length === 0) {
    console.log('All conversations already processed!')
    const finalCount = await getExistingCount()
    console.log(`Qdrant points: ${finalCount}`)
    return
  }
  
  // Process with checkpoints
  const startTime = Date.now()
  const pendingPoints: Array<{ id: number; vector: number[]; payload: Record<string, unknown> }> = []
  
  for (let i = 0; i < remaining.length; i++) {
    const row = remaining[i]
    
    // Stable ID based on position in full list
    const fullIndex = rows.findIndex(r => r.conversation_id === row.conversation_id)
    const pointId = fullIndex + 1
    
    const embedding = await getOllamaEmbedding(row.first_message ?? '')
    
    if (embedding) {
      pendingPoints.push({
        id: pointId,
        vector: embedding,
        payload: {
          conversation_id: row.conversation_id,
          inbox_id: row.inbox_id,
          tags: row.tags || '',
          first_message_preview: row.first_message?.slice(0, 200) || ''
        }
      })
      embedded++
    } else {
      skipped++
    }
    
    processedSet.add(row.conversation_id)
    
    // Batch upsert + checkpoint
    if (pendingPoints.length >= BATCH_SIZE) {
      await upsertBatch(pendingPoints)
      pendingPoints.length = 0
      
      await saveCheckpoint({
        processedIds: Array.from(processedSet),
        embedded,
        skipped,
        lastIndex: i
      })
      
      const pct = ((processedSet.size / rows.length) * 100).toFixed(1)
      console.log(`Checkpoint: ${processedSet.size}/${rows.length} (${pct}%) | Embedded: ${embedded} | Skipped: ${skipped}`)
    }
    
    // Progress log
    if ((i + 1) % PROGRESS_INTERVAL === 0) {
      const elapsed = (Date.now() - startTime) / 1000
      const rate = (i + 1) / elapsed
      const eta = Math.ceil((remaining.length - i - 1) / rate / 60)
      console.log(`Progress: ${i + 1}/${remaining.length} | Rate: ${rate.toFixed(1)}/s | ETA: ${eta}m`)
    }
  }
  
  // Final batch
  if (pendingPoints.length > 0) {
    await upsertBatch(pendingPoints)
  }
  
  // Final checkpoint
  await saveCheckpoint({
    processedIds: Array.from(processedSet),
    embedded,
    skipped,
    lastIndex: remaining.length
  })
  
  const finalCount = await getExistingCount()
  const elapsed = (Date.now() - startTime) / 1000
  
  console.log(`\n=== Done in ${(elapsed / 60).toFixed(1)}m ===`)
  console.log(`Processed: ${processedSet.size}`)
  console.log(`Embedded: ${embedded}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Qdrant points: ${finalCount}`)
}

main().catch(console.error)
