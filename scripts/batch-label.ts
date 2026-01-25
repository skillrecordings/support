#!/usr/bin/env bun
/**
 * Batch Label Threads
 * 
 * Uses pattern matching to auto-label obvious cases,
 * outputs uncertain ones for manual review.
 */

import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

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
    .replace(/\b(Milan|Stojke|Jason|John|Thomas|Leonard|Urban|Kevin|Arvind|Denis|Christian|Fiona|Martin|Aminata|Andrew|Dan|Thorr|Zan|Francis|Adam|Daina|Abhinav|Dewin|Nishant)\b/gi, 'Customer')
}

// Check if thread is resolved (team responded, then customer confirmed)
function isResolved(conv: RawConversation): boolean {
  const history = conv.conversationHistory
  if (history.length < 3) return false // Need at least: customer → team → customer
  
  // Find sequence: team response followed by customer confirmation
  let foundTeamResponse = false
  let customerAfterTeam = false
  
  // Walk through oldest to newest
  const sorted = [...history].reverse()
  for (const msg of sorted) {
    if (msg.direction === 'out') {
      foundTeamResponse = true
    } else if (msg.direction === 'in' && foundTeamResponse) {
      customerAfterTeam = true
      // Check if this customer message is a resolution confirmation
      const body = msg.body.toLowerCase()
      const resolutionPatterns = [
        /that worked/i,
        /perfect,?\s*thank/i,
        /thank.*for.*help/i,
        /appreciate it/i,
        /all good/i,
        /sorted/i,
        /fixed/i,
        /got it.*thank/i,
      ]
      if (resolutionPatterns.some(p => p.test(body))) {
        return true
      }
    }
  }
  
  // Also check if we explicitly said we processed something
  const lastTeamMsg = history.find(m => m.direction === 'out')
  if (lastTeamMsg) {
    const teamBody = lastTeamMsg.body.toLowerCase()
    if (/we've.*(?:initiated|processed|completed|sent)/i.test(teamBody) ||
        /refund.*processed/i.test(teamBody) ||
        /invoice.*attached/i.test(teamBody)) {
      return true
    }
  }
  
  return false
}

// Auto-labeling rules
function autoLabel(conv: RawConversation): { category: string; action: string; notes: string; confidence: 'high' | 'medium' | 'low' } | null {
  const subject = (conv.triggerMessage.subject || '').toLowerCase()
  const body = (conv.triggerMessage.body || '').toLowerCase()
  const text = `${subject} ${body}`
  
  // Check for resolved threads first (multi-turn with resolution)
  if (isResolved(conv)) {
    return { category: 'resolved', action: 'silence', notes: 'Thread resolved', confidence: 'high' }
  }
  
  // SPAM - vendor/partnership pitches
  const spamPatterns = [
    /youtube.*collaboration/i,
    /paid.*collab/i,
    /sponsorship/i,
    /partnership.*opportunity/i,
    /reaching out from/i,
    /collaboration.*rates/i,
    /sponsored.*collaboration/i,
    /youtube.*opportunity/i,
    /i'm.*from\s+\w+.*(?:ai|company|startup)/i,
    /we'd love to explore/i,
    /media.*initiative/i,
    /influencer/i,
  ]
  
  if (spamPatterns.some(p => p.test(text))) {
    return { category: 'spam', action: 'silence', notes: 'Vendor/partnership pitch', confidence: 'high' }
  }
  
  // SYSTEM - invoices, automated
  if (/invoice for \w+ \d{4}/i.test(subject) || /noreply|no-reply|mailer-daemon/i.test(text)) {
    return { category: 'system', action: 'silence', notes: 'Automated/invoice', confidence: 'high' }
  }
  
  // REFUND - explicit refund request
  if (/refund/i.test(subject) || /(?:want|need|get|proceed with).*refund/i.test(text)) {
    return { category: 'support_refund', action: 'respond', notes: 'Refund request', confidence: 'high' }
  }
  
  // ACCESS - can't access content (handle smart quotes)
  if (/(?:don.t|can.t|cannot|no|lost).*access/i.test(text) || 
      /access.*(?:anymore|issue|problem)/i.test(text) ||
      /restore.*access/i.test(text)) {
    return { category: 'support_access', action: 'respond', notes: 'Access issue', confidence: 'high' }
  }
  
  // BILLING - invoice request
  if (/(?:need|want|send).*(?:invoice|receipt)/i.test(text) ||
      /tax.*(?:document|purposes)/i.test(text)) {
    return { category: 'support_billing', action: 'respond', notes: 'Invoice/billing request', confidence: 'high' }
  }
  
  // TRANSFER - email change
  if (/(?:transfer|move|change).*(?:email|account)/i.test(text) ||
      /(?:wrong|different).*email/i.test(text)) {
    return { category: 'support_transfer', action: 'respond', notes: 'Transfer request', confidence: 'medium' }
  }
  
  // FAN MAIL - survey responses
  if (/re:.*(?:quick question|welcome to|hey there)/i.test(subject) &&
      !/refund|access|invoice|can't/i.test(text)) {
    return { category: 'fan_mail', action: 'escalate_instructor', notes: 'Survey/welcome response', confidence: 'medium' }
  }
  
  // FAN MAIL - appreciation
  if (/(?:love|loved|amazing|great|thank|binged|changed my)/i.test(text) &&
      !/refund|access|can.t|problem|issue/i.test(text) &&
      conv.conversationHistory.length <= 2) {
    return { category: 'fan_mail', action: 'escalate_instructor', notes: 'Appreciation', confidence: 'low' }
  }
  
  // SUPPORT TECHNICAL - general questions about course
  if (/(?:question|how do|where can|wondering|confused|stuck|help)/i.test(text) &&
      !/refund|access|invoice|transfer/i.test(text) &&
      !spamPatterns.some(p => p.test(text))) {
    return { category: 'support_technical', action: 'respond', notes: 'General question', confidence: 'low' }
  }
  
  return null
}

