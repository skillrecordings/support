#!/usr/bin/env bun
/**
 * Build Thread Dataset from Production Data
 * 
 * Converts comprehensive-dataset.json to thread-scenarios format,
 * scrubbing PII and adding proper labels.
 */

import { readFile, writeFile } from 'fs/promises'
import { 
  computeThreadSignals,
  fastClassifyThread,
  type ThreadClassifyInput,
  type ThreadMessage,
  type MessageCategory,
} from '../packages/core/src/pipeline/index'

// ============================================================================
// PII Scrubbing
// ============================================================================

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi
const PHONE_REGEX = /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g
const NAME_PATTERNS = [
  /\bHi,?\s+([A-Z][a-z]+)/g,
  /\bHey,?\s+([A-Z][a-z]+)/g,
  /\bDear\s+([A-Z][a-z]+)/g,
  /\bThanks?,?\s+([A-Z][a-z]+)/g,
  /\b-\s*([A-Z][a-z]+)$/gm,
  /\bRegards,?\s*\n?\s*([A-Z][a-z]+)/gi,
  /\bBest,?\s*\n?\s*([A-Z][a-z]+)/gi,
]

// Known instructor names to preserve (not PII)
const INSTRUCTOR_NAMES = ['matt', 'pocock', 'kent', 'dodds', 'josh', 'comeau', 'wes', 'bos', 'ralph']

function scrubPII(text: string): string {
  let scrubbed = text
  
  // Replace emails with generic placeholders
  const emails = text.match(EMAIL_REGEX) || []
  const emailMap = new Map<string, string>()
  let emailCounter = 1
  
  for (const email of emails) {
    if (!emailMap.has(email.toLowerCase())) {
      // Preserve domain hints for context
      const domain = email.split('@')[1]?.toLowerCase() || ''
      let placeholder: string
      
      if (domain.includes('gmail') || domain.includes('yahoo') || domain.includes('hotmail') || domain.includes('outlook')) {
        placeholder = `customer${emailCounter}@example.com`
      } else if (domain.includes('egghead') || domain.includes('totaltypescript') || domain.includes('aihero')) {
        placeholder = `[EMAIL]`
      } else {
        placeholder = `user${emailCounter}@company.com`
      }
      
      emailMap.set(email.toLowerCase(), placeholder)
      emailCounter++
    }
    scrubbed = scrubbed.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), emailMap.get(email.toLowerCase())!)
  }
  
  // Replace phone numbers
  scrubbed = scrubbed.replace(PHONE_REGEX, '[PHONE]')
  
  // Replace names (but not instructor names)
  for (const pattern of NAME_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (match, name) => {
      if (INSTRUCTOR_NAMES.includes(name.toLowerCase())) {
        return match // Keep instructor names
      }
      return match.replace(name, 'Customer')
    })
  }
  
  // Replace specific name mentions
  scrubbed = scrubbed.replace(/\b(Milan|Stojke|Jason|John|Thomas|Leonard|Urban)\b/gi, 'Customer')
  
  // Remove URLs with tracking params (keep base URL)
  scrubbed = scrubbed.replace(/https?:\/\/[^\s<>]+/g, (url) => {
    try {
      const u = new URL(url)
      // Keep just the domain and path, remove tracking
      return `${u.origin}${u.pathname.replace(/\/[a-f0-9-]{20,}/gi, '/[ID]')}`
    } catch {
      return '[URL]'
    }
  })
  
  return scrubbed
}

// ============================================================================
// Category Detection (for labeling)
// ============================================================================

function detectExpectedCategory(text: string, signals: any): MessageCategory {
  const lower = text.toLowerCase()
  
  // Resolution signals
  if (signals.hasThankYou && signals.hasResolutionPhrase && signals.threadLength > 1) {
    return 'resolved'
  }
  
  // Refund
  if (/refund|money back|cancel.*purchase/i.test(lower)) {
    return 'support_refund'
  }
  
  // Access
  if (/can'?t access|don'?t have access|lost access|restore.*access|unable to (access|log)/i.test(lower)) {
    return 'support_access'
  }
  
  // Transfer
  if (/transfer|move.*purchase|different.*email|wrong.*email/i.test(lower)) {
    return 'support_transfer'
  }
  
  // Billing
  if (/invoice|receipt|tax.*document|billing/i.test(lower)) {
    return 'support_billing'
  }
  
  // Fan mail
  if (/thank you|changed my|big fan|appreciate|you'?re (amazing|awesome)|love your/i.test(lower) &&
      !/can'?t|help|issue|problem|refund/i.test(lower)) {
    return 'fan_mail'
  }
  
  // Spam
  if (/partnership|sponsor|collaborate|backlink|seo|guest post/i.test(lower)) {
    return 'spam'
  }
  
  // System
  if (/auto-?reply|out of office|automatic|do not reply|mailer-daemon/i.test(lower)) {
    return 'system'
  }
  
  // Default to technical for course questions
  return 'support_technical'
}

