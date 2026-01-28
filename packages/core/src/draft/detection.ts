/**
 * Draft Edit Detection Module
 *
 * Compares drafted content to sent messages to categorize the level of editing.
 * This is a core signal for the RL (reinforcement learning) feedback loop:
 *
 * - unchanged: Draft sent as-is → strong positive signal
 * - minor_edit: Small edits (typos, wording) → weak positive
 * - major_rewrite: Significant changes → correction signal (10x learning value!)
 * - no_draft: No agent draft existed → manual response (baseline)
 *
 * @module draft/detection
 */

import type { DraftDiffCategory } from '../inngest/events'

/**
 * Result of edit detection analysis
 */
export interface EditDetectionResult {
  /** Categorized edit level */
  category: DraftDiffCategory
  /** Similarity score between 0 and 1 (1 = identical) */
  similarity: number
}

/**
 * Thresholds for edit categorization.
 * These are tuned based on expected human editing patterns:
 * - 95%+ similarity = trivial whitespace/formatting only
 * - 70-95% similarity = typo fixes, minor wording changes
 * - <70% similarity = substantial content changes
 */
export const EDIT_THRESHOLDS = {
  UNCHANGED: 0.95, // >= 95% = unchanged
  MINOR_EDIT: 0.7, // >= 70% = minor_edit, < 70% = major_rewrite
} as const

/**
 * Normalize text for comparison.
 *
 * Strips HTML tags, normalizes HTML entities, collapses whitespace,
 * and lowercases for case-insensitive comparison.
 *
 * @param text - Raw text (may contain HTML)
 * @returns Normalized text for comparison
 */
export function normalizeText(text: string): string {
  if (!text) return ''

  return (
    text
      // Strip HTML tags
      .replace(/<[^>]*>/g, ' ')
      // Replace common HTML entities
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&[a-z0-9]+;/gi, ' ') // Other HTML entities
      // Normalize line breaks and whitespace
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      // Lowercase for case-insensitive comparison
      .toLowerCase()
      .trim()
  )
}

/**
 * Tokenize text into words for Jaccard similarity.
 *
 * @param text - Normalized text
 * @returns Set of unique word tokens
 */
function tokenize(text: string): Set<string> {
  if (!text) return new Set()

  // Split on whitespace and common punctuation, filter empty strings
  const words = text
    .split(/[\s.,!?;:'"()\[\]{}<>\/\\|@#$%^&*+=~`-]+/)
    .filter((word) => word.length > 0)

  return new Set(words)
}

/**
 * Compute Jaccard similarity between two texts.
 *
 * Jaccard = |intersection| / |union|
 *
 * This measures the overlap of word tokens between two texts,
 * giving a value between 0 (no overlap) and 1 (identical).
 *
 * @param a - First text (will be normalized)
 * @param b - Second text (will be normalized)
 * @returns Similarity score between 0 and 1
 */
export function computeJaccardSimilarity(a: string, b: string): number {
  const textA = normalizeText(a)
  const textB = normalizeText(b)

  // Handle edge cases
  if (textA === textB) return 1.0
  if (textA.length === 0 && textB.length === 0) return 1.0
  if (textA.length === 0 || textB.length === 0) return 0.0

  const tokensA = tokenize(textA)
  const tokensB = tokenize(textB)

  // Handle empty token sets
  if (tokensA.size === 0 && tokensB.size === 0) return 1.0
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0

  // Compute Jaccard similarity
  const intersection = Array.from(tokensA).filter((token) => tokensB.has(token)).length
  const union = new Set([...Array.from(tokensA), ...Array.from(tokensB)]).size

  return intersection / union
}

/**
 * Detect edit category by comparing original draft to sent message.
 *
 * This is the primary function for the RL feedback loop. It categorizes
 * how much a human edited the agent's draft before sending.
 *
 * @param original - Original draft text (from agent)
 * @param sent - Sent message text (from human)
 * @returns Category and similarity score
 *
 * @example
 * ```ts
 * const result = detectEditCategory(agentDraft, sentMessage)
 * if (result.category === 'major_rewrite') {
 *   // This is a correction signal - valuable for learning!
 * }
 * ```
 */
export function detectEditCategory(
  original: string | null | undefined,
  sent: string
): EditDetectionResult {
  // No draft → manual response (human wrote from scratch)
  if (!original) {
    return { category: 'no_draft', similarity: 0 }
  }

  const similarity = computeJaccardSimilarity(original, sent)

  // Categorize based on thresholds
  if (similarity >= EDIT_THRESHOLDS.UNCHANGED) {
    return { category: 'unchanged', similarity }
  } else if (similarity >= EDIT_THRESHOLDS.MINOR_EDIT) {
    return { category: 'minor_edit', similarity }
  } else {
    return { category: 'major_rewrite', similarity }
  }
}

/**
 * Legacy alias for detectEditCategory (for workflow compatibility)
 */
export function categorizeDiff(
  draftText: string | null | undefined,
  sentText: string
): EditDetectionResult {
  return detectEditCategory(draftText, sentText)
}
