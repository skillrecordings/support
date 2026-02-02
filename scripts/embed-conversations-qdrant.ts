#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const DUCKDB_PATH = path.join(process.cwd(), 'artifacts/phase-0/embeddings/v2/temp.duckdb')
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const EMBEDDING_MODEL = 'mxbai-embed-large'
const BATCH_SIZE = 50
const DELAY_MS = 20
const PROGRESS_INTERVAL = 500

interface ConversationRow {
  conversation_id: string
  inbox_id: string
  tags: string
  first_message: string
  token_count: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function ensureCollection() {
  // Check if exists
  const check = await fetch(`${QDRANT_URL}/collections/conversations`)
  if (check.ok) {
    const data = await check.json()
    if (data.result?.config?.params?.vectors?.size === 1024) {
      console.log('Collection "conversations" already exists')
      return
    }
    // Delete if wrong dimensions
    await fetch(`${QDRANT_URL}/collections/conversations`, { method: 'DELETE' })
  }
  
  // Create
  const response = await fetch(`${QDRANT_URL}/collections/conversations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vectors: { size: 1024, distance: 'Cosine' }
    })
  })
  
  if (!response.ok) {
    throw new Error(`Failed to create collection: ${response.status}`)
  }
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
  if (!response.ok) {
    console.error(`Upsert failed: ${response.status}`)
  }
}

async function getExistingCount(): Promise<number> {
  const response = await fetch(`${QDRANT_URL}/collections/conversations`)
  if (!response.ok) return 0
  const data = await response.json()
  return data.result?.points_count || 0
}

async function main() {
  console.log('=== Embed Conversations to Qdrant ===\n')
  
  // Ensure collection
  await ensureCollection()
  
  // Check existing
  const existingCount = await getExistingCount()
  console.log(`Existing points: ${existingCount}`)
  
  // Load conversations
  console.log('Loading conversations from DuckDB...')
  const { Database } = await import('duckdb-async')
  const db = await Database.create(DUCKDB_PATH, { access_mode: 'READ_ONLY' })
  
  const rows = await db.all<ConversationRow>(`
    SELECT conversation_id, inbox_id, tags, first_message, token_count
    FROM conversations
    WHERE first_message IS NOT NULL AND length(first_message) > 20
    ORDER BY conversation_id
  `)
  await db.close()
  
  console.log(`Loaded ${rows.length} conversations\n`)
  
  // Process
  let processed = 0
  let embedded = 0
  let skipped = 0
  const startTime = Date.now()
  
  const pendingPoints: Array<{ id: number; vector: number[]; payload: Record<string, unknown> }> = []
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    
    // Generate unique numeric ID from conversation_id
    const numId = parseInt(row.conversation_id.replace(/[^0-9]/g, '').slice(-9)) || i
    
    // Get embedding
    const embedding = await getOllamaEmbedding(row.first_message)
    
    if (embedding) {
      pendingPoints.push({
        id: numId,
        vector: embedding,
        payload: {
          conversation_id: row.conversation_id,
          inbox_id: row.inbox_id,
          tags: row.tags || '',
          first_message_preview: row.first_message.slice(0, 200),
          token_count: row.token_count
        }
      })
      embedded++
    } else {
      skipped++
    }
    
    // Batch upsert
    if (pendingPoints.length >= BATCH_SIZE) {
      await upsertBatch(pendingPoints)
      pendingPoints.length = 0
    }
    
    processed++
    
    // Progress
    if (processed % PROGRESS_INTERVAL === 0) {
      const elapsed = (Date.now() - startTime) / 1000
      const rate = processed / elapsed
      const remaining = (rows.length - processed) / rate
      console.log(`Progress: ${processed}/${rows.length} (${(processed/rows.length*100).toFixed(1)}%) | Embedded: ${embedded} | Skipped: ${skipped} | ETA: ${Math.ceil(remaining/60)}m`)
    }
  }
  
  // Final batch
  if (pendingPoints.length > 0) {
    await upsertBatch(pendingPoints)
  }
  
  // Verify
  const finalCount = await getExistingCount()
  console.log(`\n=== Done ===`)
  console.log(`Total processed: ${processed}`)
  console.log(`Embedded: ${embedded}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Qdrant points: ${finalCount}`)
}

main().catch(console.error)