// ============================================================================
// Main
// ============================================================================

interface RawConversation {
  id: string
  app: string
  conversationId: string
  customerEmail: string
  triggerMessage: {
    subject: string
    body: string
    timestamp: number
  }
  agentResponse?: {
    text: string
    category: string
    timestamp: string
  }
  conversationHistory: Array<{
    direction: 'in' | 'out'
    body: string
    timestamp: number
    author?: string
  }>
}

interface ThreadScenario {
  id: string
  name: string
  source: string
  input: ThreadClassifyInput
  expected: {
    category: MessageCategory
  }
  tags: string[]
}

async function main() {
  const raw = await readFile('fixtures/datasets/comprehensive-dataset.json', 'utf-8')
  const conversations: RawConversation[] = JSON.parse(raw)
  
  console.log(`Processing ${conversations.length} conversations...\n`)
  
  const scenarios: ThreadScenario[] = []
  const categoryCount: Record<string, number> = {}
  
  for (const conv of conversations) {
    // Build thread from conversation history (reversed - oldest first)
    // IMPORTANT: We want the state BEFORE the agent responded, so we trim
    // any trailing outbound messages after the last inbound
    const allMessages = [...conv.conversationHistory].reverse()
    
    // Find index of last inbound message
    let lastInboundIdx = -1
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].direction === 'in') {
        lastInboundIdx = i
        break
      }
    }
    
    // Trim to end at the last inbound (the trigger point)
    const trimmedMessages = lastInboundIdx >= 0 
      ? allMessages.slice(0, lastInboundIdx + 1)
      : allMessages
    
    const messages: ThreadMessage[] = trimmedMessages.map(msg => ({
      direction: msg.direction,
      body: scrubPII(msg.body),
      timestamp: msg.timestamp * 1000, // Convert to ms if needed
      subject: msg.direction === 'in' ? scrubPII(conv.triggerMessage.subject) : undefined,
      author: msg.author ? {
        type: msg.direction === 'in' ? 'customer' as const : 'agent' as const,
        email: scrubPII(msg.author),
      } : undefined,
    }))
    
    // Skip if no messages
    if (messages.length === 0) continue
    
    // The trigger is the last message (should be inbound now)
    const lastInbound = messages[messages.length - 1]
    if (!lastInbound || lastInbound.direction !== 'in') continue
    
    const threadInput: ThreadClassifyInput = {
      conversationId: conv.conversationId,
      appId: conv.app || 'unknown',
      messages,
      triggerMessage: lastInbound,
    }
    
    // Compute signals for labeling
    const signals = computeThreadSignals(threadInput)
    
    // Determine expected category
    const allText = messages.map(m => m.body).join(' ')
    const expectedCategory = detectExpectedCategory(allText, signals)
    
    // Build tags
    const tags: string[] = [expectedCategory]
    if (messages.length === 1) tags.push('single')
    else tags.push('multi_turn')
    if (signals.hasTeammateMessage) tags.push('teammate_engaged')
    if (signals.hasThankYou) tags.push('has_thanks')
    
    // Generate descriptive name
    const subjectClean = scrubPII(conv.triggerMessage.subject).slice(0, 50)
    const name = `${expectedCategory}: ${subjectClean}`
    
    scenarios.push({
      id: `prod_${conv.id.slice(0, 8)}`,
      name,
      source: conv.conversationId,
      input: threadInput,
      expected: { category: expectedCategory },
      tags,
    })
    
    categoryCount[expectedCategory] = (categoryCount[expectedCategory] || 0) + 1
  }
  
  // Write output
  await writeFile(
    'fixtures/datasets/thread-scenarios-production.json',
    JSON.stringify(scenarios, null, 2)
  )
  
  console.log('✅ Generated thread scenarios:')
  console.log(`   Total: ${scenarios.length}`)
  console.log('\nBy category:')
  for (const [cat, count] of Object.entries(categoryCount).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${cat}: ${count}`)
  }
  
  console.log('\nSaved to: fixtures/datasets/thread-scenarios-production.json')
}

main().catch(console.error)
