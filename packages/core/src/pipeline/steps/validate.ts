/**
 * Step 5: VALIDATE
 *
 * Checks draft response for quality issues before sending.
 * Pattern checks are deterministic (no LLM) - fast and predictable.
 *
 * Memory Integration:
 * Before returning, queries memory for similar corrected drafts to catch
 * repeated mistakes. This is the "does this draft repeat a known mistake?" check.
 *
 * Relevance Check (LLM):
 * When the original customer message is available, uses a lightweight LLM call
 * (claude-haiku) to verify the draft actually addresses what the customer asked.
 * This prevents sending generic/off-topic responses to specific questions.
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { type RelevantMemory, queryCorrectedMemories } from '../../memory/query'
import { log } from '../../observability/axiom'
import { type RetrievedSkill, retrieveSkills } from '../../skill-retrieval'
import { getCategoryThreshold } from '../thresholds'
import type {
  GatherOutput,
  MessageCategory,
  ValidateInput,
  ValidateOutput,
  ValidationIssue,
  ValidationIssueType,
  ValidatorDecision,
} from '../types'

// ============================================================================
// Validation patterns
// ============================================================================

// Internal state leaks - system info that should never reach customers
const INTERNAL_LEAK_PATTERNS = [
  /no instructor (?:routing |teammate )?(?:configured|set up|available)/i,
  /(?:can't|cannot|unable to) route/i,
  /should (?:be |go )routed/i,
  /routing (?:failed|error|not available)/i,
  /app not found/i,
  /configuration error/i,
  /api (?:error|failure)/i,
  /tool (?:failed|error)/i,
  /database error/i,
  /falls? outside (?:my |the )?scope/i,
  /outside the scope/i,
  /You'll want to reach out through/i,

  // ── Added from forensic audit (Epic 1A) ──────────────────────────────
  // Instructor/routing system disclosure
  /(?:don't|do not) have (?:a |an )?instructor/i,
  /no instructor (?:assignment|configuration)/i,
  /(?:can't|cannot) (?:forward|assign|transfer) (?:this |it )?(?:to |directly)/i,

  // System tool/capability disclosure
  /(?:can't|cannot|unable to) use \w+(?:Tool|Instructor|Function)/i,
  /(?:in|within) (?:the|our|my) system/i,
  /internal (?:process|routing|configuration|pipeline|workflow|team|tool)/i,

  // System limitation disclosure
  /(?:not |un)?(?:configured|equipped|set up) to (?:forward|route|assign|escalate|transfer)/i,
  /(?:my|the|our) (?:tools?|capabilities|functions?|features?|system) (?:don't|do not|can't|cannot|won't|doesn't|does not)/i,

  // Business-team routing disclosure
  /(?:forwarded|routed|sent|assigned) to (?:\w+(?:'s)? )?(?:business|development|sales|marketing)[\w\s]*(?:team|department|group)/i,
  /(?:business development|dev) team or equivalent/i,

  // Routing inability disclosure
  /(?:don't|do not) have (?:a |the )?(?:way|means|method|mechanism) to (?:route|forward|send|assign)/i,
]

// Meta-commentary - agent explaining itself instead of acting
const META_COMMENTARY_PATTERNS = [
  /^This is (?:a |an )/i, // "This is a vendor email"
  /I (?:won't|will not|cannot|can't) (?:respond|draft|reply)/i,
  /I(?:'m| am) going to (?:stop|not respond)/i,
  /No (?:response|action) needed/i,
  /Per my guidelines/i,
  /is (?:clearly |obviously )?(?:not )?(?:a )?support (?:request|ticket)/i,
  /is clearly meant for/i,
  /is clearly personal/i,
  /I should not draft/i,
  /This (?:should|needs to) be (?:handled|routed|forwarded|escalated|sent|assigned)/i,
  /I'll note that/i,

  // ── Added from forensic audit (Epic 1A) ──────────────────────────────
  // Agent explaining what it's going to do instead of doing it
  /I(?:'ll| will| am going to) (?:draft|compose|write|prepare|craft|put together) (?:a |an |the )?(?:response|reply|email|message)/i,
  /^(?:Here(?:'s| is)) (?:a |my |the )?(?:draft|proposed|suggested) (?:response|reply|email|message)/i,
  /^Let me (?:draft|compose|write|prepare|craft)/i,

  // Agent describing/categorizing the email instead of responding
  /^This (?:appears|seems|looks) to be (?:a |an )/i,
  /^This (?:email|message|inquiry|conversation|thread) (?:is|appears|seems|involves|contains|relates)/i,

  // Agent referencing its own decision-making about the conversation
  /I(?:'ve| have) (?:determined|assessed|classified|categorized|evaluated|identified) (?:this|that|the (?:conversation|email|message|request))/i,
  /(?:The |This )?conversation has been (?:classified|categorized|flagged|tagged|marked)/i,

  // Agent refusing to act (expanded — existing covers "I won't respond" but not "doesn't need")
  /(?:doesn't|does not|don't|do not) (?:need|require|warrant) (?:a |my |any )?(?:response|reply|action|draft)/i,
  /I (?:don't|do not) need to (?:respond|reply|act|draft)/i,
  /This (?:isn't|is not) (?:something|a (?:case|situation|matter)) I/i,

  // Agent talking about the customer in third person instead of TO them
  /^The (?:customer|user|sender|person|individual) (?:is |has |needs |wants |seems |appears |asked |wrote |sent |mentioned |requested )/i,
  /(?:the customer(?:'s)?|the user(?:'s)?|the sender(?:'s)?) (?:question|request|inquiry|issue|concern|email|message|problem) /i,

  // Agent narrating its routing/escalation process
  /^(?:I(?:'m| am) )?(?:Flagging|Routing|Escalating|Forwarding|Sending|Passing) (?:this|it) (?:to |for |along)/i,
  /I(?:'ll| will) (?:flag|route|escalate|forward|pass) (?:this|it) (?:to |for |along)/i,

  // Categorization language — labeling the email type (not customer-facing)
  /This is (?:a |an )?(?:business|vendor|partnership|sales|marketing|outreach|fan[\s-]?mail|personal|promotional) (?:email|message|inquiry|pitch|request|outreach)/i,
  /not (?:a |an? )?(?:customer )?support (?:request|issue|ticket|question|inquiry)/i,
]

// Banned phrases - corporate speak the prompt explicitly forbids
const BANNED_PHRASES = [
  /^Great!/, // Exclamatory opener
  /I'd (?:recommend|suggest)/i, // Passive suggestions
  /I would (?:recommend|suggest)/i,
  /Is there a specific area you're curious about/i,
  /Would you like help with/i,
  /Let me know if you have any other questions/i,
  /I hope this helps/i,
  /Happy to help/i,
  /I understand/i, // Unless genuinely appropriate
  /I hear you/i,
  /I apologize for any inconvenience/i,
  /Thanks for reaching out/i,
  /Thanks for sharing/i,
  /\u2014/, // Em dash
  /—/, // Em dash (alternate encoding)
  /I don't have the ability/i,
  /Please (?:feel free to )?reach out/i,
  /Don't hesitate to/i,
]

const FABRICATION_PATTERNS = {
  price: /\$[\d,]+(?:\.\d{2})?/g,
  timeline: /within \d+ (?:hours?|days?|weeks?)/gi,
  percentage: /\d+%/g,
  guarantee: /guarantee|always|never|definitely|certainly/gi,
} as const

// Length thresholds
const MIN_RESPONSE_LENGTH = 10
const MAX_RESPONSE_LENGTH = 2000

// ============================================================================
// Individual validators
// ============================================================================

export function calculateConfidenceScore(issues: ValidationIssue[]): number {
  let score = 1.0
  for (const issue of issues) {
    switch (issue.severity) {
      case 'error':
        score -= 0.3
        break
      case 'warning':
        score -= 0.1
        break
      case 'info':
        score -= 0.02
        break
    }
  }
  return Math.max(0, score)
}

function checkInternalLeaks(draft: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const pattern of INTERNAL_LEAK_PATTERNS) {
    const match = draft.match(pattern)
    if (match) {
      issues.push({
        type: 'internal_leak',
        severity: 'error',
        message: 'Response exposes internal system state',
        match: match[0],
        position: match.index,
      })
    }
  }

  return issues
}

function checkMetaCommentary(draft: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const pattern of META_COMMENTARY_PATTERNS) {
    const match = draft.match(pattern)
    if (match) {
      issues.push({
        type: 'meta_commentary',
        severity: 'error',
        message: 'Response contains meta-commentary about agent behavior',
        match: match[0],
        position: match.index,
      })
    }
  }

  return issues
}

function checkBannedPhrases(draft: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const pattern of BANNED_PHRASES) {
    const match = draft.match(pattern)
    if (match) {
      issues.push({
        type: 'banned_phrase',
        severity: 'error',
        message: 'Response contains banned phrase',
        match: match[0],
        position: match.index,
      })
    }
  }

  return issues
}

function checkFabrication(
  draft: string,
  context: GatherOutput
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Check for fabricated course content when no knowledge was found
  // Guard against undefined context.knowledge from incomplete event data
  const hasKnowledge = (context.knowledge?.length ?? 0) > 0

  const fabricationPatterns = [
    /Start with the (?:fundamentals|basics) section/i,
    /covers? (?:core )?concepts like/i,
    /begin with (?:the )?(?:intro|introduction|basics)/i,
    /module \d+/i, // Specific module references
    /lesson \d+/i, // Specific lesson references
    /chapter \d+/i, // Specific chapter references
  ]

  if (!hasKnowledge) {
    for (const pattern of fabricationPatterns) {
      const match = draft.match(pattern)
      if (match) {
        issues.push({
          type: 'fabrication',
          severity: 'error',
          message:
            'Response references course content without knowledge base support',
          match: match[0],
          position: match.index,
        })
      }
    }
  }

  return issues
}

type ClaimType = keyof typeof FABRICATION_PATTERNS

interface Claim {
  type: ClaimType
  value: string
  index?: number
}

function stripQuotedText(draft: string): string {
  const lines = draft.split(/\r?\n/)
  const keptLines: string[] = []

  for (const line of lines) {
    if (/^On .+ wrote:$/i.test(line.trim())) {
      break
    }

    if (/^\s*>/.test(line)) {
      continue
    }

    keptLines.push(line)
  }

  const keptText = keptLines.join('\n')

  return keptText.replace(
    /(customer|you)\s+(?:said|wrote|mentioned|stated|shared|quoted)[:\s]*"[^"]+"/gi,
    (match) => match.replace(/"[^"]+"/g, '')
  )
}

function extractClaims(draft: string): Claim[] {
  const claims: Claim[] = []
  for (const [type, pattern] of Object.entries(FABRICATION_PATTERNS)) {
    const matches = draft.matchAll(pattern)
    for (const match of matches) {
      claims.push({
        type: type as ClaimType,
        value: match[0],
        index: match.index,
      })
    }
  }
  return claims
}

function checkClaimAgainstSkills(
  claim: Claim,
  skills: RetrievedSkill[]
): boolean {
  const claimValue = claim.value.toLowerCase()
  for (const skill of skills) {
    const description = skill.description?.toLowerCase() ?? ''
    const markdown = skill.markdown?.toLowerCase() ?? ''
    if (description.includes(claimValue) || markdown.includes(claimValue)) {
      return true
    }
  }
  return false
}

function checkFabricatedClaims(
  draft: string,
  skills: RetrievedSkill[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cleanedDraft = stripQuotedText(draft)
  const claims = extractClaims(cleanedDraft)

  for (const claim of claims) {
    const isSourced = checkClaimAgainstSkills(claim, skills)
    if (!isSourced) {
      issues.push({
        type: 'fabrication',
        severity: claim.type === 'price' ? 'error' : 'warning',
        message: `Unsourced ${claim.type} claim: ${claim.value}`,
        match: claim.value,
        position: claim.index,
      })
    }
  }

  return issues
}

function checkLength(draft: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (draft.length < MIN_RESPONSE_LENGTH) {
    issues.push({
      type: 'too_short',
      severity: 'warning',
      message: `Response too short (${draft.length} chars, min ${MIN_RESPONSE_LENGTH})`,
    })
  }

  if (draft.length > MAX_RESPONSE_LENGTH) {
    issues.push({
      type: 'too_long',
      severity: 'warning',
      message: `Response too long (${draft.length} chars, max ${MAX_RESPONSE_LENGTH})`,
    })
  }

  return issues
}

// ============================================================================
// Relevance check (LLM-based)
// ============================================================================

const relevanceSchema = z.object({
  relevant: z
    .boolean()
    .describe('Whether the draft response addresses the customer message'),
  score: z.coerce
    .number()
    .finite()
    .min(0)
    .max(1)
    .describe(
      'Relevance score from 0 (completely off-topic) to 1 (directly addresses the question)'
    ),
  reasoning: z
    .string()
    .describe('Brief explanation of the relevance assessment'),
})

const RELEVANCE_CHECK_PROMPT = `You are a quality assurance checker for customer support responses.

Your job: determine whether the draft response actually addresses what the customer asked.

Flag as NOT relevant if the draft:
- Is generic/templated when the customer asked a specific question
- Is off-topic or clearly not responding to what was asked
- Refers to missing or empty content (e.g., "I notice your message came through without a subject line" when the customer clearly wrote something)
- Provides a canned greeting without addressing the actual question
- Answers a completely different question than what was asked

Flag as relevant if the draft:
- Directly addresses the customer's question or concern
- Acknowledges and responds to the specific topic raised
- Even if imperfect, is clearly attempting to address the right topic

Be practical — a response doesn't need to be perfect, just on-topic.`

/**
 * Check if the draft response is relevant to the customer's message.
 * Uses a lightweight LLM call (claude-haiku) for semantic understanding.
 * Only runs when the customer message body is non-empty.
 */
