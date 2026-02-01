#!/usr/bin/env bun
/**
 * Extract FULL training dataset from DuckDB cache
 * NO artificial limits - pull all high-confidence conversations
 * 
 * For agent training/fine-tuning, not FAQ generation
 */

import fs from 'node:fs'
import path from 'node:path'
import { createDuckDBSource } from '../packages/core/src/faq/duckdb-source'

const CLASSIFICATIONS_PATH = path.join(
  process.cwd(),
  'artifacts/phase-1/llm-topics/classifications.json'
)
const TAXONOMY_PATH = path.join(
  process.cwd(),
  'artifacts/phase-1/llm-topics/taxonomy.json'
)
const OUTPUT_PATH = path.join(
  process.cwd(),
  'artifacts/training-data/full-threads.jsonl'
)
const STATS_PATH = path.join(
  process.cwd(),
  'artifacts/training-data/extraction-stats.json'
)
const DB_PATH = path.join(process.env.HOME || '~', 'skill/data/front-cache.db')

// Config
const MIN_CONFIDENCE = 0.7
const MIN_QUESTION_LENGTH = 20
const MIN_ANSWER_LENGTH = 20
const INCLUDE_OTHER = true // Include "other" category for edge cases
const BATCH_SIZE = 50 // Process in batches to avoid memory issues
const PROGRESS_INTERVAL = 100

interface Classification {
  conversationId: string
  topicId: string
  confidence: number
}

interface Topic {
  id: string
  name: string
}

interface Message {
  id: string
  text?: string
  body?: string
  is_inbound: boolean
  created_at: number
  author?: { email?: string }
}

interface ThreadEntry {
  topicId: string
  topicName: string
  conversationId: string
  question: string
  answer: string
  fullThread: Array<{
    role: 'customer' | 'agent'
    content: string
    timestamp: number
  }>
  threadLength: number
  confidence: number
  extractedAt: string
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  console.log('🚀 Starting full training data extraction')
  console.log(`Config: minConfidence=${MIN_CONFIDENCE}, includeOther=${INCLUDE_OTHER}`)
  
  // Load classifications
  const allClassifications: Classification[] = JSON.parse(
    fs.readFileSync(CLASSIFICATIONS_PATH, 'utf-8')
  )
  
  // Filter by confidence
  const classifications = allClassifications.filter(c => {
    if (c.confidence < MIN_CONFIDENCE) return false
    if (!INCLUDE_OTHER && c.topicId === 'other') return false
    return true
  })
  
  console.log(`📊 ${classifications.length} conversations meet criteria (of ${allClassifications.length} total)`)
  
  // Load taxonomy
  const taxonomy: { topics: Topic[] } = JSON.parse(
    fs.readFileSync(TAXONOMY_PATH, 'utf-8')
  )
  const topicMap = new Map(taxonomy.topics.map(t => [t.id, t.name]))
  topicMap.set('other', 'Other / Edge Cases')
  
  // Create DuckDB source
  const source = await createDuckDBSource({
    dbPath: DB_PATH,
    statusFilter: ['archived'],
  })
  
  // Prepare output
  const outputDir = path.dirname(OUTPUT_PATH)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  const output = fs.createWriteStream(OUTPUT_PATH)
  
  // Stats tracking
  const stats = {
    total: classifications.length,
    extracted: 0,
    skipped: {
      noMessages: 0,
      noQuestion: 0,
      noAnswer: 0,
      tooShort: 0,
      error: 0,
    },
    byTopic: new Map<string, number>(),
    startedAt: new Date().toISOString(),
  }
  
  // Process all conversations
  let processed = 0
  
  for (const c of classifications) {
    try {
      const messages = await source.getMessages(c.conversationId)
      
      if (messages.length === 0) {
        stats.skipped.noMessages++
        processed++
        continue
      }
      
      // Sort by timestamp
      const sorted = [...messages].sort((a, b) => a.created_at - b.created_at)
      
      // Build full thread
      const fullThread: ThreadEntry['fullThread'] = []
      for (const m of sorted) {
        const content = m.text || (m.body ? stripHtml(m.body) : '')
        if (!content) continue
        
        fullThread.push({
          role: m.is_inbound ? 'customer' : 'agent',
          content,
          timestamp: m.created_at,
        })
      }
      
      // Extract first customer message (question) and last agent message (answer)
      const customerMessages = fullThread.filter(m => m.role === 'customer')
      const agentMessages = fullThread.filter(m => m.role === 'agent')
      
      if (customerMessages.length === 0) {
        stats.skipped.noQuestion++
        processed++
        continue
      }
      
      if (agentMessages.length === 0) {
        stats.skipped.noAnswer++
        processed++
        continue
      }
      
      const question = customerMessages[0].content
      const answer = agentMessages[agentMessages.length - 1].content
      
      if (question.length < MIN_QUESTION_LENGTH || answer.length < MIN_ANSWER_LENGTH) {
        stats.skipped.tooShort++
        processed++
        continue
      }
      
      // Write entry
      const entry: ThreadEntry = {
        topicId: c.topicId,
        topicName: topicMap.get(c.topicId) || c.topicId,
        conversationId: c.conversationId,
        question,
        answer,
        fullThread,
        threadLength: fullThread.length,
        confidence: c.confidence,
        extractedAt: new Date().toISOString(),
      }
      
      output.write(JSON.stringify(entry) + '\n')
      stats.extracted++
      
      // Track by topic
      const topicCount = stats.byTopic.get(c.topicId) || 0
      stats.byTopic.set(c.topicId, topicCount + 1)
      
    } catch (err) {
      stats.skipped.error++
    }
    
    processed++
    
    if (processed % PROGRESS_INTERVAL === 0) {
      const pct = ((processed / classifications.length) * 100).toFixed(1)
      console.log(`Progress: ${processed}/${classifications.length} (${pct}%) - ${stats.extracted} extracted`)
    }
  }
  
  output.end()
  
  // Write stats
  const finalStats = {
    ...stats,
    byTopic: Object.fromEntries(stats.byTopic),
    completedAt: new Date().toISOString(),
  }
  fs.writeFileSync(STATS_PATH, JSON.stringify(finalStats, null, 2))
  
  console.log('\n✅ Extraction complete!')
  console.log(`📁 Output: ${OUTPUT_PATH}`)
  console.log(`📊 Extracted: ${stats.extracted} threads`)
  console.log(`⏭️  Skipped: ${Object.values(stats.skipped).reduce((a, b) => a + b, 0)}`)
  console.log(`   - No messages: ${stats.skipped.noMessages}`)
  console.log(`   - No question: ${stats.skipped.noQuestion}`)
  console.log(`   - No answer: ${stats.skipped.noAnswer}`)
  console.log(`   - Too short: ${stats.skipped.tooShort}`)
  console.log(`   - Errors: ${stats.skipped.error}`)
}

main().catch(err => {
  console.error('❌ Extraction failed:', err)
  process.exit(1)
})
