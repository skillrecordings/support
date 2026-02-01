#!/usr/bin/env bun
/**
 * Extract REAL FAQ Q&A pairs from DuckDB cache
 * Uses the working createDuckDBSource from faq module
 * 
 * NO LLM SYNTHESIS - verbatim extraction only
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
  'artifacts/phase-1/real-faq-candidates.jsonl'
)
const AUDIT_PATH = path.join(
  process.cwd(),
  'artifacts/faq-extraction-audit.md'
)
const DB_PATH = path.join(process.env.HOME || '~', 'skill/data/front-cache.db')

interface Classification {
  conversationId: string
  topicId: string
  confidence: number
}

interface Topic {
  id: string
  name: string
}

function logAudit(step: string, action: string, output: string) {
  const timestamp = new Date().toISOString()
  const entry = `## [${timestamp}] ${step}\n**Action:** ${action}\n**Output:** ${output}\n\n`
  
  if (!fs.existsSync(path.dirname(AUDIT_PATH))) {
    fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true })
  }
  
  if (!fs.existsSync(AUDIT_PATH)) {
    fs.writeFileSync(AUDIT_PATH, '# FAQ Extraction Audit Log\n\n')
  }
  
  fs.appendFileSync(AUDIT_PATH, entry)
  console.log(`[${step}] ${action}`)
}

async function main() {
  logAudit('Start', 'Beginning real FAQ extraction', 'Using createDuckDBSource from faq module')
  
  // Load classifications
  const classifications: Classification[] = JSON.parse(
    fs.readFileSync(CLASSIFICATIONS_PATH, 'utf-8')
  )
  
  // Load taxonomy
  const taxonomy: { topics: Topic[] } = JSON.parse(
    fs.readFileSync(TAXONOMY_PATH, 'utf-8')
  )
  
  // Group by topic
  const byTopic = new Map<string, Classification[]>()
  for (const c of classifications) {
    const list = byTopic.get(c.topicId) || []
    list.push(c)
    byTopic.set(c.topicId, list)
  }
  
  logAudit('Load', 'Loaded classifications', `${classifications.length} conversations, ${taxonomy.topics.length} topics`)
  
  // Create DuckDB source (uses working @duckdb/node-api)
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
  
  let totalExtracted = 0
  let topicsProcessed = 0
  const skippedTopics: string[] = []
  
  // Process each topic
  for (const topic of taxonomy.topics) {
    const topicClassifications = byTopic.get(topic.id) || []
    
    if (topicClassifications.length < 3) {
      skippedTopics.push(topic.id)
      continue
    }
    
    // Get top 10 by confidence
    const top = topicClassifications
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10)
    
    let topicExtracted = 0
    
    for (const c of top) {
      try {
        // Get messages using the working source
        const messages = await source.getMessages(c.conversationId)
        
        if (messages.length === 0) continue
        
        // Extract first inbound (question) and last outbound (answer)
        const sorted = [...messages].sort((a, b) => a.created_at - b.created_at)
        const firstInbound = sorted.find(m => m.is_inbound)
        const outbound = sorted.filter(m => !m.is_inbound)
        const lastOutbound = outbound[outbound.length - 1]
        
        if (!firstInbound || !lastOutbound) continue
        
        const question = firstInbound.text || firstInbound.body?.replace(/<[^>]*>/g, ' ').trim() || ''
        const answer = lastOutbound.text || lastOutbound.body?.replace(/<[^>]*>/g, ' ').trim() || ''
        
        if (!question || !answer) continue
        if (question.length < 20 || answer.length < 20) continue
        
        // Write to output
        const entry = {
          topicId: topic.id,
          topicName: topic.name,
          conversationId: c.conversationId,
          question,
          answer,
          threadLength: messages.length,
          confidence: c.confidence,
          extractedAt: new Date().toISOString(),
        }
        
        output.write(JSON.stringify(entry) + '\n')
        topicExtracted++
        totalExtracted++
      } catch (err) {
        // Skip failed conversations
      }
    }
    
    topicsProcessed++
    
    if (topicExtracted === 0) {
      skippedTopics.push(topic.id)
    }
    
    if (topicsProcessed % 10 === 0) {
      console.log(`Progress: ${topicsProcessed}/${taxonomy.topics.length} topics, ${totalExtracted} extracted`)
    }
  }
  
  output.end()
  
  logAudit(
    'Complete',
    'Extraction finished',
    `Topics: ${topicsProcessed}, Extracted: ${totalExtracted}, Skipped: ${skippedTopics.length}`
  )
  
  console.log(`\n✅ Done! ${totalExtracted} Q&A pairs written to ${OUTPUT_PATH}`)
  console.log(`Skipped topics (< 3 convos or no valid Q&A): ${skippedTopics.length}`)
}

main().catch(err => {
  logAudit('Error', 'Extraction failed', err.message)
  console.error(err)
  process.exit(1)
})
