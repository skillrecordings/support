/**
 * Step 1: CLASSIFY
 *
 * Categorizes incoming messages before any other processing.
 * Uses a combination of rules and LLM for nuanced classification.
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import type {
  ClassifyInput,
  ClassifyOutput,
  MessageCategory,
  MessageSignals,
  ThreadClassifyInput,
  ThreadClassifyOutput,
  ThreadSignals,
} from '../types'
import {
  computeThreadSignals,
  isThreadResolved,
  shouldSupportTeammate,
} from './thread-signals'

// ============================================================================
// Signal extraction (deterministic, no LLM)
// ============================================================================

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const DATE_PATTERNS = [
  /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i,
  /\d{1,2}\/\d{1,2}\/\d{2,4}/,
  /\d{4}-\d{2}-\d{2}/,
  /(?:yesterday|last\s+(?:week|month))/i,
]
const ERROR_PATTERNS = [
  /error\s*:?\s*\d+/i,
  /exception/i,
  /stack\s*trace/i,
  /failed\s+to/i,
  /cannot\s+(?:read|access|find)/i,
]
const INSTRUCTOR_NAMES = [
  'matt',
  'pocock',
  'kent',
  'dodds',
  'wesbos',
  'wes bos',
]
const ANGRY_PATTERNS = [
  /(?:wtf|what the (?:fuck|hell))/i,
  /this is (?:ridiculous|unacceptable|bullshit)/i,
  /i(?:'m| am) (?:furious|pissed|angry)/i,
  /worst\s+(?:experience|service)/i,
  /(?:refund|money back)\s+(?:now|immediately)/i,
]
const AUTOMATED_PATTERNS = [
  /auto-?reply/i,
  /out of (?:the )?office/i,
  /automatic\s+response/i,
  /do\s+not\s+reply/i,
  /noreply@/i,
  /mailer-daemon/i,
  /postmaster@/i,
]
const VENDOR_PATTERNS = [
  /partnership\s+opportunity/i,
  /collaboration\s+proposal/i,
  /sponsored?\s+(?:post|content)/i,
  /backlink/i,
  /guest\s+(?:post|article)/i,
  /seo\s+(?:services?|optimization)/i,
  /influencer\s+(?:campaign|manager|marketing)/i,
  // Business/partnership pitches - be specific
  /sponsoring\s+your\s+(?:channel|content|newsletter)/i,
  /campaign\s+budget/i,
  /creator\s+fee/i,
  /\d+\s*(?:USD|EUR|GBP)\s+(?:creator|fee|budget)/i,
  /partnerships?\s+@\s+\w+/i, // "Partnerships @ [Company]"
  /(?:vp|director)\s+of\s+(?:gtm|growth|marketing|partnerships)/i,
  // Additional sponsor/collab patterns
  /\bpaid\s+collab\b/i, // "paid collab"
  /\bsponsor\b.{0,30}\b(?:content|channel|video|newsletter)\b/i, // "sponsor...content" with up to 30 chars between
  /\b(?:we'?d?\s+)?love\s+to\s+sponsor\b/i, // "we'd love to sponsor", "love to sponsor"
  /\bcollab\s+(?:proposal|opportunity)\b/i, // "collab proposal"
]

// Legal threat patterns - escalate_urgent ONLY
const LEGAL_THREAT_PATTERNS = [
  /\b(?:my\s+)?lawyer/i,
  /\blegal\s+action/i,
  /\bsue\s+(?:you|your|the)/i,
  /\bsuing\b/i,
  /\blawsuit/i,
  /\battorney/i,
  /\bcourt\b.*\b(?:action|case|filing)/i,
  /\blegal\s+(?:team|counsel|representation)/i,
  /\breport(?:ing)?\s+(?:to|this\s+to)\s+(?:the\s+)?(?:ftc|bbb|attorney\s+general|consumer\s+protection)/i,
]

// Outside policy timeframe patterns (30+ days ago)
const OUTSIDE_POLICY_PATTERNS = [
  /\b(?:6|7|8|9|\d{2,})\s+weeks?\s+ago/i, // "6 weeks ago"
  /\b(?:45|5\d|6\d|7\d|8\d|9\d|\d{3,})\s+days?\s+ago/i, // "45 days ago"
  /\b(?:2|3|4|5|6|7|8|9|1\d)\s+months?\s+ago/i, // "2+ months ago"
  /\bover\s+(?:a\s+)?month\s+ago/i, // "over a month ago"
  /\bmore\s+than\s+(?:a\s+)?month/i, // "more than a month"
  /\b(?:last|this)\s+(?:year|winter|spring|summer|fall|autumn)/i, // seasonal references
  /\bbought\s+(?:it\s+)?(?:back\s+in|last)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)/i,
]

// Personal/casual message patterns (for instructor routing)
const PERSONAL_MESSAGE_PATTERNS = [
  /^(?:hey|hi|hello|yo|sup)[\s,!]*(?:matt|man|dude)?[!\s]*$/i, // Just a greeting
  /\blol\b/i,
  /\bhaha\b/i,
  /^(?:this\s+is\s+)?(?:crazy|wild|insane|amazing|awesome)[!\s]*$/i,
  /^(?:love\s+(?:it|this|your))/i,
  /\b(?:big\s+fan|huge\s+fan)\b/i,
]

// Patterns that indicate genuine appreciation (not sign-offs like "Thanks,\nJohn" or business "we'd love to")
// Must be in context of appreciation to the instructor, not polite closings
const GENUINE_APPRECIATION_PATTERNS = [
  /\bthank(?:s|ing)?\s+(?:you\s+)?(?:so\s+much|for\s+(?:your|the|everything|this))/i, // "thanks so much", "thank you for"
  /\b(?:love|loving)\s+(?:your|the|what\s+you)/i, // "love your work", "loving the content"
  /\b(?:amazing|awesome|incredible)\s+(?:work|content|course|stuff)/i, // "amazing work"
  /\bchanged\s+(?:my|how\s+I)/i, // "changed my life"
  /\b(?:big|huge)\s+fan\b/i, // "big fan"
  /\breally\s+appreciate/i, // "really appreciate"
  /\bkeep\s+(?:it\s+)?up\b/i, // "keep it up", "keep up"
  /\b(?:love|loving)\s+what\s+you(?:'re|\s+are)\s+doing/i, // "love what you're doing"
]

export function extractSignals(input: ClassifyInput): MessageSignals {
  const text = `${input.subject} ${input.body}`.toLowerCase()
  const fullText = `${input.subject} ${input.body}` // preserve case for some patterns

  // Check for genuine appreciation (not sign-offs like "Thanks,\nJohn")
  const hasGenuineAppreciation = GENUINE_APPRECIATION_PATTERNS.some((p) =>
    p.test(fullText)
  )

  return {
    hasEmailInBody: EMAIL_REGEX.test(input.body),
    hasPurchaseDate: DATE_PATTERNS.some((p) => p.test(text)),
    hasErrorMessage: ERROR_PATTERNS.some((p) => p.test(text)),
    isReply: input.subject.toLowerCase().startsWith('re:'),
    mentionsInstructor: INSTRUCTOR_NAMES.some((n) => text.includes(n)),
    hasAngrySentiment: ANGRY_PATTERNS.some((p) => p.test(text)),
    isAutomated:
      AUTOMATED_PATTERNS.some((p) => p.test(text)) ||
      (input.from ? /noreply|no-reply|mailer-daemon/i.test(input.from) : false),
    isVendorOutreach: VENDOR_PATTERNS.some((p) => p.test(text)),
    // Escalation signals
    hasLegalThreat: LEGAL_THREAT_PATTERNS.some((p) => p.test(fullText)),
    hasOutsidePolicyTimeframe: OUTSIDE_POLICY_PATTERNS.some((p) =>
      p.test(fullText)
    ),
    // Personal message to instructor requires EITHER:
    // 1. Obvious personal patterns (greeting only, lol, haha, etc.)
    // 2. Mentions instructor AND has genuine appreciation (not just "Thanks," sign-off)
    isPersonalToInstructor:
      PERSONAL_MESSAGE_PATTERNS.some((p) => p.test(fullText)) ||
      (INSTRUCTOR_NAMES.some((n) => text.includes(n)) && hasGenuineAppreciation),
  }
}

// ============================================================================
// Fast-path classification (no LLM needed)
// ============================================================================

export function fastClassify(
  input: ClassifyInput,
  signals: MessageSignals
): ClassifyOutput | null {
  const text = `${input.subject} ${input.body}`.toLowerCase()

  // Automated system messages - high confidence
  if (signals.isAutomated) {
    return {
      category: 'system',
      confidence: 0.95,
      signals,
      reasoning: 'Detected automated/system message patterns',
    }
  }

  // Vendor outreach - high confidence
  if (signals.isVendorOutreach && !signals.hasEmailInBody) {
    return {
      category: 'spam',
      confidence: 0.9,
      signals,
      reasoning: 'Detected vendor/marketing outreach patterns',
    }
  }

  // Explicit refund request
  if (/\b(?:refund|money\s+back|cancel.*purchase)\b/i.test(text)) {
    return {
      category: 'support_refund',
      confidence: 0.85,
      signals,
      reasoning: 'Explicit refund request detected',
    }
  }

  // Access issues - common patterns
  if (
    /(?:can'?t|cannot|unable to)\s+(?:access|log\s*in|sign\s*in)/i.test(text) ||
    /(?:lost|no)\s+access/i.test(text) ||
    /restore.*access/i.test(text)
  ) {
    return {
      category: 'support_access',
      confidence: 0.85,
      signals,
      reasoning: 'Access issue patterns detected',
    }
  }

  // Transfer request
  if (
    /(?:transfer|move).*(?:purchase|license|account)/i.test(text) ||
    /(?:different|wrong|change).*email/i.test(text)
  ) {
    return {
      category: 'support_transfer',
      confidence: 0.8,
      signals,
      reasoning: 'Transfer request patterns detected',
    }
  }

  // Invoice/billing
  if (/\b(?:invoice|receipt|tax\s+document|billing)\b/i.test(text)) {
    return {
      category: 'support_billing',
      confidence: 0.85,
      signals,
      reasoning: 'Billing/invoice request detected',
    }
  }

  // Fan mail - personal message to instructor
  if (
    signals.mentionsInstructor &&
    /(?:thank|love|amazing|changed my|big fan|appreciate)/i.test(text) &&
    !signals.hasEmailInBody
  ) {
    return {
      category: 'fan_mail',
      confidence: 0.75,
      signals,
      reasoning: 'Personal appreciation message to instructor',
    }
  }

  return null // Need LLM for nuanced classification
}

// ============================================================================
// LLM classification (for complex cases)
// ============================================================================

const classifySchema = z.object({
  category: z.enum([
    'support_access',
    'support_refund',
    'support_transfer',
    'support_technical',
    'support_billing',
    'fan_mail',
    'spam',
    'system',
    'unknown',
  ]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

const CLASSIFY_PROMPT = `You are a support message classifier. Categorize the incoming message.

Categories:
- support_access: Login issues, can't access purchased content, account problems
- support_refund: Wants money back, cancel purchase, refund request
- support_transfer: Move purchase to different email, license transfer
- support_technical: Questions about course content, code help, how to use product
- support_billing: Invoice request, receipt needed, tax documents, payment questions
- fan_mail: Personal thank you, appreciation, feedback directed at instructor personally
- spam: Vendor outreach, partnership proposals, marketing, SEO services
- system: Automated replies, bounces, out-of-office, system notifications
- unknown: Can't confidently categorize

Rules:
- If it's clearly a customer needing help with their purchase → support_*
- If it's addressed personally to the instructor with appreciation → fan_mail
- If it's someone trying to sell/partner → spam
- If it's automated → system
- Only use unknown if genuinely ambiguous

Output your classification with confidence (0-1) and brief reasoning.`

export async function llmClassify(
  input: ClassifyInput,
  signals: MessageSignals,
  model: string = 'anthropic/claude-haiku-4-5'
): Promise<ClassifyOutput> {
  const message = `Subject: ${input.subject}\n\nBody:\n${input.body}`

  const { object } = await generateObject({
    model,
    schema: classifySchema,
    system: CLASSIFY_PROMPT,
    prompt: message,
  })

  return {
    category: object.category as MessageCategory,
    confidence: object.confidence,
    signals,
    reasoning: object.reasoning,
  }
}

// ============================================================================
// Main classify function
// ============================================================================

export interface ClassifyOptions {
  model?: string
  forceLLM?: boolean // Skip fast-path, always use LLM
}

export async function classify(
  input: ClassifyInput,
  options: ClassifyOptions = {}
): Promise<ClassifyOutput> {
  const { model = 'anthropic/claude-haiku-4-5', forceLLM = false } = options

  // Extract signals first (always)
  const signals = extractSignals(input)

  // Try fast-path classification
  if (!forceLLM) {
    const fastResult = fastClassify(input, signals)
    if (fastResult) {
      return fastResult
    }
  }

  // Fall back to LLM
  return llmClassify(input, signals, model)
}

// ============================================================================
// Thread-aware classification (v3)
// ============================================================================

const threadClassifySchema = z.object({
  category: z.enum([
    'support_access',
    'support_refund',
    'support_transfer',
    'support_technical',
    'support_billing',
    'fan_mail',
    'spam',
    'system',
    'unknown',
    'instructor_strategy',
    'resolved',
    'awaiting_customer',
    'voc_response',
  ]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

const THREAD_CLASSIFY_PROMPT = `You are classifying a support THREAD. Analyze the full conversation to determine the category.

## Categories

**Support Categories (customer needs help):**
- support_access: Can't access purchased content, login issues, license problems
- support_refund: Wants money back. Look for: "refund", "cancel", "money back", dissatisfaction with purchase
- support_transfer: Move purchase to different email, license transfer
- support_technical: Questions about course content, code help, how-to questions
- support_billing: Invoice/receipt requests, pricing questions, discount inquiries, tax documents

**Non-Support Categories:**
- voc_response: Reply to OUR automated email sequence (check-ins, surveys). Look for quoted text from our outreach.
- fan_mail: UNSOLICITED appreciation. Customer reached out on their own to say thanks or praise.
- spam: Vendor/partnership pitch. Someone representing a COMPANY trying to sell TO us or partner.
- system: Automated notifications, bounces, password resets. No human intent.
- instructor_strategy: Instructor discussing business/content strategy (internal)
- resolved: Issue was FULLY HANDLED + customer EXPLICITLY confirmed resolution
- awaiting_customer: Our last message asked a question, waiting for reply
- unknown: Genuinely cannot categorize

## Key Distinctions (READ CAREFULLY)

### support_refund vs support_billing
- "I want a refund" → support_refund (wants money BACK)
- "Can I get an invoice?" → support_billing (wants a DOCUMENT)
- "What's your refund policy?" + unhappy context → support_refund
- "Do you have any discounts?" → support_billing (pricing question)
- Mentions "invoice" in passing during refund request → still support_refund (primary intent)

### resolved vs active support
- RESOLVED requires: (1) we helped, (2) customer CONFIRMS with phrases like "that worked", "all set", "got it"
- Polite "thanks" on a NEW request is NOT resolved
- Customer saying "thanks in advance" is NOT resolved
- 3+ message thread ending with customer confirmation → probably resolved

### voc_response vs fan_mail
- Look for QUOTED TEXT (lines with ">") from our automated emails
- Quoted automation ("What interests you about AI?") → voc_response
- NO quoted automation + genuine unsolicited praise → fan_mail
- Survey/sequence replies are voc_response even if positive

### spam vs fan_mail
- spam: "I'm [Name] from [Company]", "partnership opportunity", trying to SELL something
- fan_mail: Individual (not company), expressing gratitude or asking to BUY from us
- "Big fan" + business pitch → spam (the "fan" is a hook)
- "Big fan" + personal journey → fan_mail

## Few-Shot Examples

### Example 1: support_refund (NOT billing)
Message: "Hi, I purchased Total TypeScript last month but haven't had time to use it. I'd like to request a refund please. Thanks!"
→ support_refund (wants money back, "thanks" is politeness not resolution)

### Example 2: support_billing
Message: "Hi, can I get an invoice for my purchase? I need it for my company's records."
→ support_billing (wants document, not money back)

### Example 3: resolved
Thread: [Customer: "Can't access my course"] → [Us: "Reset your access"] → [Customer: "That worked, thanks!"]
→ resolved (explicit "worked" confirmation after our help)

### Example 4: voc_response
Message: "> What interests you about AI?\n\nI've been exploring AI tools for my workflow and really excited about the possibilities..."
→ voc_response (replying to our survey/check-in email)

### Example 5: fan_mail
Message: "Just wanted to say your TypeScript course completely changed how I think about types. Thank you so much!"
→ fan_mail (unsolicited, no quoted automation)

### Example 6: spam
Message: "Hi, I'm Sarah from ContentBoost Agency. I'd love to discuss a partnership opportunity to help grow your newsletter..."
→ spam (company representative, commercial intent)

### Example 7: NOT resolved
Thread: [Customer: "I need a refund because..."] → [Us: "Sure, processing now"]
→ support_refund (we're processing, but customer hasn't confirmed receipt)

Output your classification with confidence (0.0-1.0) and brief reasoning.`

// ============================================================================
// Spam pre-filtering patterns (rule-based, no LLM needed)
// ============================================================================

const SPAM_PATTERNS = [
  // Partnership/collaboration pitches (flexible matching)
  /\bpartnership\s*(?:opportunity|proposal|idea)?\b/i,
  /\bpaid\s+partnership\b/i,
  /\b(?:make|create|explore)\s+a\s+(?:paid\s+)?partnership\b/i,
  /\bcollaboration?\s+(?:opportunity|proposal|idea)\b/i,
  /\bwould\s+(?:you\s+)?(?:be\s+)?interested\s+in\s+(?:a\s+)?(?:partnership|collaboration|working\s+together)\b/i,
  /\breaching\s+out.*?(?:partnership|opportunity|collaboration)\b/i,
  /\b(?:collaborate|partner)\s+with\s+(?:you|your)/i,
  /\bexcited\s+to\s+(?:collaborate|partner|work\s+with)\b/i,

  // Affiliate/sponsorship offers
  /\baffiliate\s+(?:program|partnership|link|structure)\b/i,
  /\bsponsored?\s+(?:content|post|video|opportunity)\b/i,
  /\bearn\s+\d+%\s+(?:of\s+)?(?:what|every|each|for)\b/i,
  /\bcreator\s+fee\b/i,
  /\bcampaign\s+budget\b/i,
  /\bworked\s+with\s+(?:a\s+)?(?:bunch|lot|many)\s+of\s+creators\b/i,
  // Additional sponsor/collab patterns
  /\bpaid\s+collab\b/i, // "paid collab"
  /\bsponsor\b.{0,30}\b(?:content|channel|video|newsletter)\b/i, // "sponsor...content" with up to 30 chars between
  /\b(?:we'?d?\s+)?love\s+to\s+sponsor\b/i, // "we'd love to sponsor", "love to sponsor"
  /\bcollab\s+(?:proposal|opportunity)\b/i, // "collab proposal"

  // SEO/backlink spam
  /\bguest\s+post\b/i,
  /\bbacklink(?:s|ing)?\b/i,
  /\blink\s+building\b/i,
  /\bseo\s+(?:services?|optimization|agency)\b/i,

  // Influencer/marketing outreach
  /\binfluencer\s+(?:marketing|campaign|outreach|manager)\b/i,
  /\b(?:vp|director)\s+of\s+(?:gtm|growth|marketing|partnerships)\b/i,
  /\bpartnerships?\s+@\s+\w+/i, // "Partnerships @ [Company]"

  // Cold outreach patterns (follow-up spam)
  /\bi'?ve?\s+(?:been\s+)?(?:emailed?|reached\s+out|contacted).*?(?:few|couple|several)\s+times\b/i,
  /\bthis\s+will\s+be\s+my\s+last\s+follow[\s-]?up\b/i,
  /\bwanted\s+to\s+(?:follow\s+up|check\s+in)\s+once\s+more\b/i,

  // Product launches/promotions TO us (not FROM us)
  /\bwe(?:'re|\s+are)\s+launching\s+\d+\+?\s+(?:ai\s+)?products?\b/i,
  /\bkeep\s+you\s+on\s+(?:the\s+)?(?:priority|prio)\s+list\b/i,
  /\bfuture\s+campaigns?\b/i,
]

/**
 * Fast-path spam detection.
 * Catches obvious spam patterns before LLM classification.
 *
 * Strategy: Check the FIRST INBOUND message for spam patterns.
 * This catches partnership pitches even when auto-replies have been sent.
 *
 * We're conservative: only flag as spam if the INITIAL request was spam.
 * Multi-message threads where customer engaged genuinely go to LLM.
 */
