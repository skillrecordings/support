/**
 * Step 5: VALIDATE
 *
 * Checks draft response for quality issues before sending.
 * All checks are deterministic (no LLM) - fast and predictable.
 *
 * Memory Integration:
 * Before returning, queries memory for similar corrected drafts to catch
 * repeated mistakes. This is the "does this draft repeat a known mistake?" check.
 */

import { type RelevantMemory, queryCorrectedMemories } from '../../memory/query'
import { log } from '../../observability/axiom'
import type {
  GatherOutput,
  MessageCategory,
  ValidateInput,
  ValidateOutput,
  ValidationIssue,
  ValidationIssueType,
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
  /This (?:should|needs to) be (?:handled|routed)/i,
  /I'll note that/i,
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

// Length thresholds
const MIN_RESPONSE_LENGTH = 10
const MAX_RESPONSE_LENGTH = 2000

// ============================================================================
// Individual validators
// ============================================================================

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
  const hasKnowledge = context.knowledge.length > 0

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
  /** Skip memory query (for testing or when memory service unavailable) */
  skipMemoryQuery?: boolean
  /** Similarity threshold for matching corrections (default: 0.7) */
  correctionThreshold?: number
}

/**
 * Extended validation result with memory context
 */
export interface ValidateResult extends ValidateOutput {
  /** Corrections that were checked against */
  correctionsChecked?: RelevantMemory[]
  /** Whether memory check was performed */
  memoryCheckPerformed: boolean
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
): Promise<ValidateResult> {
  const { draft, context, strictMode = false } = input
  const {
    appId,
    category,
    skipMemoryQuery = false,
    correctionThreshold = 0.7,
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

  // In strict mode, warnings are errors
  const hasErrors = allIssues.some((i) => i.severity === 'error')

  const durationMs = Date.now() - startTime

  // Group issues by type for logging
  const issuesByType: Record<string, number> = {}
  for (const issue of allIssues) {
    issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1
  }

  await log('info', 'validate completed', {
    workflow: 'pipeline',
    step: 'validate',
    appId,
    category,
    valid: !hasErrors,
    totalIssues: allIssues.length,
    patternIssues: patternIssueCount,
    memoryIssues: allIssues.length - patternIssueCount,
    issuesByType,
    memoryCheckPerformed,
    correctionsChecked: correctionsChecked?.length ?? 0,
    durationMs,
  })

  return {
    valid: !hasErrors,
    issues: allIssues,
    suggestion: hasErrors
      ? 'Response has quality issues that would be visible to customers'
      : undefined,
    correctionsChecked,
    memoryCheckPerformed,
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