async function checkRelevance(
  draft: string,
  customerMessage: { subject: string; body: string },
  model: string = 'anthropic/claude-sonnet-4-5'
): Promise<{ issues: ValidationIssue[]; score: number }> {
  const customerText = [
    customerMessage.subject ? `Subject: ${customerMessage.subject}` : '',
    customerMessage.body ? `Body: ${customerMessage.body}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `Customer message:
${customerText}

Draft response:
${draft}

Is this draft response relevant to what the customer asked?`

  const { object } = await generateObject({
    model,
    schema: relevanceSchema,
    system: RELEVANCE_CHECK_PROMPT,
    prompt,
  })

  const issues: ValidationIssue[] = []

  if (!object.relevant || object.score < 0.5) {
    issues.push({
      type: 'relevance',
      severity: 'error',
      message: `Draft does not address the customer's message: ${object.reasoning}`,
    })
  }

  return { issues, score: object.score }
}

// ============================================================================
// Audience awareness check (LLM-based)
// ============================================================================

const audienceAwarenessSchema = z.object({
  appropriate: z
    .boolean()
    .describe('Whether the draft uses customer-appropriate language'),
  issues: z
    .array(
      z.object({
        type: z
          .enum([
            'technical_jargon',
            'internal_reference',
            'confusing_language',
            'inappropriate_tone',
          ])
          .describe('Type of audience issue'),
        phrase: z.string().describe('The problematic phrase or term'),
        suggestion: z.string().optional().describe('Suggested alternative'),
      })
    )
    .describe('List of audience-inappropriate issues found'),
  reasoning: z
    .string()
    .describe('Brief explanation of the audience assessment'),
})

