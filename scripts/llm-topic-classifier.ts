#!/usr/bin/env bun
/**
 * LLM-based Topic Classification for FAQ Extraction
 * 
 * Uses Kimi K2.5 via Vercel AI Gateway to:
 * 1. Generate topic taxonomy from sample conversations
 * 2. Classify all conversations into topics
 * 3. Extract best Q&A pairs per topic
 * 
 * Usage:
 *   bun scripts/llm-topic-classifier.ts --phase=generate-taxonomy
 *   bun scripts/llm-topic-classifier.ts --phase=classify
 *   bun scripts/llm-topic-classifier.ts --phase=extract
 *   bun scripts/llm-topic-classifier.ts --all
 */

import * as fs from 'fs'
import * as path from 'path'
import * as ddb from 'duckdb'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'

// Load env from packages/cli
const projectRoot = path.resolve(import.meta.dir, '..')
const cliEnvPath = path.resolve(projectRoot, 'packages/cli')
try {
  const dotenvFlow = await import('dotenv-flow')
  dotenvFlow.config({ path: cliEnvPath, silent: true })
} catch {
  // dotenv-flow not available
}

// ============================================================================
// Configuration
// ============================================================================

const MODEL = 'anthropic/claude-haiku-4-5'

const DB_PATH = path.join(process.env.HOME || '~', 'skill/data/front-cache.db')
const OUTPUT_DIR = path.join(projectRoot, 'artifacts/phase-1/llm-topics')
const SAMPLE_SIZE = 200
const BATCH_SIZE = 20 // Conversations per LLM call for classification
const TARGET_TOPICS = 40

// Validate env
if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('❌ AI_GATEWAY_API_KEY not set. Run: source packages/cli/.env.local')
  process.exit(1)
}

// ============================================================================
// Types
// ============================================================================

interface Topic {
  id: string
  name: string
  description: string
  examples: string[]
}

interface Taxonomy {
  version: string
  generatedAt: string
  model: string
  topics: Topic[]
}

interface ClassifiedConversation {
  conversationId: string
  topicId: string
  confidence: number
  firstMessage: string
}

interface FAQCandidate {
  topicId: string
  topicName: string
  question: string
  answer: string
  conversationId: string
  confidence: number
}

// ============================================================================
// DuckDB Helpers
// ============================================================================

function execQuery<T>(db: ddb.Database, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err: Error | null, rows: T[]) => {
      if (err) reject(err)
      else resolve(rows || [])
    })
  })
}

async function getSampleConversations(db: ddb.Database, limit: number): Promise<{ conversation_id: string; first_message: string }[]> {
  // Get diverse sample - first inbound message per conversation, stratified by inbox
  const sql = `
    WITH first_messages AS (
      SELECT 
        m.conversation_id,
        m.body_text as first_message,
        c.inbox_id,
        ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at ASC) as msg_rn
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.status = 'archived'
        AND m.is_inbound = true
        AND m.body_text IS NOT NULL 
        AND LENGTH(m.body_text) > 50
        AND LENGTH(m.body_text) < 2000
    ),
    ranked AS (
      SELECT 
        conversation_id,
        first_message,
        inbox_id,
        ROW_NUMBER() OVER (PARTITION BY inbox_id ORDER BY RANDOM()) as rn
      FROM first_messages
      WHERE msg_rn = 1
    )
    SELECT conversation_id, first_message
    FROM ranked
    WHERE rn <= ${Math.ceil(limit / 10)}
    ORDER BY RANDOM()
    LIMIT ${limit}
  `
  return execQuery(db, sql)
}

async function getAllConversations(db: ddb.Database): Promise<{ conversation_id: string; first_message: string }[]> {
  const sql = `
    WITH first_messages AS (
      SELECT 
        m.conversation_id,
        m.body_text as first_message,
        c.created_at,
        ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at ASC) as msg_rn
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.status = 'archived'
        AND m.is_inbound = true
        AND m.body_text IS NOT NULL 
        AND LENGTH(m.body_text) > 20
    )
    SELECT conversation_id, first_message
    FROM first_messages
    WHERE msg_rn = 1
    ORDER BY created_at DESC
  `
  return execQuery(db, sql)
}

async function getConversationWithResponse(db: ddb.Database, conversationId: string): Promise<{ first_message: string; response: string } | null> {
  const sql = `
    WITH first_inbound AS (
      SELECT body_text as first_message
      FROM messages 
      WHERE conversation_id = '${conversationId}'
        AND is_inbound = true
      ORDER BY created_at ASC
      LIMIT 1
    ),
    first_outbound AS (
      SELECT body_text as response
      FROM messages 
      WHERE conversation_id = '${conversationId}'
        AND is_inbound = false
      ORDER BY created_at ASC
      LIMIT 1
    )
    SELECT 
      (SELECT first_message FROM first_inbound) as first_message,
      (SELECT response FROM first_outbound) as response
  `
  const rows = await execQuery<{ first_message: string; response: string }>(db, sql)
  return rows[0] || null
}

