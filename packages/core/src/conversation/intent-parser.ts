/**
 * Intent Parser for comment commands
 *
 * Parses natural language text to identify user intent:
 * - approve: user wants to send/approve a draft
 * - hold: user wants to delay/snooze
 * - edit: user wants to modify content
 * - unknown: intent could not be determined
 */

import { z } from 'zod'

// Intent types
export const IntentType = z.enum(['approve', 'hold', 'edit', 'unknown'])
export type IntentType = z.infer<typeof IntentType>

// Parameters for each intent type
export interface ApproveParams {
  type: 'approve'
}

export interface HoldParams {
  type: 'hold'
  until?: string // e.g., "Monday", "tomorrow", "2h"
  duration?: string // normalized: "2h", "1d", etc.
}

export interface EditParams {
  type: 'edit'
  instruction: string // the edit instruction
  target?: string // what to change (if specified)
  replacement?: string // what to change it to (if specified)
}

export interface UnknownParams {
  type: 'unknown'
  raw: string
}

export type IntentParams =
  | ApproveParams
  | HoldParams
  | EditParams
  | UnknownParams

export interface IntentResult {
  type: IntentType
  confidence: number // 0-1
  parameters: IntentParams
}

// Pattern definitions with confidence scores
interface Pattern {
  regex: RegExp
  type: IntentType
  confidence: number
  extractParams?: (
    match: RegExpMatchArray,
    text: string
  ) => Partial<IntentParams>
}

// Approve patterns - highest confidence for explicit commands
const APPROVE_PATTERNS: Pattern[] = [
  // Explicit send commands
  { regex: /^send\s*(it|this)?$/i, type: 'approve', confidence: 0.95 },
  { regex: /^(just\s+)?send$/i, type: 'approve', confidence: 0.95 },
  { regex: /^go\s*ahead(\s+and\s+send)?$/i, type: 'approve', confidence: 0.9 },
  { regex: /^ship\s*(it)?$/i, type: 'approve', confidence: 0.9 },

  // Approval expressions
  { regex: /^lgtm\.?$/i, type: 'approve', confidence: 0.95 },
  {
    regex: /^looks\s+good(\s+to\s+me)?\.?$/i,
    type: 'approve',
    confidence: 0.9,
  },
  {
    regex: /^(this\s+)?(looks\s+)?perfect\.?$/i,
    type: 'approve',
    confidence: 0.85,
  },
  { regex: /^approved?\.?$/i, type: 'approve', confidence: 0.95 },

  // Affirmative with context
  {
    regex: /^(yes|yeah|yep|yup|sure|ok|okay),?\s*(send|ship|go)/i,
    type: 'approve',
    confidence: 0.9,
  },
  { regex: /^(yes|yeah|yep|yup)\.?$/i, type: 'approve', confidence: 0.7 },

  // Thumbs up style
  { regex: /^(👍|✅|✔️?|💯)$/i, type: 'approve', confidence: 0.85 },
]