const AUDIENCE_AWARENESS_PROMPT = `You are a quality assurance checker for customer support responses.

Your job: determine whether the draft response uses appropriate language for customers.

Flag as NOT appropriate if the draft:
- Uses technical jargon without explanation (API, webhook, OAuth, endpoint, etc.)
- References internal tools or processes (Stripe dashboard, Intercom, internal tickets, etc.)
- Uses confusing or ambiguous language that a typical customer wouldn't understand
- Has an inappropriate tone (condescending, overly casual, cold, etc.)

Flag as appropriate if the draft:
- Uses plain, everyday language
- Explains technical concepts when necessary
- Focuses on helping the customer, not internal processes
- Maintains a warm, professional tone

Be practical — some technical terms (like "browser" or "login") are fine. Flag only terms that typical customers wouldn't know.`

/**
 * Check if the draft uses customer-appropriate language.
 * Uses an LLM call to detect jargon, internal references, and tone issues.
 */
async function checkAudienceAwareness(
  draft: string,
  model: string = 'anthropic/claude-sonnet-4-5'
): Promise<ValidationIssue[]> {
  const prompt = `Draft response to customer:
${draft}

Is this draft appropriate for a typical customer? Check for technical jargon, internal references, and tone.`

  const { object } = await generateObject({
    model,
    schema: audienceAwarenessSchema,
    system: AUDIENCE_AWARENESS_PROMPT,
    prompt,
  })

  const issues: ValidationIssue[] = []

  if (!object.appropriate && object.issues.length > 0) {
    for (const issue of object.issues) {
      issues.push({
        type: 'audience_inappropriate',
        severity: 'warning',
        message: `Draft contains ${issue.type.replace('_', ' ')}: "${issue.phrase}"${issue.suggestion ? ` (consider: "${issue.suggestion}")` : ''}`,
        match: issue.phrase,
      })
    }
  }

  return issues
}

