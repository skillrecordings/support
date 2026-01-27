/**
 * Step 1: CLASSIFY
 *
 * Categorizes incoming messages before any other processing.
 * Uses a combination of rules and LLM for nuanced classification.
 *
 * Memory Integration:
 * Before LLM classification, queries memory for similar past tickets
 * and their outcomes to improve classification accuracy.
 */

import { SupportMemoryService } from '@skillrecordings/memory/support-memory'
import { generateObject } from 'ai'
import { z } from 'zod'
import {
  type RelevantMemory,
  citeMemories,
  formatMemoriesCompact,
  queryMemoriesForStage,
} from '../../memory/query'
import { log, traceClassification } from '../../observability/axiom'
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

// Presales FAQ patterns - answerable with KB (pricing, curriculum, requirements, discounts)
const PRESALES_FAQ_PATTERNS = [
  /\bhow\s+much\s+(?:does|is|do|would)\b/i, // "how much does it cost"
  /\b(?:what(?:'s| is| are)?)\s+(?:the\s+)?(?:price|cost|pricing)\b/i, // "what's the price"
  /\bwhat(?:'s| is)?\s+included\b/i, // "what's included"
  /\bwhat\s+(?:do\s+)?(?:i|you)\s+(?:get|learn|cover)\b/i, // "what do I get"
  /\bcurriculum\b/i,
  /\bmodules?\b.*\b(?:cover|include|contain)\b/i, // "what modules does it cover"
  /\brequirements?\b/i, // tech requirements
  /\bprerequisites?\b/i,
  /\bppp\b/i, // purchasing power parity
  /\bstudent\s+discount\b/i,
  /\bregional\s+(?:pricing|discount)\b/i,
  /\bcoupon\b/i,
  /\bdiscount\s+(?:code|available|offer)\b/i,
  /\bis\s+(?:this|it)\s+right\s+for\s+me\b/i, // "is this right for me"
  /\bsuitable\s+for\s+(?:beginners?|intermediate|advanced)\b/i,
  /\bdo\s+(?:i|you)\s+need\s+to\s+know\b/i, // "do I need to know X"
  /\bhow\s+long\s+(?:is|does|will)\b/i, // "how long is the course"
  /\blifetime\s+access\b/i,
  /\bupdates?\s+(?:included|free)\b/i,
]

// Presales Team patterns - enterprise/team sales inquiries (escalate_human)
const PRESALES_TEAM_PATTERNS = [
  /\bteam\s+of\s+\d+\b/i, // "team of 5 developers"
  /\bcompany\s+license\b/i,
  /\bsite\s+license\b/i,
  /\benterprise\b/i,
  /\bcorporate\s+(?:license|purchase|training)\b/i,
  /\bprocurement\b/i,
  /\bpurchase\s+order\b/i,
  /\b(?:p\.?o\.?|po)\s*(?:#|number|:)/i, // "PO number", "P.O. #"
  /\binvoice\s+(?:for\s+)?(?:our\s+)?company\b/i, // company invoice context
  /\bl&d\s+(?:budget|team|department)\b/i, // L&D budget
  /\blearning\s+(?:and\s+)?development\b/i,
  /\btraining\s+budget\b/i,
  /\bvolume\s+discount\b/i,
  /\bbulk\s+(?:pricing|purchase|licenses?)\b/i,
  /\bmultiple\s+(?:seats|licenses|users)\b/i,
  /\b(?:for|across)\s+(?:my|our)\s+(?:team|department|org|organization)\b/i,
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
      (INSTRUCTOR_NAMES.some((n) => text.includes(n)) &&
        hasGenuineAppreciation),
    // Presales signals
    isPresalesFaq: PRESALES_FAQ_PATTERNS.some((p) => p.test(fullText)),
    isPresalesTeam: PRESALES_TEAM_PATTERNS.some((p) => p.test(fullText)),
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

  // Fan mail - REMOVED from fast-path.
  // Fan mail vs presales is too nuanced for regex. Messages like "I'd love to
  // learn about X" or responses to instructor outreach were over-classified as
  // fan_mail when they should be presales_consult or voc_response.
  // All potential fan_mail now goes through LLM for proper disambiguation.

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
    'presales_faq',
    'presales_consult',
    'presales_team',
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
- presales_faq: Pre-purchase questions answerable with KB (pricing, what's included, curriculum, tech requirements, discounts, PPP)
- presales_consult: Pre-purchase questions needing instructor judgment ("should I buy X or Y?", career advice tied to product, expressing interest in learning a topic)
- presales_team: Enterprise/team inquiries (team of X, company license, procurement, PO, L&D budget, volume/bulk pricing)
- fan_mail: UNSOLICITED, PURE appreciation with NO questions, NO asks, NO purchase intent. Only genuine "thank you, you changed my life" messages with zero requests.
- spam: Vendor outreach, partnership proposals, marketing, SEO services
- system: Automated replies, bounces, out-of-office, system notifications
- unknown: Can't confidently categorize

Rules:
- If it's clearly a customer needing help with their purchase → support_*
- If asking about product BEFORE purchasing → presales_*
  - Simple factual questions (price, curriculum, requirements) → presales_faq
  - "Which course should I buy?" or career advice → presales_consult
  - Expressing interest in a topic or responding to outreach → presales_consult
  - Team/enterprise/bulk inquiries → presales_team
- fan_mail is ONLY for unsolicited, pure appreciation with NOTHING else:
  - Must have NO questions (no "?", no "how do I", no "can you")
  - Must have NO purchase/learning intent (no "I want to learn", "interested in buying")
  - Must have NO response to outreach (no quoted emails, no "you asked me about")
  - Must be PURELY "thank you / you changed my life / amazing work" and nothing more
- If it's someone trying to sell/partner → spam
- If it's automated → system
- Only use unknown if genuinely ambiguous

Key disambiguation — fan_mail is RARE. When in doubt, choose presales_consult:
- "I love your content" + ANY question about learning → presales_consult, NOT fan_mail
- Response to instructor outreach email → presales_consult, NOT fan_mail
- Appreciation + "how do I buy/access/start" → presales_faq, NOT fan_mail
- "I'd love to learn about X" → presales_consult, NOT fan_mail
- Sharing what interests them about a topic → presales_consult, NOT fan_mail
- ONLY pure "thank you, you changed my life" with ZERO asks = fan_mail

Output your classification with confidence (0-1) and brief reasoning.`

export async function llmClassify(
  input: ClassifyInput,
  signals: MessageSignals,
  model: string = 'anthropic/claude-haiku-4-5',
  options: { appId?: string; runId?: string } = {}
): Promise<ClassifyOutput & { citedMemoryIds?: string[] }> {
  const message = `Subject: ${input.subject}\n\nBody:\n${input.body}`

  // Query memories for similar past classifications
  let memoryContext = ''
  let citedMemoryIds: string[] = []

  if (options.appId) {
    try {
      const memories = await queryMemoriesForStage({
        appId: options.appId,
        stage: 'classify',
        situation: message,
        limit: 5,
        threshold: 0.6,
      })

      if (memories.length > 0) {
        memoryContext = formatMemoriesCompact(memories)
        citedMemoryIds = memories.map((m) => m.id)

        await log('debug', 'classify memory query results', {
          workflow: 'pipeline',
          step: 'classify',
          appId: options.appId,
          memoriesFound: memories.length,
          topScore: memories[0]?.score ?? 0,
          memoryIds: citedMemoryIds,
        })

        // Record citation if we have a run ID
        if (options.runId && citedMemoryIds.length > 0) {
          await citeMemories(citedMemoryIds, options.runId, options.appId)
        }
      }
    } catch (error) {
      // Log but don't fail classification if memory query fails
      await log('warn', 'classify memory query failed', {
        workflow: 'pipeline',
        step: 'classify',
        appId: options.appId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Build prompt with memory context if available
  const systemPrompt = memoryContext
    ? `${memoryContext}\n\n${CLASSIFY_PROMPT}`
    : CLASSIFY_PROMPT

  const { object } = await generateObject({
    model,
    schema: classifySchema,
    system: systemPrompt,
    prompt: message,
  })

  return {
    category: object.category as MessageCategory,
    confidence: object.confidence,
    signals,
    reasoning: object.reasoning,
    citedMemoryIds: citedMemoryIds.length > 0 ? citedMemoryIds : undefined,
  }
}

// ============================================================================
// Main classify function
// ============================================================================

export interface ClassifyOptions {
  model?: string
  forceLLM?: boolean // Skip fast-path, always use LLM
  appId?: string // App ID for memory queries
  conversationId?: string // For memory citation tracking
  runId?: string // Pipeline run ID for citation tracking
}

export async function classify(
  input: ClassifyInput,
  options: ClassifyOptions = {}
): Promise<ClassifyOutput & { citedMemoryIds?: string[] }> {
  const {
    model = 'anthropic/claude-haiku-4-5',
    forceLLM = false,
    appId,
    runId,
    conversationId,
  } = options

  const startTime = Date.now()

  await log('debug', 'classify started', {
    workflow: 'pipeline',
    step: 'classify',
    appId,
    conversationId,
    messageLength: input.body.length,
    forceLLM,
  })

  // Extract signals first (always)
  const signals = extractSignals(input)

  // Try fast-path classification
  if (!forceLLM) {
    const fastResult = fastClassify(input, signals)
    if (fastResult) {
      const durationMs = Date.now() - startTime

      await log('info', 'classify completed (fast-path)', {
        workflow: 'pipeline',
        step: 'classify',
        appId,
        conversationId,
        category: fastResult.category,
        confidence: fastResult.confidence,
        reasoning: fastResult.reasoning,
        usedLLM: false,
        durationMs,
      })

      return fastResult
    }
  }

  // Fall back to LLM (with memory integration)
  const result = await llmClassify(input, signals, model, { appId, runId })

  const durationMs = Date.now() - startTime

  await log('info', 'classify completed (LLM)', {
    workflow: 'pipeline',
    step: 'classify',
    appId,
    conversationId,
    category: result.category,
    confidence: result.confidence,
    reasoning: result.reasoning,
    usedLLM: true,
    memoriesCited: result.citedMemoryIds?.length ?? 0,
    durationMs,
  })

  return result
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
    'presales_faq',
    'presales_consult',
    'presales_team',
  ]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

const THREAD_CLASSIFY_PROMPT = `You are classifying a support THREAD. Analyze the full conversation to determine the category.

## Categories

**Support Categories (customer needs help with existing purchase):**
- support_access: Can't access purchased content, login issues, license problems
- support_refund: Wants money back. Look for: "refund", "cancel", "money back", dissatisfaction with purchase
- support_transfer: Move purchase to different email, license transfer
- support_technical: Questions about course content, code help, how-to questions
- support_billing: Invoice/receipt requests, pricing questions, discount inquiries, tax documents

**Presales Categories (BEFORE purchase - no evidence of existing purchase):**
- presales_faq: Simple questions answerable with KB. Look for:
  - Pricing questions ("how much", "what's the cost")
  - "What's included?" / curriculum / modules
  - Tech requirements / prerequisites
  - PPP / student / regional discounts
  - "Is this right for me if I know X?"
  - Lifetime access, updates included
- presales_consult: Needs instructor judgment. Look for:
  - "Should I buy X or Y?"
  - "Which course is right for me?"
  - Career advice tied to product choice
  - Complex "is this suitable for my situation" questions
- presales_team: Enterprise/team sales inquiries. Look for:
  - "team of X developers/engineers"
  - "company license" / "site license"
  - "procurement" / "purchase order" / "PO"
  - "L&D budget" / "training budget"
  - "volume discount" / "bulk pricing"
  - Company domain email (not gmail/yahoo/personal)
  - Multiple seats/licenses

**Non-Support Categories:**
- voc_response: Reply to OUR automated email sequence (check-ins, surveys). Look for quoted text from our outreach.
- fan_mail: UNSOLICITED, PURE appreciation with ZERO questions, ZERO asks, ZERO purchase/learning intent. Customer reached out entirely on their own ONLY to say thanks or praise — nothing more. This is RARE.
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
- fan_mail: Individual (not company), expressing ONLY pure gratitude — no asks, no questions
- "Big fan" + business pitch → spam (the "fan" is a hook)
- "Big fan" + pure personal thanks, no asks → fan_mail

### fan_mail vs presales_consult (CRITICAL — fan_mail is over-classified)
fan_mail is RARE. Default to presales_consult when appreciation is mixed with ANY of these:
- ANY question ("?", "how do I", "can you", "where do I")
- Interest in learning ("I'd love to learn about X", "interested in AI/TypeScript/etc.")
- Response to instructor outreach (quoted email, "you asked about", "your email")
- Career/learning journey sharing ("I've been exploring", "I want to get into")
- Purchase intent ("how do I buy", "how to access", "sign up", "enroll")
- Topic engagement ("what interests me is...", "I'm excited about...")

ONLY classify as fan_mail when the message is:
1. UNSOLICITED (not replying to our outreach/survey)
2. PURE appreciation ("thank you", "you changed my life", "amazing work")
3. Contains ZERO questions or requests
4. Contains ZERO purchase/learning intent
5. The person wants NOTHING — they just want to say thanks

Examples of what is NOT fan_mail:
- "Love your content! I'd love to learn more about TypeScript" → presales_consult
- "Thanks for the email! I'm really interested in AI agents" → presales_consult (responding to outreach + topic interest)
- "Big fan of your work. How do I get started?" → presales_faq
- "Your course changed my life! Do you have anything on React?" → presales_consult
- Replying to Matt's "What interests you about AI?" email → presales_consult (response to outreach)

### fan_mail vs voc_response (outreach replies)
- If the message is replying to an automated outreach/survey email → voc_response
- If the thread contains quoted text from our email sequences → voc_response
- Even if the reply is positive/appreciative, it's voc_response if it's replying to us
- fan_mail is ONLY unsolicited — the customer initiated contact purely to give thanks

### presales_* vs support_billing
- Key question: Does the person ALREADY OWN the product?
- "How much does it cost?" with NO purchase evidence → presales_faq
- "Can I get an invoice?" from an existing customer → support_billing
- "Do you have student discounts?" BEFORE buying → presales_faq
- "Can I get a receipt for my purchase last month?" → support_billing
- Pricing questions from non-customers → presales_faq

### presales_faq vs presales_consult
- presales_faq: Factual, answerable from documentation (price, curriculum, requirements)
- presales_consult: Subjective, needs instructor judgment ("which course is right for me?")
- "What does the course cover?" → presales_faq (factual)
- "I know X, Y, Z - is this course right for me?" → could be presales_faq if simple
- "Should I buy A or B given my career goals?" → presales_consult (subjective advice)

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

### Example 5: fan_mail (PURE appreciation, no asks)
Message: "Just wanted to say your TypeScript course completely changed how I think about types. Thank you so much!"
→ fan_mail (unsolicited, PURE appreciation, no questions, no asks, no purchase intent)

### Example 5b: presales_consult (NOT fan_mail — has topic interest)
Message: "Love your work Matt! I've been getting into AI lately and would love to learn more about building agents. What interests me most is the practical side."
→ presales_consult (appreciation is present BUT combined with topic interest and learning intent — this is a potential customer, not just a thank-you)

### Example 5c: presales_consult (NOT fan_mail — response to outreach)
Message: "> What interests you about AI?\n\nHey Matt, great question! I've been exploring AI tools for my dev workflow. Really excited about agentic coding and how it changes everything."
→ presales_consult (replying to instructor outreach with topic interest — NOT fan_mail even though positive. Could also be voc_response if the outreach was automated.)

### Example 5d: presales_consult (NOT fan_mail — appreciation + learning interest)
Message: "Hi Matt, I'm a big fan of your TypeScript content. I'd love to learn about AI development. After a few AI coding projects, I'm realizing the field is changing fast."
→ presales_consult (starts with appreciation but the substance is about learning interest — this person is a potential customer)

### Example 5e: presales_faq (NOT fan_mail — appreciation + purchase question)
Message: "Love what you're doing with Total TypeScript! How do I get access to the pro bundle? Is there a student discount?"
→ presales_faq (appreciation + explicit purchase question = presales, not fan mail)

### Example 6: spam
Message: "Hi, I'm Sarah from ContentBoost Agency. I'd love to discuss a partnership opportunity to help grow your newsletter..."
→ spam (company representative, commercial intent)

### Example 7: NOT resolved
Thread: [Customer: "I need a refund because..."] → [Us: "Sure, processing now"]
→ support_refund (we're processing, but customer hasn't confirmed receipt)

### Example 8: presales_faq
Message: "Hi, I'm considering Total TypeScript. What's included in the Pro bundle? Do you offer PPP pricing for Brazil?"
→ presales_faq (factual pricing/content questions, answerable from KB)

### Example 9: presales_consult
Message: "I'm a mid-level dev trying to level up. Should I start with Total TypeScript or go straight to the advanced course? I already know some generics."
→ presales_consult (needs instructor judgment, "which course is right for me")

### Example 10: presales_team
Message: "Hi, I'm the L&D manager at Acme Corp. We have a team of 12 developers and want to purchase licenses. Do you offer volume discounts or can we pay by invoice/PO?"
→ presales_team (enterprise inquiry: team size, L&D, volume discount, PO)

### Example 11: presales_faq (NOT support_billing)
Message: "How much does the course cost? Do you have any student discounts?"
→ presales_faq (asking about pricing BEFORE purchase, not an existing customer billing issue)

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
 * Thread-aware LLM classification with memory integration.
 */
export async function llmClassifyThread(
  input: ThreadClassifyInput,
  signals: ThreadSignals,
  model: string = 'anthropic/claude-haiku-4-5',
  options: { runId?: string } = {}
): Promise<ThreadClassifyOutput & { citedMemoryIds?: string[] }> {
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

  // Query memories for similar past thread classifications
  let memoryContext = ''
  let citedMemoryIds: string[] = []

  try {
    // Use the trigger message for semantic search
    const situation = `Subject: ${input.triggerMessage.subject || ''}\n\n${input.triggerMessage.body}`

    const memories = await queryMemoriesForStage({
      appId: input.appId,
      stage: 'classify',
      situation,
      limit: 5,
      threshold: 0.6,
    })

    if (memories.length > 0) {
      memoryContext = formatMemoriesCompact(memories)
      citedMemoryIds = memories.map((m) => m.id)

      await log('debug', 'classifyThread memory query results', {
        workflow: 'pipeline',
        step: 'classifyThread',
        appId: input.appId,
        memoriesFound: memories.length,
        topScore: memories[0]?.score ?? 0,
        memoryIds: citedMemoryIds,
      })

      // Record citation if we have a run ID
      if (options.runId && citedMemoryIds.length > 0) {
        await citeMemories(citedMemoryIds, options.runId, input.appId)
      }
    }
  } catch (error) {
    // Log but don't fail classification if memory query fails
    await log('warn', 'classifyThread memory query failed', {
      workflow: 'pipeline',
      step: 'classifyThread',
      appId: input.appId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Build prompt with memory context if available
  const systemPrompt = memoryContext
    ? `${memoryContext}\n\n${THREAD_CLASSIFY_PROMPT}`
    : THREAD_CLASSIFY_PROMPT

  const prompt = `${threadContext}\n\n---\n\nMessages:\n${messageHistory}`

  const { object } = await generateObject({
    model,
    schema: threadClassifySchema,
    system: systemPrompt,
    prompt,
  })

  return {
    category: object.category as MessageCategory,
    confidence: object.confidence,
    signals,
    reasoning: object.reasoning,
    citedMemoryIds: citedMemoryIds.length > 0 ? citedMemoryIds : undefined,
  }
}

/**
 * Main thread classification function.
 * Uses fast-path when possible, falls back to LLM with memory integration.
 */
export async function classifyThread(
  input: ThreadClassifyInput,
  options: ClassifyOptions = {}
): Promise<ThreadClassifyOutput & { citedMemoryIds?: string[] }> {
  const {
    model = 'anthropic/claude-haiku-4-5',
    forceLLM = false,
    runId,
  } = options

  const startTime = Date.now()

  await log('debug', 'classifyThread started', {
    workflow: 'pipeline',
    step: 'classifyThread',
    appId: input.appId,
    threadLength: input.messages.length,
    forceLLM,
  })

  // Compute thread signals
  const signals = computeThreadSignals(input)

  // Try fast-path
  if (!forceLLM) {
    const fastResult = fastClassifyThread(input, signals)
    if (fastResult) {
      const durationMs = Date.now() - startTime

      await log('info', 'classifyThread completed (fast-path)', {
        workflow: 'pipeline',
        step: 'classifyThread',
        appId: input.appId,
        category: fastResult.category,
        confidence: fastResult.confidence,
        reasoning: fastResult.reasoning,
        usedLLM: false,
        durationMs,
      })

      return fastResult
    }
  }

  // Fall back to LLM with memory integration
  const result = await llmClassifyThread(input, signals, model, { runId })

  const durationMs = Date.now() - startTime

  await log('info', 'classifyThread completed (LLM)', {
    workflow: 'pipeline',
    step: 'classifyThread',
    appId: input.appId,
    category: result.category,
    confidence: result.confidence,
    reasoning: result.reasoning,
    usedLLM: true,
    memoriesCited: result.citedMemoryIds?.length ?? 0,
    durationMs,
  })

  return result
}

// ============================================================================
// Misclassification Learning
// ============================================================================

export interface RecordMisclassificationInput {
  /** App identifier */
  appId: string
  /** Original message subject */
  subject: string
  /** Original message body */
  body: string
  /** What the agent classified it as */
  originalCategory: MessageCategory
  /** What the human corrected it to */
  correctedCategory: MessageCategory
  /** Conversation ID for tracking */
  conversationId: string
  /** Optional: The run ID that produced the misclassification */
  runId?: string
  /** Optional: Memory IDs that were cited in the original classification */
  citedMemoryIds?: string[]
}

/**
 * Record a classification correction to memory.
 *
 * Call this when a human corrects an agent's classification.
 * Stores the mistake so future similar tickets can learn from it.
 *
 * @example
 * ```typescript
 * await recordMisclassification({
 *   appId: 'total-typescript',
 *   subject: 'Invoice needed',
 *   body: 'I need an invoice for my company...',
 *   originalCategory: 'support_access',
 *   correctedCategory: 'support_billing',
 *   conversationId: 'cnv_abc123'
 * })
 * ```
 */
export async function recordMisclassification(
  input: RecordMisclassificationInput
): Promise<void> {
  const {
    appId,
    subject,
    body,
    originalCategory,
    correctedCategory,
    conversationId,
    runId,
    citedMemoryIds,
  } = input

  const situation = `Subject: ${subject}\n\n${body}`

  // Store the misclassification as a memory for future learning
  await SupportMemoryService.store({
    app_slug: appId,
    situation,
    decision: `Classified as: ${originalCategory}`,
    stage: 'classify',
    outcome: 'corrected',
    correction: `Should have been: ${correctedCategory}`,
    category: correctedCategory,
    conversation_id: conversationId,
    tags: ['misclassification', originalCategory, correctedCategory],
  })

  // If we know which memories were cited in the failed classification,
  // record the failure outcome for those memories
  if (runId && citedMemoryIds && citedMemoryIds.length > 0) {
    try {
      await SupportMemoryService.recordCitationOutcome(
        citedMemoryIds,
        runId,
        'failure',
        appId
      )
    } catch (error) {
      console.warn(
        '[recordMisclassification] Failed to record citation outcome:',
        error
      )
    }
  }
}
