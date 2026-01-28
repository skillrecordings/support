/**
 * Edit/Deletion Detection Service
 *
 * Compares agent-generated drafts to actually sent messages to determine
 * the level of human editing. This feeds into the RL loop with signals:
 *
 * - unchanged (≥95% similarity): Draft accepted as-is → strong positive
 * - minor_edit (70-95%): Small tweaks → weak positive
 * - major_rewrite (<70%): Significant changes → correction signal (10x learning value!)
 * - deleted: Draft not used within 2h → negative signal
 *
 * @module rl/edit-detection
 */

import {
  DEFAULT_THRESHOLDS,
  type DetectionThresholds,
  type DraftOutcome,
  type EditDetectionResult,
} from './types'

/**
 * Normalize text for comparison.
 * Strips HTML, normalizes whitespace, removes tracking markers.
 */
export function normalizeText(text: string): string {
  if (!text) return ''

  return text
    .replace(/<[^>]*>/g, ' ') // Strip HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp;
    .replace(/&[a-z]+;/gi, ' ') // Other HTML entities
    .replace(/<!-- agent-draft-id:[^>]* -->/g, '') // Strip tracking markers
    .replace(/\s+/g, ' ') // Collapse whitespace
    .toLowerCase()
    .trim()
}

/**
 * Compute similarity using Jaccard index on word sets.
 * Fast and effective for text comparison.
 *
 * @param a - First text
 * @param b - Second text
 * @returns Similarity score 0-1 (1 = identical)
 */
export function computeSimilarity(a: string, b: string): number {
  const textA = normalizeText(a)
  const textB = normalizeText(b)

  if (textA === textB) return 1.0
  if (textA.length === 0 || textB.length === 0) return 0.0

  const wordsA = new Set(textA.split(/\s+/).filter(Boolean))
  const wordsB = new Set(textB.split(/\s+/).filter(Boolean))

  if (wordsA.size === 0 || wordsB.size === 0) return 0.0

  // Jaccard similarity
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size

  return intersection / union
}

/**
 * Detect edit type between original draft and sent message.
 *
 * @param original - Original draft text (can be null if no draft)
 * @param sent - Sent message text
 * @param thresholds - Optional custom thresholds
 * @returns Detection result with outcome and similarity
 *
 * @example
 * ```ts
 * const result = detectEditType(draftText, sentText)
 * if (result.outcome === 'major_rewrite') {
 *   // 10x learning value - significant correction!
 * }
 * ```
 */
export function detectEditType(
  original: string | null | undefined,
  sent: string,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS
): EditDetectionResult {
  const detectedAt = new Date().toISOString()

  // No draft → manual response (baseline)
  if (!original) {
    return {
      outcome: 'no_draft',
      sentText: normalizeText(sent),
      detectedAt,
    }
  }

  const similarity = computeSimilarity(original, sent)
  const normalizedOriginal = normalizeText(original)
  const normalizedSent = normalizeText(sent)

  let outcome: DraftOutcome

  if (similarity >= thresholds.unchanged) {
    outcome = 'unchanged'
  } else if (similarity >= thresholds.minorEdit) {
    outcome = 'minor_edit'
  } else {
    outcome = 'major_rewrite'
  }

  return {
    outcome,
    similarity,
    originalText: normalizedOriginal,
    sentText: normalizedSent,
    detectedAt,
  }
}

/**
 * Create a deletion result for drafts that timed out.
 *
 * @param draftText - The original draft text
 * @returns Detection result with deleted outcome
 */
export function markAsDeleted(draftText: string): EditDetectionResult {
  return {
    outcome: 'deleted',
    originalText: normalizeText(draftText),
    detectedAt: new Date().toISOString(),
  }
}

/**
 * Batch detection for multiple draft/sent pairs.
 * Useful for bulk analysis.
 */
export function detectEditTypes(
  pairs: Array<{ original: string | null; sent: string }>,
  thresholds?: DetectionThresholds
): EditDetectionResult[] {
  return pairs.map(({ original, sent }) =>
    detectEditType(original, sent, thresholds)
  )
}
