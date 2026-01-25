/**
 * Step 5: VALIDATE
 *
 * Checks draft response for quality issues before sending.
 * All checks are deterministic (no LLM) - fast and predictable.
 */

import type {
  GatherOutput,
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

export function validate(input: ValidateInput): ValidateOutput {
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
