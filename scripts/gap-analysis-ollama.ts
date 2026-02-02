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

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const EMBEDDING_MODEL = 'mxbai-embed-large'
const DELAY_MS = 50 // Small delay between requests
const SIMILARITY_THRESHOLD = 0.5
const BATCH_SIZE = 50
const MAX_CONVERSATIONS = 2000 // Sample for efficiency

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
  // Clean text - remove nulls, excessive whitespace, non-printable chars
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
        if (attempt < retries) {
          await sleep(500) // Wait before retry
          continue
        }
        // Only log on final failure
        return null
      }
      const data = await response.json()
      return data.embedding
    } catch (err) {
      if (attempt >= retries) return null
      await sleep(500)
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
  
  // Sample conversations for efficiency
  const rows = await db.all<ConversationRow>(`
    SELECT conversation_id, first_message, tags, inbox_id
    FROM conversations
    WHERE first_message IS NOT NULL 
      AND length(first_message) > 20
    ORDER BY random()
    LIMIT ${MAX_CONVERSATIONS}
  `)
  
  await db.close()
  return rows
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Gap Analysis with Ollama + Qdrant ===\n')
  
  // Ensure output directory
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  
  // Load conversations
  console.log('Loading conversations from DuckDB...')
  const conversations = await loadConversations()
  console.log(`Loaded ${conversations.length} conversations\n`)
  
  // Process in batches
  const gaps: GapRecord[] = []
  const matched: GapRecord[] = []
  let processed = 0
  
  for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
    const batch = conversations.slice(i, i + BATCH_SIZE)
    
    for (const conv of batch) {
      try {
        // Get embedding
        const embedding = await getOllamaEmbedding(conv.first_message)
        if (!embedding) {
          processed++
          continue
        }
        
        // Search skills
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
        
        processed++
      } catch (err) {
        console.error(`Error processing ${conv.conversation_id}:`, err)
      }
    }
    
    // Progress
    const pct = ((processed / conversations.length) * 100).toFixed(1)
    console.log(`Progress: ${processed}/${conversations.length} (${pct}%) - Gaps: ${gaps.length}`)
  }
  
  // Calculate stats
  const gapRate = ((gaps.length / processed) * 100).toFixed(1)
  const matchRate = ((matched.length / processed) * 100).toFixed(1)
  
  // Cluster gaps by similarity
  const skillCounts: Record<string, number> = {}
  for (const g of gaps) {
    skillCounts[g.best_skill] = (skillCounts[g.best_skill] || 0) + 1
  }
  const topGapSkills = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  
  // Generate report
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

${gapRate > '30' ? `
⚠️ **High gap rate (${gapRate}%)** - Consider:
1. Adding new skills for uncovered topics
2. Expanding skill descriptions to be more comprehensive
3. Adding more reference examples to existing skills
` : `
✅ **Gap rate is acceptable (${gapRate}%)** - Skills cover most conversations.
`}

## Next Steps

1. Review gap conversations to identify patterns
2. Create new skills for recurring uncovered topics
3. Expand thin skills with more examples
4. Re-run analysis after improvements
`

  await fs.writeFile(OUTPUT_REPORT, report)
  console.log(`\nReport written to ${OUTPUT_REPORT}`)
  
  // Write gaps JSON
  await fs.writeFile(OUTPUT_GAPS, JSON.stringify({ gaps, stats: { processed, gapRate, matchRate } }, null, 2))
  console.log(`Gaps written to ${OUTPUT_GAPS}`)
  
  console.log(`\n=== Results ===`)
  console.log(`Gap rate: ${gapRate}%`)
  console.log(`Match rate: ${matchRate}%`)
}

main().catch(console.error)
