#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DUCKDB_PATH = path.join(
  process.cwd(),
  'artifacts/phase-0/embeddings/v2/temp.duckdb'
)
const OUTPUT_DIR = path.join(process.cwd(), 'artifacts/gap-analysis')
const OUTPUT_REPORT = path.join(OUTPUT_DIR, 'report.md')
const OUTPUT_GAPS = path.join(OUTPUT_DIR, 'gaps.json')
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, 'checkpoint.json')

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const EMBEDDING_MODEL = 'mxbai-embed-large'
const DELAY_MS = 10
const SIMILARITY_THRESHOLD = 0.5
const BATCH_SIZE = 100 // Process 100, then checkpoint
const MAX_CONVERSATIONS = 2000 // Full sample - we can resume now

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationRow {
  conversation_id: string
  first_message: string
  tags: string
  inbox_id: string
}

interface GapRecord {
  conversation_id: string
  first_message: string
  best_skill: string
  similarity: number
  tags: string
}

interface Checkpoint {
  processedIds: string[]
  gaps: GapRecord[]
  matched: GapRecord[]
  lastProcessedIndex: number
}

interface QdrantSearchResult {
  result: Array<{
    id: number
    score: number
    payload: {
      name: string
      description: string
    }
  }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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

async function searchQdrantSkills(
  embedding: number[],
  limit = 1
): Promise<QdrantSearchResult> {
  const response = await fetch(`${QDRANT_URL}/collections/skills/points/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector: embedding,
      limit,
      with_payload: true,
    }),
  })
  if (!response.ok) {
    throw new Error(`Qdrant error: ${response.status}`)
  }
  return response.json()
}

async function loadConversations(): Promise<ConversationRow[]> {
  const { Database } = await import('duckdb-async')
  const db = await Database.create(DUCKDB_PATH, { access_mode: 'READ_ONLY' })
  
  const rows = await db.all<ConversationRow>(`
    SELECT conversation_id, first_message, tags, inbox_id
    FROM conversations
    WHERE first_message IS NOT NULL 
      AND length(first_message) > 20
    ORDER BY conversation_id
    LIMIT ${MAX_CONVERSATIONS}
  `)
  
  await db.close()
  return rows
}

async function loadCheckpoint(): Promise<Checkpoint | null> {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

async function saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
}

async function generateReport(gaps: GapRecord[], matched: GapRecord[], processed: number): Promise<void> {
  const gapRate = ((gaps.length / processed) * 100).toFixed(1)
  const matchRate = ((matched.length / processed) * 100).toFixed(1)
  
  // Cluster gaps by skill
  const skillCounts: Record<string, number> = {}
  for (const g of gaps) {
    skillCounts[g.best_skill] = (skillCounts[g.best_skill] || 0) + 1
  }
  const topGapSkills = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  
  const report = `# Gap Analysis Report

**Generated:** ${new Date().toISOString()}
**Embedding strategy:** Ollama mxbai-embed-large + Qdrant vector search
**Sample size:** ${processed} conversations
**Similarity threshold:** ${SIMILARITY_THRESHOLD}

## Summary

| Metric | Count | Percentage |
|--------|-------|------------|
| Matched (≥${SIMILARITY_THRESHOLD}) | ${matched.length} | ${matchRate}% |
| Gaps (<${SIMILARITY_THRESHOLD}) | ${gaps.length} | ${gapRate}% |
| Total processed | ${processed} | 100% |

## Gap Distribution by Best-Matching Skill

These skills are the *closest* match for gap conversations, but still below threshold:

| Skill | Gap Count |
|-------|-----------|
${topGapSkills.map(([skill, count]) => `| ${skill} | ${count} |`).join('\n')}

## Sample Gap Conversations

${gaps.slice(0, 10).map((g, i) => `
### Gap ${i + 1}: ${g.conversation_id}
- **Best skill:** ${g.best_skill} (similarity: ${g.similarity.toFixed(3)})
- **Tags:** ${g.tags || 'none'}
- **Message:** "${g.first_message}..."
`).join('\n')}

## Recommendations

${parseFloat(gapRate) > 30 ? `
⚠️ **High gap rate (${gapRate}%)** - Consider:
1. Adding new skills for uncovered topics
2. Expanding skill descriptions to be more comprehensive
3. Adding more reference examples to existing skills
` : `
✅ **Gap rate is acceptable (${gapRate}%)** - Skills cover most conversations.
`}
`

  await fs.writeFile(OUTPUT_REPORT, report)
  await fs.writeFile(OUTPUT_GAPS, JSON.stringify({ gaps, stats: { processed, gapRate, matchRate } }, null, 2))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Gap Analysis with Ollama + Qdrant (Resumable) ===\n')
  
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  
  // Load checkpoint if exists
  let checkpoint = await loadCheckpoint()
  const processedSet = new Set(checkpoint?.processedIds || [])
  const gaps: GapRecord[] = checkpoint?.gaps || []
  const matched: GapRecord[] = checkpoint?.matched || []
  let startIndex = checkpoint?.lastProcessedIndex || 0
  
  if (checkpoint) {
    console.log(`Resuming from checkpoint: ${processedSet.size} already processed\n`)
  }
  
  // Load conversations
  console.log('Loading conversations from DuckDB...')
  const conversations = await loadConversations()
  console.log(`Loaded ${conversations.length} conversations\n`)
  
  // Filter out already processed
  const remaining = conversations.filter(c => !processedSet.has(c.conversation_id))
  console.log(`Remaining to process: ${remaining.length}\n`)
  
  if (remaining.length === 0) {
    console.log('All conversations already processed!')
    await generateReport(gaps, matched, processedSet.size)
    console.log(`Report written to ${OUTPUT_REPORT}`)
    return
  }
  
  // Process in batches with checkpoints
  const startTime = Date.now()
  
  for (let i = 0; i < remaining.length; i++) {
    const conv = remaining[i]
    
    try {
      const embedding = await getOllamaEmbedding(conv.first_message)
      if (!embedding) {
        processedSet.add(conv.conversation_id)
        continue
      }
      
      const result = await searchQdrantSkills(embedding)
      const bestMatch = result.result[0]
      
      const record: GapRecord = {
        conversation_id: conv.conversation_id,
        first_message: conv.first_message.slice(0, 200),
        best_skill: bestMatch?.payload?.name || 'unknown',
        similarity: bestMatch?.score || 0,
        tags: conv.tags || '',
      }
      
      if (record.similarity < SIMILARITY_THRESHOLD) {
        gaps.push(record)
      } else {
        matched.push(record)
      }
      
      processedSet.add(conv.conversation_id)
    } catch (err) {
      console.error(`Error processing ${conv.conversation_id}:`, err)
    }
    
    // Checkpoint every BATCH_SIZE
    if ((i + 1) % BATCH_SIZE === 0) {
      await saveCheckpoint({
        processedIds: Array.from(processedSet),
        gaps,
        matched,
        lastProcessedIndex: startIndex + i + 1,
      })
      
      const pct = ((processedSet.size / conversations.length) * 100).toFixed(1)
      console.log(`Checkpoint: ${processedSet.size}/${conversations.length} (${pct}%) - Gaps: ${gaps.length}`)
    }
  }
  
  // Final checkpoint
  await saveCheckpoint({
    processedIds: Array.from(processedSet),
    gaps,
    matched,
    lastProcessedIndex: conversations.length,
  })
  
  // Generate report
  await generateReport(gaps, matched, processedSet.size)
  
  const elapsed = (Date.now() - startTime) / 1000
  console.log(`\n=== Done in ${elapsed.toFixed(1)}s ===`)
  console.log(`Gap rate: ${((gaps.length / processedSet.size) * 100).toFixed(1)}%`)
  console.log(`Report: ${OUTPUT_REPORT}`)
}

main().catch(console.error)