function fastDetectSpam(input: ThreadClassifyInput): boolean {
  const { messages } = input

  // Find the first inbound message (the original customer/spam request)
  const firstInbound = messages.find((m) => m.direction === 'in')
  if (!firstInbound) return false

  const body = firstInbound.body

  // Check all spam patterns against the first inbound message
  if (SPAM_PATTERNS.some((p) => p.test(body))) {
    // Additional check: if thread has genuine back-and-forth engagement
    // (customer replied with substance after our response), be conservative
    const inboundCount = messages.filter((m) => m.direction === 'in').length
    const outboundCount = messages.filter((m) => m.direction === 'out').length

    // If there's real engagement (customer replied multiple times substantively)
    // and we've been responding, let LLM decide
    if (inboundCount >= 3 && outboundCount >= 2) {
      return false
    }

    return true
  }

  return false
}

/**
 * Thread-aware fast-path classification.
 *
 * Classification hierarchy:
 * 1. System messages (automated/no-reply senders)
 * 2. Spam (obvious partnership/affiliate/SEO patterns)
 * 3. Internal thread (instructor strategy)
 * 4. Resolved (customer confirmed resolution)
 * 5. Awaiting customer (human teammate asked question, waiting for reply)
 * 6. LLM classification (support_*, fan_mail, voc_response, nuanced spam)
 */