// ============================================================================
// Phase 1: Generate Taxonomy
// ============================================================================

const taxonomySchema = z.object({
  topics: z.array(z.object({
    id: z.string().describe('Short snake_case identifier'),
    name: z.string().describe('Human-readable topic name'),
    description: z.string().describe('1-2 sentence description'),
    examples: z.array(z.string()).describe('2-3 example phrases'),
  }))
})

async function generateTaxonomy(db: ddb.Database): Promise<Taxonomy> {
  console.log('📊 Phase 1: Generating Topic Taxonomy')
  console.log('=' .repeat(60))
  
  // Get sample conversations
  console.log(`\n📥 Sampling ${SAMPLE_SIZE} diverse conversations...`)
  const samples = await getSampleConversations(db, SAMPLE_SIZE)
  console.log(`   Got ${samples.length} samples`)

  // Format samples for LLM
  const sampleText = samples
    .map((s, i) => `[${i + 1}] ${s.first_message.slice(0, 500)}`)
    .join('\n\n---\n\n')

  console.log('\n🤖 Calling LLM to generate taxonomy...')
  
  const { object } = await generateObject({
    model: MODEL,
    schema: taxonomySchema,
    system: `You are an expert at analyzing customer support conversations and creating taxonomies.
Analyze the sample support messages and create a comprehensive topic taxonomy with ${TARGET_TOPICS} distinct topics.

Focus on:
- Actionable support categories (refunds, access issues, billing)
- Product-specific topics (course access, downloads, certificates)
- Common inquiries (pricing, discounts, team licenses)
- Technical issues (video player, login, email delivery)`,
    prompt: `Analyze these ${samples.length} customer support messages and create a taxonomy of ${TARGET_TOPICS} distinct topics.

Sample messages:

${sampleText}`,
  })

  const taxonomy: Taxonomy = {
    version: 'v1',
    generatedAt: new Date().toISOString(),
    model: MODEL,
    topics: object.topics,
  }

  console.log(`\n✅ Generated ${taxonomy.topics.length} topics`)
  
  // Save taxonomy
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'taxonomy.json'),
    JSON.stringify(taxonomy, null, 2)
  )
  console.log(`   Saved to ${OUTPUT_DIR}/taxonomy.json`)

  // Print topics
  console.log('\n📋 Topics:')
  taxonomy.topics.forEach((t, i) => {
    console.log(`   ${i + 1}. ${t.name} (${t.id})`)
  })

  return taxonomy
}

// ============================================================================
// Phase 2: Classify Conversations
// ============================================================================

async function classifyConversations(db: ddb.Database): Promise<ClassifiedConversation[]> {
  console.log('\n📊 Phase 2: Classifying Conversations')
  console.log('='.repeat(60))

  // Load taxonomy
  const taxonomyPath = path.join(OUTPUT_DIR, 'taxonomy.json')
  if (!fs.existsSync(taxonomyPath)) {
    throw new Error('Taxonomy not found. Run --phase=generate-taxonomy first.')
  }
  const taxonomy: Taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf-8'))
  console.log(`   Loaded taxonomy with ${taxonomy.topics.length} topics`)

  // Get all conversations
  console.log('\n📥 Loading conversations...')
  const conversations = await getAllConversations(db)
  console.log(`   Found ${conversations.length} conversations to classify`)

  // Build topic list for classification
  const topicList = taxonomy.topics
    .map(t => `- ${t.id}: ${t.name} - ${t.description}`)
    .join('\n')

  // Classification schema (must be object at root for tool calling)
  const classifySchema = z.object({
    classifications: z.array(z.object({
      index: z.number(),
      topic_id: z.string(),
      confidence: z.number().min(0).max(1),
    }))
  })

  // Process in batches
  const results: ClassifiedConversation[] = []
  const totalBatches = Math.ceil(conversations.length / BATCH_SIZE)

  for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
    const batch = conversations.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    
    process.stdout.write(`\r   Processing batch ${batchNum}/${totalBatches} (${results.length}/${conversations.length} done)`)

    const messagesText = batch
      .map((c, idx) => `[${idx}] ${c.first_message.slice(0, 300)}`)
      .join('\n\n')

    try {
      const { object } = await generateObject({
        model: MODEL,
        schema: classifySchema,
        system: `You are a customer support message classifier.
Classify each message into exactly one topic from the provided list.
If a message doesn't clearly fit any topic, use "other".`,
        prompt: `Available topics:
${topicList}

Classify each message by index:

${messagesText}`,
      })
      
      for (const c of object.classifications) {
        if (c.index >= 0 && c.index < batch.length) {
          results.push({
            conversationId: batch[c.index].conversation_id,
            topicId: c.topic_id,
            confidence: c.confidence,
            firstMessage: batch[c.index].first_message,
          })
        }
      }
    } catch (e) {
      console.warn(`\n   ⚠️ Batch ${batchNum} failed: ${e}`)
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 100))
  }

  console.log(`\n\n✅ Classified ${results.length} conversations`)

  // Save results
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'classifications.json'),
    JSON.stringify(results, null, 2)
  )
  console.log(`   Saved to ${OUTPUT_DIR}/classifications.json`)

  // Print stats
  const topicCounts = new Map<string, number>()
  for (const r of results) {
    topicCounts.set(r.topicId, (topicCounts.get(r.topicId) || 0) + 1)
  }
  
  console.log('\n📊 Topic Distribution:')
  const sorted = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])
  sorted.slice(0, 15).forEach(([topic, count]) => {
    console.log(`   ${topic}: ${count} (${(count / results.length * 100).toFixed(1)}%)`)
  })

  return results
}