// ============================================================================
// Tool failure check
// ============================================================================

/** Critical tools that must succeed for certain categories */
const CRITICAL_TOOLS_BY_CATEGORY: Record<string, string[]> = {
  support_refund: ['user', 'purchases'],
  support_access: ['user'],
  support_billing: ['user', 'purchases'],
  support_transfer: ['user', 'purchases'],
}

/**
 * Check if critical gather tools failed for this category.
 * Returns an escalation decision if critical tools are unavailable.
 */
function checkToolFailures(
  gatherErrors: Array<{ step: string; error: string }> | undefined,
  category: MessageCategory | undefined
): { shouldEscalate: boolean; reason: string } {
  // Guard against undefined gatherErrors from incomplete event data
  if (!gatherErrors || gatherErrors.length === 0) {
    return { shouldEscalate: false, reason: '' }
  }

  const criticalTools = category
    ? (CRITICAL_TOOLS_BY_CATEGORY[category] ?? ['user'])
    : ['user']

  const failedCriticalTools = gatherErrors
    .filter((e) => criticalTools.includes(e.step))
    .map((e) => e.step)

  if (failedCriticalTools.length > 0) {
    return {
      shouldEscalate: true,
      reason: `System unable to verify customer - manual lookup needed (failed: ${failedCriticalTools.join(', ')})`,
    }
  }

  return { shouldEscalate: false, reason: '' }
}

// ============================================================================
// Ground truth comparison (skill retrieval)
// ============================================================================