export function fastClassifyThread(
  input: ThreadClassifyInput,
  signals: ThreadSignals
): ThreadClassifyOutput | null {
  // 1. System messages - automated/no-reply senders (highest priority)
  if (signals.isAutomated && signals.threadLength === 1) {
    return {
      category: 'system',
      confidence: 0.95,
      signals,
      reasoning: 'Automated system message',
    }
  }

  // 1.5. AD tag - Front tag indicating spam/ads (no LLM needed)
  if (input.tags?.includes('AD')) {
    return {
      category: 'spam',
      confidence: 0.95,
      signals,
      reasoning: 'Tagged as AD in Front',
    }
  }

  // 2. Spam - obvious patterns (before wasting LLM on it)
  // Only for initial messages without meaningful engagement
  if (fastDetectSpam(input)) {
    return {
      category: 'spam',
      confidence: 0.9,
      signals,
      reasoning: 'Detected spam patterns (partnership/affiliate/SEO outreach)',
    }
  }

  // Also catch vendor outreach from signals (legacy pattern detection)
  if (signals.isVendorOutreach && signals.threadLength <= 2) {
    return {
      category: 'spam',
      confidence: 0.85,
      signals,
      reasoning: 'Detected vendor/marketing outreach patterns',
    }
  }

  // 3. Internal thread (instructor strategy) - based on author, not content
  if (signals.isInternalThread || signals.instructorIsAuthor) {
    return {
      category: 'instructor_strategy',
      confidence: 0.9,
      signals,
      reasoning: 'Thread is internal/instructor-initiated',
    }
  }

  // 4. Resolved thread - based on thread structure + explicit resolution phrases
  if (isThreadResolved(signals)) {
    return {
      category: 'resolved',
      confidence: 0.85,
      signals,
      reasoning: 'Customer indicated resolution (thanks + confirmation)',
    }
  }

  // 5. Thread state: awaiting_customer
  // This is state-based, not content-based - if last message was outbound, we're waiting for customer
  const lastMessage = input.messages[input.messages.length - 1]
  if (lastMessage?.direction === 'out') {
    return {
      category: 'awaiting_customer',
      confidence: 0.9,
      signals,
      reasoning: 'Last message was outbound, waiting for customer response',
    }
  }

  // 6. Everything else goes to LLM for nuanced classification
  // This includes: support_*, fan_mail, spam (ambiguous), voc_response
  return null
}

