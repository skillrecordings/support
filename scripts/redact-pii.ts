#!/usr/bin/env bun
/**
 * Redact PII from training data:
 * - Email addresses → [EMAIL]
 * - Preserve structure, just mask the sensitive data
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const INPUT_PATH = path.join(
  process.cwd(),
  'artifacts/training-data/clean-threads.jsonl'
)
const OUTPUT_PATH = path.join(
  process.cwd(),
  'artifacts/training-data/redacted-threads.jsonl'
)

// Email regex
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

// Known safe emails to keep (company/product emails)
const SAFE_EMAILS = new Set([
  '[EMAIL]',
  '[EMAIL]', 
  '[EMAIL]',
  '[EMAIL]',
  '[EMAIL]',
  '[EMAIL]',
])

function redactEmails(text: string): string {
  return text.replace(EMAIL_REGEX, (match) => {
    if (SAFE_EMAILS.has(match.toLowerCase())) {
      return match
    }
    return '[EMAIL]'
  })
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
  console.log('🔒 Redacting PII from training data...')
  
  const input = fs.createReadStream(INPUT_PATH)
  const rl = readline.createInterface({ input })
  const output = fs.createWriteStream(OUTPUT_PATH)
  
  let total = 0
  let emailsRedacted = 0
  
  for await (const line of rl) {
    total++
    
    const entry: ThreadEntry = JSON.parse(line)
    
    // Count emails before redaction
    const beforeQ = (entry.question.match(EMAIL_REGEX) || []).length
    const beforeA = (entry.answer.match(EMAIL_REGEX) || []).length
    const beforeThread = entry.fullThread.reduce((acc, m) => 
      acc + (m.content.match(EMAIL_REGEX) || []).length, 0)
    
    // Redact
    const redacted: ThreadEntry = {
      ...entry,
      question: redactEmails(entry.question),
      answer: redactEmails(entry.answer),
      fullThread: entry.fullThread.map(m => ({
        ...m,
        content: redactEmails(m.content)
      }))
    }
    
    // Count after
    const afterQ = (redacted.question.match(EMAIL_REGEX) || []).length
    const afterA = (redacted.answer.match(EMAIL_REGEX) || []).length
    const afterThread = redacted.fullThread.reduce((acc, m) => 
      acc + (m.content.match(EMAIL_REGEX) || []).length, 0)
    
    emailsRedacted += (beforeQ - afterQ) + (beforeA - afterA) + (beforeThread - afterThread)
    
    output.write(JSON.stringify(redacted) + '\n')
    
    if (total % 2000 === 0) {
      console.log(`Progress: ${total} processed, ${emailsRedacted} emails redacted`)
    }
  }
  
  output.end()
  
  console.log('\n✅ Redaction complete!')
  console.log(`📁 Output: ${OUTPUT_PATH}`)
  console.log(`📊 Total threads: ${total}`)
  console.log(`🔒 Emails redacted: ${emailsRedacted}`)
}

main().catch(err => {
  console.error('❌ Failed:', err)
  process.exit(1)
})
