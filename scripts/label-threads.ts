#!/usr/bin/env bun
/**
 * Interactive Thread Labeling Tool
 * 
 * Goes through unlabeled conversations for human labeling.
 * Outputs to fixtures/datasets/labeled-threads.json
 */

import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

// Categories
const CATEGORIES = [
  'support_access',      // Can't access purchased content
  'support_refund',      // Wants money back
  'support_transfer',    // Move to different email
  'support_technical',   // Questions about content/code
  'support_billing',     // Invoice, receipt, tax
  'fan_mail',            // Appreciation, survey responses
  'spam',                // Vendor outreach, marketing
  'system',              // Automated, bounces
  'instructor_strategy', // Internal discussion
  'resolved',            // Already resolved
  'awaiting_customer',   // Waiting for reply
  'skip',                // Skip this one
] as const

type Category = typeof CATEGORIES[number]

interface RawConversation {
  id: string
  conversationId?: string
  app?: string
  triggerMessage: {
    subject: string
    body: string
    direction: string
  }
  conversationHistory: Array<{
    body: string
    direction: string
    timestamp?: string
  }>
}

interface LabeledThread {
  id: string
  conversationId: string
  app: string
  notes: string
  input: {
    conversationId: string
    appId: string
    messages: Array<{
      direction: string
      body: string
      timestamp?: string
    }>
    triggerMessage: {
      body: string
      direction: string
    }
  }
  expected: {
    category: string
    action: string
  }
  tags: string[]
}

// PII scrubbing
function scrubPII(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b(Milan|Stojke|Jason|John|Thomas|Leonard|Urban|Kevin|Arvind|Denis|Christian|Fiona|Martin|Aminata|Andrew|Dan|Thorr|Zan|Francis|Customer)\b/gi, 'Customer')
}

// Determine action from category
function getAction(cat: Category): string {
  switch (cat) {
    case 'support_access':
    case 'support_refund':
    case 'support_transfer':
    case 'support_technical':
    case 'support_billing':
      return 'respond'
    case 'fan_mail':
      return 'escalate_instructor'
    case 'spam':
    case 'system':
    case 'instructor_strategy':
    case 'resolved':
    case 'awaiting_customer':
      return 'silence'
    default:
      return 'respond'
  }
}

async function main() {
  // Load existing labels
  const labeledPath = 'fixtures/datasets/labeled-threads.json'
  let labeled: LabeledThread[] = []
  if (existsSync(labeledPath)) {
    labeled = JSON.parse(await readFile(labeledPath, 'utf-8'))
  }
  const labeledIds = new Set(labeled.map(l => l.conversationId))
  
  // Load raw conversations
  const rawPath = 'packages/cli/data/merged-conversations.json'
  const raw: RawConversation[] = JSON.parse(await readFile(rawPath, 'utf-8'))
  
  // Filter to unlabeled
  const unlabeled = raw.filter(c => !labeledIds.has(c.conversationId || c.id))
  
  console.log(`\n📊 Labeling Status:`)
  console.log(`   Already labeled: ${labeled.length}`)
  console.log(`   Unlabeled: ${unlabeled.length}`)
  console.log(`   Total: ${raw.length}\n`)
  
  if (unlabeled.length === 0) {
    console.log('✅ All conversations labeled!')
    return
  }
  
  // Process mode - just show what needs labeling
  const mode = process.argv[2]
  
  if (mode === '--list') {
    // List unlabeled for review
    console.log('Unlabeled conversations:\n')
    for (const conv of unlabeled.slice(0, 20)) {
      const id = (conv.conversationId || conv.id).slice(0, 12)
      const subject = conv.triggerMessage.subject?.slice(0, 50) || '(no subject)'
      const preview = conv.triggerMessage.body?.slice(0, 80).replace(/\n/g, ' ') || ''
      console.log(`${id}: ${subject}`)
      console.log(`   ${preview}...\n`)
    }
    return
  }
  
  if (mode === '--export') {
    // Export current labels
    console.log(JSON.stringify(labeled, null, 2))
    return
  }
  
  // Show next unlabeled conversation
  const conv = unlabeled[0]
  const convId = conv.conversationId || conv.id
  
  console.log('=' .repeat(80))
  console.log(`\n📧 Conversation: ${convId}`)
  console.log(`   App: ${conv.app || 'unknown'}`)
  console.log(`   Subject: ${conv.triggerMessage.subject}\n`)
  console.log('-'.repeat(80))
  
  // Show conversation history (oldest first)
  const history = [...conv.conversationHistory].reverse()
  for (let i = 0; i < Math.min(history.length, 5); i++) {
    const msg = history[i]
    const dir = msg.direction === 'in' ? '👤 CUSTOMER' : '🤖 TEAM'
    console.log(`\n${dir}:`)
    console.log(scrubPII(msg.body.slice(0, 500)))
    if (msg.body.length > 500) console.log('...[truncated]')
  }
  
  console.log('\n' + '-'.repeat(80))
  console.log('\nCategories:')
  CATEGORIES.forEach((cat, i) => {
    console.log(`  ${i + 1}. ${cat}`)
  })
  
  console.log(`\nTo label, run:`)
  console.log(`  bun scripts/label-threads.ts --label ${convId.slice(0, 12)} <category> "<notes>"`)
  console.log(`\nExample:`)
  console.log(`  bun scripts/label-threads.ts --label ${convId.slice(0, 12)} support_access "Can't log in after purchase"`)
}

main().catch(console.error)