/**
 * Thread-aware LLM classification.
 */
export async function llmClassifyThread(
  input: ThreadClassifyInput,
  signals: ThreadSignals,
  model: string = 'anthropic/claude-haiku-4-5'
): Promise<ThreadClassifyOutput> {
  // Build thread context for prompt
  const threadContext = `
Thread with ${signals.threadLength} messages over ${signals.threadDurationHours.toFixed(1)} hours.
Pattern: ${signals.threadPattern}
Customer messages: ${signals.customerMessageCount}
Teammate engaged: ${signals.hasTeammateMessage ? 'Yes' : 'No'}
Instructor involved: ${signals.hasInstructorMessage ? 'Yes' : 'No'}
Last responder: ${signals.lastResponderType}
`.trim()

  // Build message history
  const messageHistory = input.messages
    .map((m, i) => {
      const author =
        m.author?.type || (m.direction === 'in' ? 'customer' : 'agent')
      return `[${i + 1}] ${author.toUpperCase()}: ${m.body.slice(0, 500)}${m.body.length > 500 ? '...' : ''}`
    })
    .join('\n\n')

  const prompt = `${threadContext}\n\n---\n\nMessages:\n${messageHistory}`

  const { object } = await generateObject({
    model,
    schema: threadClassifySchema,
    system: THREAD_CLASSIFY_PROMPT,
    prompt,
  })

  return {
    category: object.category as MessageCategory,
    confidence: object.confidence,
    signals,
    reasoning: object.reasoning,
  }
}

/**
 * Main thread classification function.
 * Uses fast-path when possible, falls back to LLM.
 */
export async function classifyThread(
  input: ThreadClassifyInput,
  options: ClassifyOptions = {}
): Promise<ThreadClassifyOutput> {
  const { model = 'anthropic/claude-haiku-4-5', forceLLM = false } = options

  // Compute thread signals
  const signals = computeThreadSignals(input)

  // Try fast-path
  if (!forceLLM) {
    const fastResult = fastClassifyThread(input, signals)
    if (fastResult) {
      return fastResult
    }
  }

  // Fall back to LLM
  return llmClassifyThread(input, signals, model)
}