// ============================================================================
// Phase 3: Extract FAQ Candidates
// ============================================================================

async function extractFAQs(db: ddb.Database): Promise<FAQCandidate[]> {
  console.log('\n📊 Phase 3: Extracting FAQ Candidates')
  console.log('='.repeat(60))

  // Load taxonomy and classifications
  const taxonomy: Taxonomy = JSON.parse(
    fs.readFileSync(path.join(OUTPUT_DIR, 'taxonomy.json'), 'utf-8')
  )
  const classifications: ClassifiedConversation[] = JSON.parse(
    fs.readFileSync(path.join(OUTPUT_DIR, 'classifications.json'), 'utf-8')
  )

  console.log(`   ${taxonomy.topics.length} topics, ${classifications.length} classified conversations`)

  // Group by topic
  const byTopic = new Map<string, ClassifiedConversation[]>()
  for (const c of classifications) {
    const list = byTopic.get(c.topicId) || []
    list.push(c)
    byTopic.set(c.topicId, list)
  }

  const candidates: FAQCandidate[] = []

  // For each topic, get top conversations and extract Q&A
  for (const topic of taxonomy.topics) {
    const topicConvs = byTopic.get(topic.id) || []
    if (topicConvs.length < 3) continue

    // Get top 5 by confidence
    const top = topicConvs
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)

    for (const conv of top) {
      // Get the response
      const data = await getConversationWithResponse(db, conv.conversationId)
      if (!data || !data.response) continue

      candidates.push({
        topicId: topic.id,
        topicName: topic.name,
        question: data.first_message.slice(0, 500),
        answer: data.response.slice(0, 1000),
        conversationId: conv.conversationId,
        confidence: conv.confidence,
      })
    }
  }

  console.log(`\n✅ Extracted ${candidates.length} FAQ candidates`)

  // Save
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'faq-candidates.json'),
    JSON.stringify(candidates, null, 2)
  )
  console.log(`   Saved to ${OUTPUT_DIR}/faq-candidates.json`)

  // Stats
  const highConf = candidates.filter(c => c.confidence >= 0.8)
  console.log(`\n📊 Confidence Distribution:`)
  console.log(`   High (≥0.8): ${highConf.length}`)
  console.log(`   Medium (0.6-0.8): ${candidates.filter(c => c.confidence >= 0.6 && c.confidence < 0.8).length}`)
  console.log(`   Low (<0.6): ${candidates.filter(c => c.confidence < 0.6).length}`)

  // Print top candidates
  console.log('\n🏆 Top 10 FAQ Candidates:')
  candidates
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .forEach((c, i) => {
      console.log(`\n${i + 1}. [${(c.confidence * 100).toFixed(0)}%] ${c.topicName}`)
      console.log(`   Q: ${c.question.slice(0, 100)}...`)
      console.log(`   A: ${c.answer.slice(0, 100)}...`)
    })

  return candidates
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const phaseArg = args.find(a => a.startsWith('--phase='))
  const phase = phaseArg?.split('=')[1] || (args.includes('--all') ? 'all' : null)

  if (!phase) {
    console.log('Usage:')
    console.log('  bun scripts/llm-topic-classifier.ts --phase=generate-taxonomy')
    console.log('  bun scripts/llm-topic-classifier.ts --phase=classify')
    console.log('  bun scripts/llm-topic-classifier.ts --phase=extract')
    console.log('  bun scripts/llm-topic-classifier.ts --all')
    process.exit(1)
  }

  console.log('🚀 LLM Topic Classifier')
  console.log('='.repeat(60))
  console.log(`   Model: ${MODEL}`)
  console.log(`   Database: ${DB_PATH}`)
  console.log(`   Output: ${OUTPUT_DIR}`)

  const db = new ddb.Database(DB_PATH, { access_mode: 'READ_ONLY' })

  try {
    if (phase === 'generate-taxonomy' || phase === 'all') {
      await generateTaxonomy(db)
    }
    
    if (phase === 'classify' || phase === 'all') {
      await classifyConversations(db)
    }
    
    if (phase === 'extract' || phase === 'all') {
      await extractFAQs(db)
    }

    console.log('\n✅ Done!')
  } finally {
    db.close()
  }
}

main().catch(console.error)