function extractRefundDays(text: string): number[] {
  if (!/refund/i.test(text)) return []

  const matches = text.matchAll(/(\d{1,3})\s*[- ]?\s*day(?:s)?/gi)
  const days: number[] = []
  for (const match of matches) {
    const value = Number(match[1])
    if (!Number.isNaN(value)) {
      days.push(value)
    }
  }

  return days
}

function checkGroundTruth(
  draft: string,
  skills: RetrievedSkill[]
): ValidationIssue[] {
  if (skills.length === 0) return []

  const draftDays = extractRefundDays(draft)
  if (draftDays.length === 0) return []

  const skillDays = skills.flatMap((skill) => {
    const skillText = [skill.name, skill.description, skill.markdown].filter(
      Boolean
    )
    return extractRefundDays(skillText.join('\n'))
  })

  const uniqueSkillDays = Array.from(new Set(skillDays))
  if (uniqueSkillDays.length === 0) return []

  const uniqueDraftDays = Array.from(new Set(draftDays))
  const mismatchedDays = uniqueDraftDays.filter(
    (day) => !uniqueSkillDays.includes(day)
  )

  if (mismatchedDays.length === 0) return []

  return [
    {
      type: 'ground_truth_mismatch',
      severity: 'error',
      message: `Draft refund timeframe (${mismatchedDays.join(
        ', '
      )} days) conflicts with ground truth (${uniqueSkillDays.join(', ')} days)`,
      match: `draft:${mismatchedDays.join(', ')} skill:${uniqueSkillDays.join(
        ', '
      )}`,
    },
  ]
}

// ============================================================================
// Main validate function
// ============================================================================

/**
 * Options for memory-enhanced validation
 */
export interface ValidateOptions {
  /** App ID for memory lookup */
  appId?: string
  /** Category of the support request (for more targeted memory queries) */
  category?: MessageCategory
  /** Optional category stats provider (primarily for testing) */
  getCategoryStats?: (category?: MessageCategory) => Promise<CategoryStats>
  /** Skip memory query (for testing or when memory service unavailable) */
  skipMemoryQuery?: boolean
  /** Similarity threshold for matching corrections (default: 0.7) */
  correctionThreshold?: number
  /** Skip relevance check (for testing or when LLM unavailable) */
  skipRelevanceCheck?: boolean
  /** Model to use for relevance check (default: 'anthropic/claude-sonnet-4-5') */
  relevanceModel?: string
  /** Check if draft uses customer-appropriate language (default: false) */
  checkAudienceAwareness?: boolean
}

/**
 * Extended validation result with memory context
 */
export interface ValidateResult extends ValidateOutput {
  /** Corrections that were checked against */
  correctionsChecked?: RelevantMemory[]
  /** Whether memory check was performed */
  memoryCheckPerformed: boolean
  /** Whether relevance check was performed */
  relevanceCheckPerformed: boolean
}

export interface CategoryStats {
  sentUnchangedRate: number
  volume: number
}

export async function getCategoryStats(
  _category?: MessageCategory
): Promise<CategoryStats> {
  return {
    sentUnchangedRate: 0,
    volume: 0,
  }
}

/**
 * Synchronous validation - pattern checks only, no memory lookup.
 * Use this for fast, deterministic validation when memory isn't needed.
 */
export function validateSync(input: ValidateInput): ValidateOutput {
  const { draft, context, strictMode = false } = input

  const allIssues: ValidationIssue[] = [
    ...checkInternalLeaks(draft),
    ...checkMetaCommentary(draft),
    ...checkBannedPhrases(draft),
    ...checkFabrication(draft, context),
    ...checkLength(draft),
  ]

  // In strict mode, warnings are errors
  const issues = strictMode
    ? allIssues
    : allIssues.filter((i) => i.severity === 'error')

  const hasErrors = allIssues.some((i) => i.severity === 'error')

  return {
    valid: !hasErrors,
    issues: allIssues,
    suggestion: hasErrors
      ? 'Response has quality issues that would be visible to customers'
      : undefined,
  }
}

/**
 * Full validation with memory integration.
 * Queries memory for similar corrected drafts to catch repeated mistakes.
 *
 * @example
 * ```typescript
 * const result = await validate(
 *   { draft, context },
 *   { appId: 'total-typescript', category: 'support_refund' }
 * )
 *
 * if (!result.valid) {
 *   console.log('Issues:', result.issues)
 *   console.log('Corrections checked:', result.correctionsChecked?.length)
 * }
 * ```
 */
