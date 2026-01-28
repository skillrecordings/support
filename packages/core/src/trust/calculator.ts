/**
 * Per-Category Confidence Calculator
 *
 * Computes trust scores from draft outcome history using exponential decay.
 * Part of the RL feedback loop - learns from how often human operators
 * accept vs edit agent-generated drafts.
 *
 * Formula:
 *   confidence = Σ (signal × e^(-age/half_life)) / Σ e^(-age/half_life)
 *
 * Signal values:
 *   - unchanged → 1.0 (draft accepted as-is)
 *   - minor_edit → 0.5 (small tweaks)
 *   - major_rewrite → 0.0 (significant correction)
 *   - deleted → 0.0 (draft discarded)
 *
 * @module trust/calculator
 */

import type { DraftOutcome } from '../rl/types'
import { type OutcomeRecord, getOutcomeHistory } from './repository'
import { TRUST_THRESHOLDS } from './types'

/**
 * Confidence calculation result with decision metadata.
 */
export interface ConfidenceResult {
  /** Weighted confidence score (0-1) */
  confidence: number
  /** Number of samples used */
  sampleCount: number
  /** Whether auto-send threshold is met (≥90% at N≥20) */
  meetsAutoSendThreshold: boolean
  /** Sum of all weights (for debugging/analysis) */
  totalWeight: number
  /** Effective sample count accounting for decay */
  effectiveSamples: number
}

/**
 * Auto-send confidence thresholds
 */
export const CONFIDENCE_THRESHOLDS = {
  /** Minimum confidence to allow auto-send */
  MIN_CONFIDENCE: 0.9,
  /** Minimum samples needed for auto-send decision */
  MIN_SAMPLES: 20,
} as const

/**
 * Map draft outcome to signal value.
 *
 * @param outcome - Draft outcome type
 * @returns Signal value (0-1)
 */
export function outcomeToSignal(outcome: DraftOutcome): number {
  switch (outcome) {
    case 'unchanged':
      return 1.0
    case 'minor_edit':
      return 0.5
    case 'major_rewrite':
      return 0.0
    case 'deleted':
      return 0.0
    case 'no_draft':
      // no_draft shouldn't be stored, but handle gracefully
      return 0.5
    default:
      // Exhaustive check
      const _exhaustive: never = outcome
      return 0.5
  }
}

/**
 * Calculate exponential decay weight.
 *
 * @param ageMs - Age in milliseconds
 * @param halfLifeMs - Half-life in milliseconds
 * @returns Decay weight (0-1)
 */
export function calculateDecayWeight(
  ageMs: number,
  halfLifeMs: number
): number {
  // Formula: e^(-age/half_life)
  return Math.exp(-ageMs / halfLifeMs)
}

/**
 * Calculate confidence score from outcome history using exponential decay.
 *
 * Uses weighted average where recent outcomes have higher weight:
 *   confidence = Σ (signal × weight) / Σ weight
 *   where weight = e^(-age/half_life)
 *
 * @param outcomes - Array of outcome records with timestamps
 * @param halfLifeDays - Decay half-life in days (default: 30)
 * @param referenceTime - Reference time for age calculation (default: now)
 * @returns Confidence result with score and metadata
 *
 * @example
 * ```ts
 * const outcomes = await getOutcomeHistory('total-typescript', 'refund-simple')
 * const result = calculateConfidenceFromHistory(outcomes)
 * if (result.meetsAutoSendThreshold) {
 *   // Safe to auto-send!
 * }
 * ```
 */
export function calculateConfidenceFromHistory(
  outcomes: OutcomeRecord[],
  halfLifeDays: number = TRUST_THRESHOLDS.DEFAULT_HALF_LIFE_DAYS,
  referenceTime: Date = new Date()
): ConfidenceResult {
  // Handle empty history
  if (outcomes.length === 0) {
    return {
      confidence: 0,
      sampleCount: 0,
      meetsAutoSendThreshold: false,
      totalWeight: 0,
      effectiveSamples: 0,
    }
  }

  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000
  const referenceMs = referenceTime.getTime()

  let weightedSum = 0
  let totalWeight = 0

  for (const record of outcomes) {
    const ageMs = Math.max(0, referenceMs - record.recordedAt.getTime())
    const weight = calculateDecayWeight(ageMs, halfLifeMs)
    const signal = outcomeToSignal(record.outcome)

    weightedSum += signal * weight
    totalWeight += weight
  }

  // Avoid division by zero (shouldn't happen with valid outcomes)
  const confidence = totalWeight > 0 ? weightedSum / totalWeight : 0

  // Effective samples: sum of weights represents "equivalent" recent samples
  const effectiveSamples = totalWeight

  // Auto-send threshold check: 90%+ confidence with at least 20 samples
  const meetsAutoSendThreshold =
    confidence >= CONFIDENCE_THRESHOLDS.MIN_CONFIDENCE &&
    outcomes.length >= CONFIDENCE_THRESHOLDS.MIN_SAMPLES

  return {
    confidence,
    sampleCount: outcomes.length,
    meetsAutoSendThreshold,
    totalWeight,
    effectiveSamples,
  }
}

/**
 * Calculate confidence score for an app/category pair.
 *
 * This is the main entry point - fetches history from Redis and calculates
 * the confidence score with exponential decay.
 *
 * @param appId - Application identifier
 * @param category - Message category
 * @param halfLifeDays - Decay half-life in days (default: 30)
 * @returns Confidence result with score and metadata
 *
 * @example
 * ```ts
 * const result = await calculateCategoryConfidence('total-typescript', 'refund-simple')
 * console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`)
 * console.log(`Samples: ${result.sampleCount}`)
 * console.log(`Auto-send OK: ${result.meetsAutoSendThreshold}`)
 * ```
 */
export async function calculateCategoryConfidence(
  appId: string,
  category: string,
  halfLifeDays: number = TRUST_THRESHOLDS.DEFAULT_HALF_LIFE_DAYS
): Promise<ConfidenceResult> {
  const outcomes = await getOutcomeHistory(appId, category)
  return calculateConfidenceFromHistory(outcomes, halfLifeDays)
}
