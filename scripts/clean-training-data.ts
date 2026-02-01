#!/usr/bin/env bun
/**
 * Clean training data:
 * 1. Strip auto-reply boilerplate from threads
 * 2. Re-derive "answer" from last REAL agent message
 * 3. Filter out entries where only agent response was auto-reply
 * 4. Optionally filter out "other" category (spam/noise)
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const INPUT_PATH = path.join(
  process.cwd(),
  'artifacts/training-data/full-threads.jsonl'
)
const OUTPUT_PATH = path.join(
  process.cwd(),
  'artifacts/training-data/clean-threads.jsonl'
)
const STATS_PATH = path.join(
  process.cwd(),
  'artifacts/training-data/clean-stats.json'
)

// Auto-reply patterns to strip
const AUTO_REPLY_PATTERNS = [
  /We work normal business hours/i,
  /We work standard business hours/i,
  /This is an automated reply/i,
  /automated reply to let you know/i,
]

// Filter out "other" category (spam, noise)
const FILTER_OTHER = true
const MIN_ANSWER_LENGTH = 30

function isAutoReply(content: string): boolean {
  return AUTO_REPLY_PATTERNS.some(pattern => pattern.test(content))
}

interface ThreadMessage {
  role: 'customer' | 'agent'
  content: string
  timestamp: number
}

interface ThreadEntry {
  topicId: string
  topicName: string
  conversationId: string
  question: string
  answer: string
  fullThread: ThreadMessage[]
  threadLength: number
  confidence: number
  extractedAt: string
}

async function main() {
  console.log('🧹 Cleaning training data...')
  
  const input = fs.createReadStream(INPUT_PATH)
  const rl = readline.createInterface({ input })
  const output = fs.createWriteStream(OUTPUT_PATH)
  
  const stats = {
    total: 0,
    kept: 0,
    filtered: {
      otherCategory: 0,
      onlyAutoReply: 0,
      noRealAnswer: 0,
      tooShort: 0,
    },
    autoRepliesStripped: 0,
  }
  
  for await (const line of rl) {
    stats.total++
    
    const entry: ThreadEntry = JSON.parse(line)
    
    // Filter out "other" category
    if (FILTER_OTHER && entry.topicId === 'other') {
      stats.filtered.otherCategory++
      continue
    }
    
    // Strip auto-replies from thread
    const cleanThread: ThreadMessage[] = []
    let strippedCount = 0
    
    for (const msg of entry.fullThread) {
      if (msg.role === 'agent' && isAutoReply(msg.content)) {
        strippedCount++
        continue
      }
      cleanThread.push(msg)
    }
    
    stats.autoRepliesStripped += strippedCount
    
    // Find last real agent message
    const agentMessages = cleanThread.filter(m => m.role === 'agent')
    
    if (agentMessages.length === 0) {
      stats.filtered.noRealAnswer++
      continue
    }
    
    const lastRealAnswer = agentMessages[agentMessages.length - 1].content
    
    if (lastRealAnswer.length < MIN_ANSWER_LENGTH) {
      stats.filtered.tooShort++
      continue
    }
    
    // Update entry with clean data
    const cleanEntry: ThreadEntry = {
      ...entry,
      answer: lastRealAnswer,
      fullThread: cleanThread,
      threadLength: cleanThread.length,
    }
    
    output.write(JSON.stringify(cleanEntry) + '\n')
    stats.kept++
    
    if (stats.total % 1000 === 0) {
      console.log(`Progress: ${stats.total} processed, ${stats.kept} kept`)
    }
  }
  
  output.end()
  
  // Write stats
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2))
  
  console.log('\n✅ Cleaning complete!')
  console.log(`📁 Output: ${OUTPUT_PATH}`)
  console.log(`📊 Results:`)
  console.log(`   Total: ${stats.total}`)
  console.log(`   Kept: ${stats.kept} (${((stats.kept / stats.total) * 100).toFixed(1)}%)`)
  console.log(`   Filtered:`)
  console.log(`     - "Other" category: ${stats.filtered.otherCategory}`)
  console.log(`     - Only auto-reply: ${stats.filtered.onlyAutoReply}`)
  console.log(`     - No real answer: ${stats.filtered.noRealAnswer}`)
  console.log(`     - Too short: ${stats.filtered.tooShort}`)
  console.log(`   Auto-replies stripped: ${stats.autoRepliesStripped}`)
}

main().catch(err => {
  console.error('❌ Failed:', err)
  process.exit(1)
})