// Hold patterns - extract timing info
const HOLD_PATTERNS: Pattern[] = [
  // Explicit hold/wait commands
  {
    regex: /^hold(\s+on)?(\s+until\s+(.+))?$/i,
    type: 'hold',
    confidence: 0.9,
    extractParams: (match) => ({
      type: 'hold' as const,
      until: match[3]?.trim(),
    }),
  },
  {
    regex: /^wait(\s+until\s+(.+))?$/i,
    type: 'hold',
    confidence: 0.85,
    extractParams: (match) => ({
      type: 'hold' as const,
      until: match[2]?.trim(),
    }),
  },

  // Snooze commands
  {
    regex: /^snooze(\s+for)?\s+(\d+\s*[hmd](?:ours?|inutes?|ins?|ays?)?|\d+)$/i,
    type: 'hold',
    confidence: 0.95,
    extractParams: (match) => ({
      type: 'hold' as const,
      duration: normalizeDuration(match[2] ?? ''),
    }),
  },
  {
    regex: /^snooze(\s+until\s+(.+))?$/i,
    type: 'hold',
    confidence: 0.9,
    extractParams: (match) => ({
      type: 'hold' as const,
      until: match[2]?.trim(),
    }),
  },

  // Delay commands
  {
    regex: /^delay(\s+until\s+(.+))?$/i,
    type: 'hold',
    confidence: 0.85,
    extractParams: (match) => ({
      type: 'hold' as const,
      until: match[2]?.trim(),
    }),
  },

  // "Don't send yet" style
  {
    regex: /^(don'?t|do\s+not)\s+send(\s+yet)?$/i,
    type: 'hold',
    confidence: 0.85,
  },

  // Natural phrasing with timing
  {
    regex: /^hold\s+(until|till|for)\s+(.+)$/i,
    type: 'hold',
    confidence: 0.9,
    extractParams: (match) => {
      const timing = match[2]?.trim() ?? ''
      const isDuration = /^\d+\s*[hmd]/i.test(timing)
      return {
        type: 'hold' as const,
        ...(isDuration
          ? { duration: normalizeDuration(timing) }
          : { until: timing }),
      }
    },
  },
]

// Edit patterns - extract what to change
const EDIT_PATTERNS: Pattern[] = [
  // "Change X to Y" pattern
  {
    regex: /^change\s+["']?(.+?)["']?\s+to\s+["']?(.+?)["']?$/i,
    type: 'edit',
    confidence: 0.95,
    extractParams: (match, text) => ({
      type: 'edit' as const,
      instruction: text,
      target: match[1]?.trim() ?? '',
      replacement: match[2]?.trim() ?? '',
    }),
  },

  // "Replace X with Y" pattern
  {
    regex: /^replace\s+["']?(.+?)["']?\s+with\s+["']?(.+?)["']?$/i,
    type: 'edit',
    confidence: 0.95,
    extractParams: (match, text) => ({
      type: 'edit' as const,
      instruction: text,
      target: match[1]?.trim() ?? '',
      replacement: match[2]?.trim() ?? '',
    }),
  },

  // Style/tone adjustments
  {
    regex:
      /^make\s+(it\s+)?(shorter|longer|friendlier|more\s+formal|more\s+casual|simpler|clearer|concise)$/i,
    type: 'edit',
    confidence: 0.9,
    extractParams: (_match, text) => ({
      type: 'edit' as const,
      instruction: text,
    }),
  },

  // "Make it more X" pattern
  {
    regex: /^make\s+(it\s+)?more\s+(.+)$/i,
    type: 'edit',
    confidence: 0.85,
    extractParams: (_match, text) => ({
      type: 'edit' as const,
      instruction: text,
    }),
  },

  // "Make it less X" pattern
  {
    regex: /^make\s+(it\s+)?less\s+(.+)$/i,
    type: 'edit',
    confidence: 0.85,
    extractParams: (_match, text) => ({
      type: 'edit' as const,
      instruction: text,
    }),
  },

  // Generic edit command
  {
    regex: /^edit(\s+this)?:?\s*(.+)?$/i,
    type: 'edit',
    confidence: 0.8,
    extractParams: (match, text) => ({
      type: 'edit' as const,
      instruction: match[2]?.trim() ?? text,
    }),
  },

  // "Can you..." requests (often edits)
  {
    regex:
      /^(can\s+you\s+)?(please\s+)?(change|update|modify|adjust|fix|rewrite|rephrase)\s+(.+)$/i,
    type: 'edit',
    confidence: 0.8,
    extractParams: (_match, text) => ({
      type: 'edit' as const,
      instruction: text,
    }),
  },

  // Specific edit words
  {
    regex:
      /^(shorten|lengthen|simplify|clarify|rewrite|rephrase|revise)(\s+.+)?$/i,
    type: 'edit',
    confidence: 0.85,
    extractParams: (_match, text) => ({
      type: 'edit' as const,
      instruction: text,
    }),
  },

  // "Add X" pattern
  {
    regex: /^add\s+(.+)$/i,
    type: 'edit',
    confidence: 0.8,
    extractParams: (_match, text) => ({
      type: 'edit' as const,
      instruction: text,
    }),
  },

  // "Remove X" pattern
  {
    regex: /^(remove|delete|drop)\s+(.+)$/i,
    type: 'edit',
    confidence: 0.85,
    extractParams: (_match, text) => ({
      type: 'edit' as const,
      instruction: text,
    }),
  },
]

/**
 * Normalize duration strings like "2h", "2 hours", "30m", "1d"
 */
function normalizeDuration(input: string): string {
  const cleaned = input.toLowerCase().trim()

  // Already normalized
  if (/^\d+[hmd]$/.test(cleaned)) {
    return cleaned
  }

  // Parse "2 hours", "30 minutes", "1 day"
  const match = cleaned.match(
    /^(\d+)\s*(h(?:ours?)?|m(?:inutes?|ins?)?|d(?:ays?)?)$/i
  )
  if (match) {
    const num = match[1]
    const unitChar = match[2]?.[0]?.toLowerCase()
    if (num && unitChar) {
      return `${num}${unitChar}`
    }
  }

  // Just a number, assume hours
  if (/^\d+$/.test(cleaned)) {
    return `${cleaned}h`
  }

  return cleaned
}

/**
 * Parse user input to determine intent
 */
export async function parseIntent(text: string): Promise<IntentResult> {
  const trimmed = text.trim()

  // Check all pattern groups in order of specificity
  const allPatterns = [...APPROVE_PATTERNS, ...HOLD_PATTERNS, ...EDIT_PATTERNS]

  let bestMatch: IntentResult | null = null

  for (const pattern of allPatterns) {
    const match = trimmed.match(pattern.regex)
    if (match) {
      const params = pattern.extractParams?.(match, trimmed) ?? {
        type: pattern.type,
      }

      const result: IntentResult = {
        type: pattern.type,
        confidence: pattern.confidence,
        parameters: params as IntentParams,
      }

      // Keep the highest confidence match
      if (!bestMatch || result.confidence > bestMatch.confidence) {
        bestMatch = result
      }
    }
  }

  if (bestMatch) {
    return bestMatch
  }

  // No pattern matched - return unknown with low confidence
  return {
    type: 'unknown',
    confidence: 0,
    parameters: {
      type: 'unknown',
      raw: trimmed,
    },
  }
}

/**
 * Check if result indicates a confident match
 */
export function isConfident(result: IntentResult, threshold = 0.7): boolean {
  return result.confidence >= threshold
}

/**
 * Get a human-readable description of the intent
 */
export function describeIntent(result: IntentResult): string {
  switch (result.type) {
    case 'approve':
      return 'User wants to approve/send the draft'
    case 'hold': {
      const holdParams = result.parameters as HoldParams
      if (holdParams.until) {
        return `User wants to hold until ${holdParams.until}`
      }
      if (holdParams.duration) {
        return `User wants to hold for ${holdParams.duration}`
      }
      return 'User wants to hold/delay'
    }
    case 'edit': {
      const editParams = result.parameters as EditParams
      if (editParams.target && editParams.replacement) {
        return `User wants to change "${editParams.target}" to "${editParams.replacement}"`
      }
      return `User wants to edit: ${editParams.instruction}`
    }
    case 'unknown':
      return 'Intent could not be determined'
  }
}