export async function validate(
  input: ValidateInput,
  options: ValidateOptions = {}
): Promise<ValidateResult & ValidatorDecision> {
  const { draft, context, strictMode = false, customerMessage } = input
  const {
    appId,
    category,
    getCategoryStats: getCategoryStatsOverride,
    skipMemoryQuery = false,
    correctionThreshold = 0.7,
    skipRelevanceCheck = false,
    relevanceModel = 'anthropic/claude-sonnet-4-5',
    checkAudienceAwareness: shouldCheckAudience = false,
  } = options

  const startTime = Date.now()

  await log('debug', 'validate started', {
    workflow: 'pipeline',
    step: 'validate',
    appId,
    category,
    draftLength: draft.length,
    strictMode,
    skipMemoryQuery,
  })

  // Start with synchronous pattern checks
  const allIssues: ValidationIssue[] = [
    ...checkInternalLeaks(draft),
    ...checkMetaCommentary(draft),
    ...checkBannedPhrases(draft),
    ...checkFabrication(draft, context),
    ...checkLength(draft),
  ]

  const patternIssueCount = allIssues.length

  // ─────────────────────────────────────────────────────────────────────────
  // Ground Truth: Retrieve skills and compare draft against known info
  // ─────────────────────────────────────────────────────────────────────────
  const skillQuery =
    input.originalMessage ??
    customerMessage?.body ??
    customerMessage?.subject ??
    draft

  let relevantSkills: RetrievedSkill[] = []

  if (skillQuery.trim().length > 0) {
    try {
      relevantSkills = await retrieveSkills(skillQuery, { topK: 3 })
      allIssues.push(...checkGroundTruth(draft, relevantSkills))
      allIssues.push(...checkFabricatedClaims(draft, relevantSkills))
    } catch (error) {
      await log('warn', 'ground truth skill retrieval failed', {
        workflow: 'pipeline',
        step: 'validate',
        appId,
        category,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  let correctionsChecked: RelevantMemory[] | undefined
  let memoryCheckPerformed = false

  // ─────────────────────────────────────────────────────────────────────────
  // Memory Check: Does this draft repeat a known mistake?
  // ─────────────────────────────────────────────────────────────────────────
  if (!skipMemoryQuery && appId) {
    try {
      // Build situation context for memory query
      const situation = buildValidationSituation(category, draft)

      // Query specifically for corrected memories (mistakes we've learned from)
      const corrections = await queryCorrectedMemories({
        appId,
        situation,
        stage: 'draft',
        limit: 5,
      })

      memoryCheckPerformed = true
      correctionsChecked = corrections

      if (corrections.length > 0) {
        await log('debug', 'validate memory corrections found', {
          workflow: 'pipeline',
          step: 'validate',
          appId,
          category,
          correctionsFound: corrections.length,
          topScore: corrections[0]?.score ?? 0,
        })
      }

      // Check if current draft repeats any known mistakes
      if (corrections.length > 0) {
        const memoryIssues = await checkAgainstCorrections(
          draft,
          corrections,
          correctionThreshold
        )
        allIssues.push(...memoryIssues)
      }
    } catch (error) {
      // Memory query failed - log but don't fail validation
      await log('warn', 'validate memory query failed', {
        workflow: 'pipeline',
        step: 'validate',
        appId,
        category,
        error: error instanceof Error ? error.message : String(error),
      })
      memoryCheckPerformed = false
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Relevance Check: Does this draft actually address the customer's message?
  // ─────────────────────────────────────────────────────────────────────────
  let relevanceScore: number | undefined
  let relevanceCheckPerformed = false

  const hasCustomerBody =
    customerMessage?.body && customerMessage.body.trim().length > 0

  if (skipRelevanceCheck) {
    await log('debug', 'relevance check skipped (skipRelevanceCheck=true)', {
      workflow: 'pipeline',
      step: 'validate',
      appId,
      category,
    })
  } else if (!customerMessage) {
    await log(
      'warn',
      'relevance check skipped (customerMessage not provided)',
      {
        workflow: 'pipeline',
        step: 'validate',
        appId,
        category,
      }
    )
  } else if (!hasCustomerBody) {
    await log('debug', 'relevance check skipped (empty customer body)', {
      workflow: 'pipeline',
      step: 'validate',
      appId,
      category,
      customerSubjectLength: customerMessage.subject?.length ?? 0,
      customerBodyLength: customerMessage.body?.length ?? 0,
    })
  }

  if (!skipRelevanceCheck && hasCustomerBody && customerMessage) {
    try {
      await log('info', 'relevance check starting', {
        workflow: 'pipeline',
        step: 'validate',
        appId,
        category,
        customerMessageLength:
          (customerMessage.subject?.length ?? 0) +
          (customerMessage.body?.length ?? 0),
        draftLength: draft.length,
        relevanceModel,
      })

      const relevanceResult = await checkRelevance(
        draft,
        customerMessage,
        relevanceModel
      )
      relevanceCheckPerformed = true
      relevanceScore = relevanceResult.score
      allIssues.push(...relevanceResult.issues)

      await log('info', 'relevance check completed', {
        workflow: 'pipeline',
        step: 'validate',
        appId,
        category,
        relevanceScore: relevanceResult.score,
        relevanceIssues: relevanceResult.issues.length,
        relevant: relevanceResult.score >= 0.5,
      })
    } catch (error) {
      // Relevance check failed - log but don't fail validation
      await log('warn', 'relevance check failed', {
        workflow: 'pipeline',
        step: 'validate',
        appId,
        category,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        relevanceModel,
      })
      relevanceCheckPerformed = false
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Audience Awareness Check: Is this draft customer-appropriate?
  // ─────────────────────────────────────────────────────────────────────────
  let audienceCheckPerformed = false

  if (shouldCheckAudience) {
    try {
      await log('info', 'audience awareness check starting', {
        workflow: 'pipeline',
        step: 'validate',
        appId,
        category,
        draftLength: draft.length,
      })

      const audienceIssues = await checkAudienceAwareness(draft, relevanceModel)
      audienceCheckPerformed = true
      allIssues.push(...audienceIssues)

      await log('info', 'audience awareness check completed', {
        workflow: 'pipeline',
        step: 'validate',
        appId,
        category,
        audienceIssues: audienceIssues.length,
        appropriate: audienceIssues.length === 0,
      })
    } catch (error) {
      await log('warn', 'audience awareness check failed', {
        workflow: 'pipeline',
        step: 'validate',
        appId,
        category,
        error: error instanceof Error ? error.message : String(error),
      })
      audienceCheckPerformed = false
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool Failure Check: Did critical gather tools fail?
  // ─────────────────────────────────────────────────────────────────────────
  const toolFailureResult = checkToolFailures(context.gatherErrors, category)

  // In strict mode, warnings are errors
  const hasErrors = allIssues.some((i) => i.severity === 'error')
  const confidence = calculateConfidenceScore(allIssues)
  const threshold = getCategoryThreshold(category)

  const durationMs = Date.now() - startTime

  // Group issues by type for logging
  const issuesByType: Record<string, number> = {}
  for (const issue of allIssues) {
    issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1
  }

  const escalationKeyword = threshold.escalateOnKeywords?.find((keyword) => {
    const haystack = [
      input.originalMessage,
      customerMessage?.subject,
      customerMessage?.body,
      draft,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase()
    return haystack.includes(keyword.toLowerCase())
  })

  let decision: ValidatorDecision = {
    action: 'draft',
    draft,
    issues: allIssues,
  }

  // Tool failure check takes priority — if critical tools failed, escalate
  if (toolFailureResult.shouldEscalate) {
    decision = {
      action: 'escalate',
      reason: toolFailureResult.reason,
      urgency: 'normal',
    }
  } else if (threshold.escalateAlways) {
    decision = {
      action: 'escalate',
      reason: 'Category requires human review',
      urgency: 'normal',
    }
  } else if (escalationKeyword) {
    decision = {
      action: 'escalate',
      reason: `Escalation keyword detected: ${escalationKeyword}`,
      urgency: 'high',
    }
  } else {
    const categoryStats = await (getCategoryStatsOverride ?? getCategoryStats)(
      category
    )
    const meetsAutoSend =
      categoryStats.sentUnchangedRate >= threshold.autoSendMinConfidence &&
      categoryStats.volume >= threshold.autoSendMinVolume &&
      confidence >= 0.95

    if (meetsAutoSend) {
      decision = {
        action: 'auto-send',
        draft,
        confidence,
      }
    } else if (!hasErrors && allIssues.length > 0) {
      decision = {
        action: 'needs-review',
        draft,
        concerns: allIssues.map((issue) => issue.message),
      }
    }
  }

  // High-cardinality decision-point logging
  await log('info', 'validate:decision', {
    workflow: 'pipeline',
    step: 'validate',
    appId,
    category,
    // Decision outcome
    valid: !hasErrors,
    action: decision.action,
    confidence,
    // Issue breakdown
    totalIssues: allIssues.length,
    errorCount: allIssues.filter((i) => i.severity === 'error').length,
    warningCount: allIssues.filter((i) => i.severity === 'warning').length,
    infoCount: allIssues.filter((i) => i.severity === 'info').length,
    // Issue types detected
    issuesByType,
    hasInternalLeak: (issuesByType['internal_leak'] ?? 0) > 0,
    hasMetaCommentary: (issuesByType['meta_commentary'] ?? 0) > 0,
    hasBannedPhrase: (issuesByType['banned_phrase'] ?? 0) > 0,
    hasFabrication: (issuesByType['fabrication'] ?? 0) > 0,
    hasGroundTruthMismatch: (issuesByType['ground_truth_mismatch'] ?? 0) > 0,
    hasRepeatedMistake: (issuesByType['repeated_mistake'] ?? 0) > 0,
    hasRelevanceIssue: (issuesByType['relevance'] ?? 0) > 0,
    hasAudienceIssue: (issuesByType['audience_inappropriate'] ?? 0) > 0,
    // Validation checks performed
    patternCheckCount: patternIssueCount,
    memoryCheckPerformed,
    relevanceCheckPerformed,
    audienceCheckPerformed,
    groundTruthCheckPerformed: relevantSkills.length > 0,
    // Tool failure check
    toolFailureEscalation: toolFailureResult.shouldEscalate,
    toolFailureReason: toolFailureResult.reason || null,
    gatherErrorCount: context.gatherErrors?.length ?? 0,
    gatherErrorSteps: context.gatherErrors?.map((e) => e.step) ?? [],
    // Relevance details
    relevanceScore,
    relevanceThreshold: 0.5,
    relevancePassed: relevanceScore === undefined || relevanceScore >= 0.5,
    // Memory correction check
    correctionsChecked: correctionsChecked?.length ?? 0,
    correctionThreshold,
    // Threshold configuration
    decisionThreshold: threshold,
    escalateAlways: threshold.escalateAlways,
    escalationKeywordMatched: escalationKeyword ?? null,
    autoSendEligible: confidence >= 0.95,
    // Ground truth
    skillsRetrieved: relevantSkills.length,
    // Decision explanation
    strictMode,
    durationMs,
  })

  return {
    ...decision,
    valid: !hasErrors,
    issues: allIssues,
    suggestion: hasErrors
      ? 'Response has quality issues that would be visible to customers'
      : undefined,
    relevance: relevanceScore,
    correctionsChecked,
    memoryCheckPerformed,
    relevanceCheckPerformed,
  }
}

/**
 * Build a situation string for memory query from validation context.
 */
function buildValidationSituation(
  category: MessageCategory | undefined,
  draft: string
): string {
  const parts: string[] = []

  if (category) {
    parts.push(`Category: ${category}`)
  }

  // Include draft content (truncated for query efficiency)
  const draftPreview = draft.slice(0, 300)
  parts.push(`Draft: ${draftPreview}`)

  return parts.join('\n')
}

/**
 * Check if draft content matches any known corrections.
 * Uses text similarity to detect potential repeated mistakes.
 */
async function checkAgainstCorrections(
  draft: string,
  corrections: RelevantMemory[],
  threshold: number
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []

  for (const correction of corrections) {
    // Only flag if similarity is above threshold AND score is high
    // (high score means the situation is very similar)
    if (correction.score >= threshold) {
      // Check if draft contains similar problematic patterns
      const similarity = textSimilarity(draft, correction.decision)

      if (similarity >= 0.6) {
        // Draft is similar to a known bad decision
        issues.push({
          type: 'repeated_mistake',
          severity: 'error',
          message: `Draft may repeat a previously corrected mistake`,
          match: correction.correction
            ? `Previously corrected: ${truncate(correction.correction, 100)}`
            : `Similar to failed draft (${Math.round(correction.score * 100)}% match)`,
        })
      }
    }
  }

  return issues
}

/**
 * Simple text similarity using Jaccard coefficient on word sets.
 * Good enough for detecting if two texts cover similar content.
 */
function textSimilarity(text1: string, text2: string): number {
  const normalize = (text: string): string[] => {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2)
  }

  const words1 = normalize(text1)
  const words2 = normalize(text2)

  if (words1.length === 0 || words2.length === 0) return 0

  const set1 = new Set(words1)
  const set2 = new Set(words2)

  // Count intersection
  let intersectionCount = 0
  for (const word of words1) {
    if (set2.has(word)) {
      intersectionCount++
      set2.delete(word) // Avoid double counting
    }
  }

  // Union size = set1 size + remaining set2 size
  const unionSize = set1.size + set2.size

  return intersectionCount / unionSize
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

// ============================================================================
// Helpers
// ============================================================================

export function getIssuesByType(
  issues: ValidationIssue[],
  type: ValidationIssueType
): ValidationIssue[] {
  return issues.filter((i) => i.type === type)
}

export function hasIssueType(
  issues: ValidationIssue[],
  type: ValidationIssueType
): boolean {
  return issues.some((i) => i.type === type)
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .map(
      (i) =>
        `[${i.severity.toUpperCase()}] ${i.type}: ${i.message}${i.match ? ` ("${i.match}")` : ''}`
    )
    .join('\n')
}

// ============================================================================
// Pattern management (for customization)
// ============================================================================

export function addBannedPhrase(pattern: RegExp): void {
  BANNED_PHRASES.push(pattern)
}

export function addInternalLeakPattern(pattern: RegExp): void {
  INTERNAL_LEAK_PATTERNS.push(pattern)
}

export function addMetaCommentaryPattern(pattern: RegExp): void {
  META_COMMENTARY_PATTERNS.push(pattern)
}