function getAction(category: string): string {
  switch (category) {
    case 'support_access':
    case 'support_refund':
    case 'support_transfer':
    case 'support_technical':
    case 'support_billing':
      return 'respond'
    case 'fan_mail':
      return 'escalate_instructor'
    default:
      return 'silence'
  }
}

async function main() {
  // Load raw conversations
  const rawPath = 'packages/cli/data/merged-conversations.json'
  const raw: RawConversation[] = JSON.parse(await readFile(rawPath, 'utf-8'))
  
  // Load existing real-threads labels
  const existingPath = 'fixtures/datasets/real-threads.json'
  const existing: LabeledThread[] = existsSync(existingPath) 
    ? JSON.parse(await readFile(existingPath, 'utf-8'))
    : []
  
  const labeled: LabeledThread[] = [...existing]
  const needsReview: Array<{ conv: RawConversation; suggestion?: ReturnType<typeof autoLabel> }> = []
  const skipped: string[] = []
  
  // Get existing IDs (handle both formats)
  const existingIds = new Set(existing.map(l => {
    const id = l.conversationId || l.id
    // Normalize to short format for comparison
    return id.replace(/^real_/, '').slice(0, 8)
  }))
  
  for (const conv of raw) {
    const convId = conv.conversationId || conv.id
    const shortId = convId.replace('cnv_', '').slice(0, 8)
    
    // Skip if already labeled
    if (existingIds.has(shortId)) {
      skipped.push(shortId)
      continue
    }
    
    // Try auto-labeling
    const label = autoLabel(conv)
    
    if (label && (label.confidence === 'high' || (label.confidence === 'medium' && label.category === 'fan_mail'))) {
      // Auto-label with high confidence
      const history = [...conv.conversationHistory].reverse()
      const messages = history.map(m => ({
        direction: m.direction as 'in' | 'out',
        body: scrubPII(m.body),
      }))
      
      labeled.push({
        id: `auto_${shortId}`,
        conversationId: convId,
        app: conv.app || 'unknown',
        notes: label.notes,
        input: {
          conversationId: convId,
          appId: conv.app || 'unknown',
          messages,
          triggerMessage: messages[messages.length - 1] || { body: '', direction: 'in' },
        },
        expected: {
          category: label.category,
          action: label.action,
        },
        tags: [label.category, label.action, messages.length === 1 ? 'single' : 'multi_turn', 'auto_labeled'],
      })
    } else {
      // Needs manual review
      needsReview.push({ conv, suggestion: label })
    }
  }
  
  console.log(`\n📊 Batch Labeling Results:`)
  console.log(`   Already labeled: ${skipped.length}`)
  console.log(`   Auto-labeled (high confidence): ${labeled.length - existing.length}`)
  console.log(`   Needs manual review: ${needsReview.length}`)
  
  // Show category breakdown of new labels
  const newLabels = labeled.slice(existing.length)
  const cats: Record<string, number> = {}
  for (const l of newLabels) {
    cats[l.expected.category] = (cats[l.expected.category] || 0) + 1
  }
  
  console.log(`\n📁 New labels by category:`)
  for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${cat}: ${count}`)
  }
  
  // Save auto-labeled
  await writeFile('fixtures/datasets/auto-labeled.json', JSON.stringify(newLabels, null, 2))
  console.log(`\n✅ Saved ${newLabels.length} auto-labeled threads to fixtures/datasets/auto-labeled.json`)
  
  // Show items needing review
  if (needsReview.length > 0 && process.argv.includes('--review')) {
    console.log(`\n🔍 Items needing review (first 10):\n`)
    for (const { conv, suggestion } of needsReview.slice(0, 10)) {
      const subject = conv.triggerMessage.subject?.slice(0, 50) || '(no subject)'
      const preview = conv.triggerMessage.body?.slice(0, 100).replace(/\n/g, ' ') || ''
      console.log(`${(conv.conversationId || conv.id).slice(0, 12)}: ${subject}`)
      console.log(`   ${preview}...`)
      if (suggestion) {
        console.log(`   💡 Suggestion: ${suggestion.category} (${suggestion.confidence})`)
      }
      console.log()
    }
  }
}

main().catch(console.error)
