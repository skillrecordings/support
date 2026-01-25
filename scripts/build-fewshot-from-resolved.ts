#!/usr/bin/env bun
/**
 * Build Few-Shot Examples from Resolved Threads
 * 
 * Extracts training examples from threads that were successfully resolved.
 * These serve as ground truth for:
 * 1. Signal extraction - what signals should have been detected
 * 2. Action selection - what action led to resolution
 * 3. Response patterns - what response worked
 * 
 * Usage:
 *   pnpm tsx scripts/build-fewshot-from-resolved.ts
 *   pnpm tsx scripts/build-fewshot-from-resolved.ts --category support_refund --limit 20
 *   pnpm tsx scripts/build-fewshot-from-resolved.ts --min-confidence 0.9 --source merged
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { parseArgs } from 'util'

import {
  computeThreadSignals,
  type ThreadClassifyInput,
  type ThreadMessage,
  type ThreadSignals,
  type MessageCategory,
  type RouteAction,
} from '../packages/core/src/pipeline/index'

// ============================================================================
// Types
// ============================================================================

/** Resolution type based on how we detected resolution */
type ResolutionType = 
  | 'customer_confirmed'  // Customer said "that worked", "thanks", etc.
  | 'issue_fixed'         // Team said "done", "processed", etc. + no follow-up
  | 'refund_completed'    // Refund was processed (detected in response)
  | 'access_granted'      // Access restored + no follow-up

/** Signal extraction example - what signals should be detected from a message */
interface SignalExample {
  messageIndex: number
  inputMessage: string
  inputSubject?: string
  expectedSignals: Partial<ThreadSignals>
}

/** Action selection example - what action led to resolution */
interface ActionExample {
  threadSummary: string
  signals: Partial<ThreadSignals>
  correctAction: RouteAction
  correctCategory: MessageCategory
  actionResult: 'resolved' | 'escalated' | 'continued'
}

/** Response pattern - what response worked */
interface ResponseExample {
  category: MessageCategory
  customerMessage: string
  agentResponse: string
  resolutionContext?: string
}

/** Full resolved thread example */
interface ResolvedThreadExample {
  // Source metadata
  threadId: string
  conversationId: string
  appId: string
  resolutionType: ResolutionType
  resolutionConfidence: number
  
  // Extracted examples
  signalExamples: SignalExample[]
  actionExample: ActionExample
  responseExample?: ResponseExample
  
  // Full thread for reference
  messages: Array<{
    direction: 'in' | 'out'
    body: string
    timestamp?: number
  }>
  
  // Classification
  originalCategory: MessageCategory
  tags: string[]
}

/** Input thread from labeled datasets or raw data */
interface LabeledThread {
  id: string
  conversationId: string
  app?: string
  notes?: string
  input: {
    conversationId: string
    appId: string
    messages: Array<{
      direction: 'in' | 'out'
      body: string
      timestamp?: number
      subject?: string
    }>
    triggerMessage?: ThreadMessage
  }
  expected: {
    category: MessageCategory
    action?: RouteAction
  }
  tags: string[]
}

/** Raw conversation from merged-conversations.json */
interface RawConversation {
  id: string
  conversationId?: string
  app?: string
  triggerMessage: {
    subject: string
    body: string
    direction: string
    timestamp?: number
  }
  conversationHistory: Array<{
    body: string
    direction: string
    timestamp?: number
    author?: string
  }>
}

// ============================================================================
// Resolution Detection
// ============================================================================

const THANK_YOU_PATTERNS = [
  /\bthank(s| you)\b/i,
  /\bappreciate\s+(it|your|the)\b/i,
  /\bcheers\b/i,
  /\bperfect[!.,]?\s*(thank)?/i,
  /\bawesome[!.,]?\s*(thank)?/i,
  /\bgreat[!.,]?\s*(thank)?/i,
  /\byou'?re (the best|awesome|amazing)/i,
]

const RESOLUTION_PATTERNS = [
  /\b(that |it |this )?(work(s|ed)|fixed|solved)\b(?!@)/i,
  /\ball (good|set|sorted)\b/i,
  /\bgot it[!.,]?\s*(thank)?/i,
  /\bmakes sense[!.,]/i,
  /\bno (more |further )?(questions?|issues?|problems?)\b/i,
  /\bsuccessfully\b/i,
  /\bproblem('s| is)? solved\b/i,
  /\bissue('s| is)? (fixed|resolved)\b/i,
  /\bcan access\b/i,
  /\bnow (work|access|see)/i,
]

const REFUND_COMPLETED_PATTERNS = [
  /refund.*(?:processed|initiated|completed|sent)/i,
  /(?:processed|initiated|completed|sent).*refund/i,
  /(?:we've|i've).*refund/i,
]

const ACCESS_GRANTED_PATTERNS = [
  /(?:refreshed|restored|granted|given).*access/i,
  /access.*(?:refreshed|restored|granted|given)/i,
  /license.*transferred/i,
  /(?:you should|you can) now (access|log in|see)/i,
]

const INVOICE_SENT_PATTERNS = [
  /invoice.*attached/i,
  /attached.*invoice/i,
  /(?:sent|here's|here is).*(?:invoice|receipt)/i,
]

interface ResolutionAnalysis {
  isResolved: boolean
  resolutionType: ResolutionType
  confidence: number
  resolutionMessageIndex?: number
  teamResponseIndex?: number
}

function analyzeResolution(messages: Array<{ direction: string; body: string }>): ResolutionAnalysis {
  // Need at least 2 messages (request + response)
  if (messages.length < 2) {
    return { isResolved: false, resolutionType: 'customer_confirmed', confidence: 0 }
  }

  let teamResponseIndex = -1
  let customerConfirmationIndex = -1
  let resolutionType: ResolutionType = 'customer_confirmed'
  let confidence = 0

  // Walk through messages oldest to newest
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    const body = msg.body.toLowerCase()

    if (msg.direction === 'out') {
      teamResponseIndex = i
      
      // Check for action-completion signals in team response
      if (REFUND_COMPLETED_PATTERNS.some(p => p.test(body))) {
        resolutionType = 'refund_completed'
        confidence = Math.max(confidence, 0.8)
      } else if (ACCESS_GRANTED_PATTERNS.some(p => p.test(body))) {
        resolutionType = 'access_granted'
        confidence = Math.max(confidence, 0.8)
      } else if (INVOICE_SENT_PATTERNS.some(p => p.test(body))) {
        resolutionType = 'issue_fixed'
        confidence = Math.max(confidence, 0.7)
      }
    } else if (msg.direction === 'in' && teamResponseIndex >= 0) {
      // Customer message AFTER team response - check for confirmation
      const hasThankYou = THANK_YOU_PATTERNS.some(p => p.test(body))
      const hasResolutionPhrase = RESOLUTION_PATTERNS.some(p => p.test(body))
      
      if (hasThankYou && hasResolutionPhrase) {
        customerConfirmationIndex = i
        resolutionType = 'customer_confirmed'
        confidence = 0.95
      } else if (hasResolutionPhrase) {
        customerConfirmationIndex = i
        resolutionType = 'customer_confirmed'
        confidence = 0.85
      } else if (hasThankYou && i === messages.length - 1) {
        // Last message is thanks = likely resolved
        customerConfirmationIndex = i
        resolutionType = 'customer_confirmed'
        confidence = 0.7
      }
    }
  }

  // If team took action (refund, access) and no angry follow-up, it's resolved
  if (confidence >= 0.7 && teamResponseIndex >= 0) {
    const laterCustomerMessages = messages.slice(teamResponseIndex + 1)
      .filter(m => m.direction === 'in')
    
    const hasAngryFollowup = laterCustomerMessages.some(m => 
      /\b(still|can't|cannot|doesn't|not working|issue|problem|angry|frustrated)\b/i.test(m.body)
    )
    
    if (hasAngryFollowup) {
      confidence *= 0.5 // Reduce confidence if customer seems unsatisfied
    }
  }

  return {
    isResolved: confidence >= 0.6,
    resolutionType,
    confidence,
    resolutionMessageIndex: customerConfirmationIndex >= 0 ? customerConfirmationIndex : undefined,
    teamResponseIndex: teamResponseIndex >= 0 ? teamResponseIndex : undefined,
  }
}

// ============================================================================
// Category Detection
// ============================================================================

function detectOriginalCategory(messages: Array<{ direction: string; body: string }>): MessageCategory {
  // Get first customer message
  const firstCustomerMsg = messages.find(m => m.direction === 'in')
  if (!firstCustomerMsg) return 'support_technical'
  
  const text = firstCustomerMsg.body.toLowerCase()
  
  if (/refund|money back/i.test(text)) return 'support_refund'
  if (/(?:can't|cannot|don't|lost|no).*access|access.*(?:issue|problem|anymore)/i.test(text)) return 'support_access'
  if (/(?:transfer|move|change).*(?:email|account|license)/i.test(text)) return 'support_transfer'
  if (/invoice|receipt|tax/i.test(text)) return 'support_billing'
  
  return 'support_technical'
}

function detectAction(category: MessageCategory): RouteAction {
  switch (category) {
    case 'support_access':
    case 'support_refund':
    case 'support_transfer':
    case 'support_billing':
    case 'support_technical':
      return 'respond'
    case 'fan_mail':
      return 'escalate_instructor'
    case 'resolved':
      return 'silence'
    default:
      return 'respond'
  }
}

// ============================================================================
// Example Extraction
// ============================================================================

function extractSignalExamples(
  messages: Array<{ direction: string; body: string; subject?: string }>,
  threadSignals: ThreadSignals
): SignalExample[] {
  const examples: SignalExample[] = []
  
  // Extract from first customer message (the request)
  const firstCustomerIdx = messages.findIndex(m => m.direction === 'in')
  if (firstCustomerIdx >= 0) {
    const msg = messages[firstCustomerIdx]!
    
    // Only include signals that are true
    const relevantSignals: Partial<ThreadSignals> = {}
    if (threadSignals.hasEmailInBody) relevantSignals.hasEmailInBody = true
    if (threadSignals.hasPurchaseDate) relevantSignals.hasPurchaseDate = true
    if (threadSignals.hasErrorMessage) relevantSignals.hasErrorMessage = true
    if (threadSignals.hasAngrySentiment) relevantSignals.hasAngrySentiment = true
    if (threadSignals.mentionsInstructor) relevantSignals.mentionsInstructor = true
    
    if (Object.keys(relevantSignals).length > 0) {
      examples.push({
        messageIndex: firstCustomerIdx,
        inputMessage: msg.body.slice(0, 500), // Truncate for readability
        inputSubject: msg.subject,
        expectedSignals: relevantSignals,
      })
    }
  }
  
  // Extract from resolution message if different and has signals
  const lastCustomerIdx = messages.length - 1 - [...messages].reverse().findIndex(m => m.direction === 'in')
  if (lastCustomerIdx >= 0 && lastCustomerIdx !== firstCustomerIdx) {
    const msg = messages[lastCustomerIdx]!
    const resolutionSignals: Partial<ThreadSignals> = {}
    
    if (threadSignals.hasThankYou) resolutionSignals.hasThankYou = true
    if (threadSignals.hasResolutionPhrase) resolutionSignals.hasResolutionPhrase = true
    
    if (Object.keys(resolutionSignals).length > 0) {
      examples.push({
        messageIndex: lastCustomerIdx,
        inputMessage: msg.body.slice(0, 500),
        expectedSignals: resolutionSignals,
      })
    }
  }
  
  return examples
}

function extractActionExample(
  messages: Array<{ direction: string; body: string }>,
  signals: ThreadSignals,
  category: MessageCategory
): ActionExample {
  // Build thread summary
  const customerMessages = messages.filter(m => m.direction === 'in').length
  const teamMessages = messages.filter(m => m.direction === 'out').length
  const firstMsg = messages.find(m => m.direction === 'in')?.body.slice(0, 100) || ''
  
  return {
    threadSummary: `${customerMessages} customer msgs, ${teamMessages} team msgs. Request: "${firstMsg}..."`,
    signals: {
      threadLength: signals.threadLength,
      hasThankYou: signals.hasThankYou,
      hasResolutionPhrase: signals.hasResolutionPhrase,
      hasTeammateMessage: signals.hasTeammateMessage,
      lastMessageDirection: signals.lastMessageDirection,
    },
    correctAction: detectAction(category),
    correctCategory: category,
    actionResult: 'resolved',
  }
}

function extractResponseExample(
  messages: Array<{ direction: string; body: string }>,
  category: MessageCategory,
  resolutionAnalysis: ResolutionAnalysis
): ResponseExample | undefined {
  if (resolutionAnalysis.teamResponseIndex === undefined) return undefined
  
  const teamResponse = messages[resolutionAnalysis.teamResponseIndex]
  if (!teamResponse || teamResponse.direction !== 'out') return undefined
  
  // Find the customer message that this response was addressing
  const precedingCustomerMsgs = messages.slice(0, resolutionAnalysis.teamResponseIndex)
    .filter(m => m.direction === 'in')
  const customerMsg = precedingCustomerMsgs[precedingCustomerMsgs.length - 1]
  
  if (!customerMsg) return undefined
  
  // Get resolution context if available
  let resolutionContext: string | undefined
  if (resolutionAnalysis.resolutionMessageIndex !== undefined) {
    const resolutionMsg = messages[resolutionAnalysis.resolutionMessageIndex]
    if (resolutionMsg) {
      resolutionContext = resolutionMsg.body.slice(0, 200)
    }
  }
  
  return {
    category,
    customerMessage: customerMsg.body.slice(0, 500),
    agentResponse: teamResponse.body.slice(0, 1000),
    resolutionContext,
  }
}

// ============================================================================
// PII Scrubbing (reused from batch-label.ts)
// ============================================================================

function scrubPII(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, 'user@example.com')
    .replace(/\b(Milan|Stojke|Jason|John|Thomas|Leonard|Urban|Kevin|Arvind|Denis|Christian|Fiona|Martin|Aminata|Andrew|Dan|Thorr|Zan|Francis|Adam|Daina|Abhinav|Dewin|Nishant|Carlos|Antal|Siva|Allan|Christina)\b/gi, 'Customer')
    .replace(/(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE]')
}

// ============================================================================
// Main Processing
// ============================================================================

async function loadLabeledThreads(): Promise<LabeledThread[]> {
  const combinedPath = 'fixtures/datasets/combined-threads.json'
  if (existsSync(combinedPath)) {
    return JSON.parse(await readFile(combinedPath, 'utf-8'))
  }
  
  const autoLabeledPath = 'fixtures/datasets/auto-labeled.json'
  if (existsSync(autoLabeledPath)) {
    return JSON.parse(await readFile(autoLabeledPath, 'utf-8'))
  }
  
  throw new Error('No labeled thread datasets found')
}

async function loadRawConversations(): Promise<RawConversation[]> {
  const rawPath = 'packages/cli/data/merged-conversations.json'
  if (existsSync(rawPath)) {
    return JSON.parse(await readFile(rawPath, 'utf-8'))
  }
  throw new Error('Raw conversations not found at ' + rawPath)
}

function convertRawToThread(raw: RawConversation): LabeledThread {
  // History is typically newest-first, reverse for chronological
  const history = [...raw.conversationHistory].reverse()
  
  const messages = history.map(m => ({
    direction: m.direction as 'in' | 'out',
    body: scrubPII(m.body),
    timestamp: m.timestamp,
  }))
  
  // Detect category from first customer message
  const category = detectOriginalCategory(messages)
  
  return {
    id: raw.id || raw.conversationId || 'unknown',
    conversationId: raw.conversationId || raw.id || 'unknown',
    app: raw.app,
    input: {
      conversationId: raw.conversationId || raw.id || 'unknown',
      appId: raw.app || 'unknown',
      messages,
      triggerMessage: {
        direction: 'in',
        body: scrubPII(raw.triggerMessage.body),
        timestamp: raw.triggerMessage.timestamp || Date.now(),
        subject: raw.triggerMessage.subject,
      },
    },
    expected: {
      category,
      action: detectAction(category),
    },
    tags: [category],
  }
}

async function processThread(
  thread: LabeledThread,
  minConfidence: number
): Promise<ResolvedThreadExample | null> {
  const messages = thread.input.messages.map(m => ({
    direction: m.direction,
    body: m.body,
    subject: m.subject,
  }))
  
  // Analyze resolution
  const resolution = analyzeResolution(messages)
  
  if (!resolution.isResolved || resolution.confidence < minConfidence) {
    return null
  }
  
  // Compute thread signals
  const threadInput: ThreadClassifyInput = {
    conversationId: thread.conversationId,
    appId: thread.input.appId,
    messages: thread.input.messages.map((m, i) => ({
      direction: m.direction,
      body: m.body,
      timestamp: m.timestamp || Date.now() + i * 60000,
      subject: m.subject,
    })),
    triggerMessage: thread.input.triggerMessage || {
      direction: 'in',
      body: messages[0]?.body || '',
      timestamp: Date.now(),
    },
  }
  
  const signals = computeThreadSignals(threadInput)
  
  // Detect original category (what the thread was about before resolution)
  const originalCategory = thread.expected.category === 'resolved' 
    ? detectOriginalCategory(messages)
    : thread.expected.category
  
  // Extract examples
  const signalExamples = extractSignalExamples(messages, signals)
  const actionExample = extractActionExample(messages, signals, originalCategory)
  const responseExample = extractResponseExample(messages, originalCategory, resolution)
  
  // Build tags
  const tags: string[] = [originalCategory, resolution.resolutionType]
  if (messages.length === 1) tags.push('single')
  else if (messages.length <= 3) tags.push('short')
  else tags.push('multi_turn')
  if (signals.hasTeammateMessage) tags.push('teammate')
  if (signals.hasThankYou) tags.push('thanked')
  
  return {
    threadId: thread.id,
    conversationId: thread.conversationId,
    appId: thread.input.appId,
    resolutionType: resolution.resolutionType,
    resolutionConfidence: resolution.confidence,
    
    signalExamples,
    actionExample,
    responseExample,
    
    messages: messages.map(m => ({
      direction: m.direction,
      body: scrubPII(m.body),
    })),
    
    originalCategory,
    tags,
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const { values: args } = parseArgs({
    options: {
      'min-confidence': { type: 'string', default: '0.7' },
      category: { type: 'string' },
      limit: { type: 'string' },
      source: { type: 'string', default: 'labeled' }, // 'labeled' or 'merged'
      output: { type: 'string', default: 'fixtures/fewshot/resolved-examples.json' },
      verbose: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  
  const minConfidence = parseFloat(args['min-confidence'] || '0.7')
  const categoryFilter = args.category as MessageCategory | undefined
  const limit = args.limit ? parseInt(args.limit, 10) : undefined
  const source = args.source || 'labeled'
  const outputPath = args.output || 'fixtures/fewshot/resolved-examples.json'
  const verbose = args.verbose || false
  
  console.log('🔍 Building few-shot examples from resolved threads...\n')
  console.log(`   Source: ${source}`)
  console.log(`   Min confidence: ${minConfidence}`)
  if (categoryFilter) console.log(`   Category filter: ${categoryFilter}`)
  if (limit) console.log(`   Limit: ${limit}`)
  console.log()
  
  // Load data
  let threads: LabeledThread[]
  
  if (source === 'merged' || source === 'raw') {
    console.log('Loading raw conversations...')
    const raw = await loadRawConversations()
    threads = raw.map(convertRawToThread)
    console.log(`   Loaded ${threads.length} raw conversations`)
  } else {
    console.log('Loading labeled threads...')
    threads = await loadLabeledThreads()
    console.log(`   Loaded ${threads.length} labeled threads`)
  }
  
  // Filter by category if specified
  if (categoryFilter) {
    threads = threads.filter(t => 
      t.expected.category === categoryFilter ||
      detectOriginalCategory(t.input.messages) === categoryFilter
    )
    console.log(`   After category filter: ${threads.length}`)
  }
  
  // Process threads
  const examples: ResolvedThreadExample[] = []
  const stats = {
    total: 0,
    resolved: 0,
    skippedLowConfidence: 0,
    skippedNotResolved: 0,
    byCategory: {} as Record<string, number>,
    byResolutionType: {} as Record<string, number>,
  }
  
  for (const thread of threads) {
    stats.total++
    
    if (limit && examples.length >= limit) break
    
    const example = await processThread(thread, minConfidence)
    
    if (example) {
      examples.push(example)
      stats.resolved++
      stats.byCategory[example.originalCategory] = (stats.byCategory[example.originalCategory] || 0) + 1
      stats.byResolutionType[example.resolutionType] = (stats.byResolutionType[example.resolutionType] || 0) + 1
      
      if (verbose) {
        console.log(`   ✓ ${thread.id}: ${example.originalCategory} → ${example.resolutionType} (${(example.resolutionConfidence * 100).toFixed(0)}%)`)
      }
    } else {
      stats.skippedNotResolved++
    }
  }
  
  // Ensure output directory exists
  const outputDir = outputPath.split('/').slice(0, -1).join('/')
  if (outputDir && !existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true })
  }
  
  // Write output
  await writeFile(outputPath, JSON.stringify(examples, null, 2))
  
  // Print summary
  console.log('\n📊 Extraction Summary')
  console.log(`   Processed: ${stats.total}`)
  console.log(`   Resolved: ${stats.resolved}`)
  console.log(`   Skipped (not resolved): ${stats.skippedNotResolved}`)
  
  console.log('\n📁 By original category:')
  for (const [cat, count] of Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${cat}: ${count}`)
  }
  
  console.log('\n🎯 By resolution type:')
  for (const [type, count] of Object.entries(stats.byResolutionType).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${type}: ${count}`)
  }
  
  console.log(`\n✅ Saved ${examples.length} examples to ${outputPath}`)
  
  // Print sample
  if (examples.length > 0) {
    console.log('\n📝 Sample example:')
    const sample = examples[0]!
    console.log(`   Thread: ${sample.threadId}`)
    console.log(`   Category: ${sample.originalCategory}`)
    console.log(`   Resolution: ${sample.resolutionType} (${(sample.resolutionConfidence * 100).toFixed(0)}% confidence)`)
    console.log(`   Signal examples: ${sample.signalExamples.length}`)
    console.log(`   Has response example: ${sample.responseExample ? 'yes' : 'no'}`)
    
    if (sample.responseExample) {
      console.log('\n   Response pattern:')
      console.log(`   Customer: "${sample.responseExample.customerMessage.slice(0, 100)}..."`)
      console.log(`   Agent: "${sample.responseExample.agentResponse.slice(0, 100)}..."`)
    }
  }
}

main().catch(console.error)
