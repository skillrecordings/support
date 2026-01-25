/**
 * Memory Query Layer
 *
 * Query helper for per-stage memory retrieval in the support pipeline.
 * Each pipeline stage can retrieve relevant memories before making decisions.
 */

import { SupportMemoryService } from '@skillrecordings/memory/support-memory'
import type {
  SupportSearchResult,
  SupportStage,
} from '@skillrecordings/memory/support-schemas'

// ============================================================================
// Types
// ============================================================================

export interface QueryMemoriesOptions {
  /** App identifier for scoped memories */
  appId: string
  /** Pipeline stage to filter memories */
  stage: SupportStage
  /** Current ticket context (subject + body, or situation description) */
  situation: string
  /** Category filter if known (e.g., 'refund', 'access') */
  category?: string
  /** Maximum number of memories to return (default: 5) */
  limit?: number
  /** Minimum similarity threshold (default: 0.6) */
  threshold?: number
  /** Include memories with low confidence (default: false) */
  includeStale?: boolean
}

/**
 * A memory relevant to the current context, ready for prompt injection
 */
export interface RelevantMemory {
  /** Memory ID (for citation tracking) */
  id: string
  /** Original situation that was similar */
  situation: string
  /** Decision that was made */
  decision: string
  /** Similarity score (0-1), decay-adjusted */
  score: number
  /** Raw similarity score before decay */
  rawScore: number
  /** How old the memory is (days since created/validated) */
  ageDays: number
  /** Outcome from feedback: success, corrected, or failed */
  outcome: 'success' | 'corrected' | 'failed'
  /** If corrected, what should have happened */
  correction?: string
  /** Category tag */
  category?: string
  /** Original confidence before decay */
  confidence: number
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Query memories relevant to current ticket context for a specific pipeline stage.
 *
 * @example
 * ```typescript
 * // In classify stage
 * const memories = await queryMemoriesForStage({
 *   appId: 'total-typescript',
 *   stage: 'classify',
 *   situation: `Customer email: ${subject}\n${body}`,
 *   limit: 5
 * })
 * ```
 */
export async function queryMemoriesForStage(
  options: QueryMemoriesOptions
): Promise<RelevantMemory[]> {
  const {
    appId,
    stage,
    situation,
    category,
    limit = 5,
    threshold = 0.6,
    includeStale = false,
  } = options

  // Query the memory service
  const results = await SupportMemoryService.findSimilar(situation, {
    app_slug: appId,
    stage,
    category,
    limit,
    threshold,
    include_stale: includeStale,
  })

  // Transform to RelevantMemory format
  return results.map(transformResult)
}

/**
 * Query memories across all stages for a situation.
 * Useful for gathering broad context before processing.
 *
 * @example
 * ```typescript
 * // Gather all relevant memories regardless of stage
 * const memories = await queryMemoriesForSituation({
 *   appId: 'total-typescript',
 *   situation: `Refund request after 3 months`,
 *   limit: 10
 * })
 * ```
 */
export async function queryMemoriesForSituation(options: {
  appId: string
  situation: string
  category?: string
  limit?: number
  threshold?: number
  includeStale?: boolean
}): Promise<RelevantMemory[]> {
  const {
    appId,
    situation,
    category,
    limit = 10,
    threshold = 0.5,
    includeStale = false,
  } = options

  // Query without stage filter
  const results = await SupportMemoryService.findSimilar(situation, {
    app_slug: appId,
    category,
    limit,
    threshold,
    include_stale: includeStale,
  })

  return results.map(transformResult)
}

/**
 * Query memories that were corrected (to learn from mistakes).
 * Useful for validation stage to catch potential errors.
 */
export async function queryCorrectedMemories(options: {
  appId: string
  situation: string
  stage?: SupportStage
  limit?: number
}): Promise<RelevantMemory[]> {
  const { appId, situation, stage, limit = 5 } = options

  const results = await SupportMemoryService.findSimilar(situation, {
    app_slug: appId,
    stage,
    outcome: 'corrected',
    limit,
    threshold: 0.5,
    include_stale: true, // Include older corrections for learning
  })

  return results.map(transformResult)
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format memories for injection into LLM prompts.
 *
 * @example
 * ```typescript
 * const memories = await queryMemoriesForStage({ ... })
 * const prompt = `
 * ${formatMemoriesForPrompt(memories)}
 *
 * Now classify this ticket...
 * `
 * ```
 */
export function formatMemoriesForPrompt(memories: RelevantMemory[]): string {
  if (memories.length === 0) {
    return ''
  }

  const sections: string[] = [
    '## Relevant Past Decisions',
    '',
    'The following similar situations were handled before. Use these as guidance:',
    '',
  ]

  for (const memory of memories) {
    sections.push(formatSingleMemory(memory))
    sections.push('')
  }

  return sections.join('\n')
}

/**
 * Format memories as a concise context block (shorter format).
 * Use when token budget is tight.
 */
export function formatMemoriesCompact(memories: RelevantMemory[]): string {
  if (memories.length === 0) {
    return ''
  }

  const lines = ['## Prior Decisions (for reference):', '']

  for (const memory of memories) {
    const outcomeIcon = getOutcomeIcon(memory.outcome)
    const correctionNote = memory.correction
      ? ` [Correction: ${memory.correction}]`
      : ''
    lines.push(
      `${outcomeIcon} **Situation**: ${truncate(memory.situation, 100)}`
    )
    lines.push(
      `   **Decision**: ${truncate(memory.decision, 150)}${correctionNote}`
    )
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Format memories for the validation stage (focus on corrections/failures).
 * Helps catch potential errors by showing what went wrong before.
 */
export function formatMemoriesForValidation(
  memories: RelevantMemory[]
): string {
  const corrections = memories.filter((m) => m.outcome === 'corrected')
  const failures = memories.filter((m) => m.outcome === 'failed')

  if (corrections.length === 0 && failures.length === 0) {
    return ''
  }

  const sections: string[] = [
    '## ⚠️ Learned Corrections',
    '',
    'These similar situations had issues. Avoid repeating these mistakes:',
    '',
  ]

  for (const memory of [...corrections, ...failures]) {
    sections.push(`**Situation**: ${truncate(memory.situation, 150)}`)
    sections.push(`**Original Decision**: ${truncate(memory.decision, 150)}`)
    if (memory.correction) {
      sections.push(`**Correction**: ${memory.correction}`)
    } else {
      sections.push(`**Outcome**: Failed (no specific correction recorded)`)
    }
    sections.push('')
  }

  return sections.join('\n')
}

// ============================================================================
// Citation Tracking
// ============================================================================

/**
 * Record that memories were used in a decision.
 * Call this after using memories in a pipeline stage.
 *
 * @param memoryIds - IDs of memories that were cited
 * @param runId - Current pipeline run/trace ID
 * @param appId - App identifier
 */
export async function citeMemories(
  memoryIds: string[],
  runId: string,
  appId: string
): Promise<void> {
  if (memoryIds.length === 0) return
  await SupportMemoryService.cite(memoryIds, runId, appId)
}

/**
 * Record outcome for cited memories after human review.
 * Call this when a human approves or rejects a response.
 *
 * @param memoryIds - IDs of memories that were cited
 * @param runId - Pipeline run/trace ID
 * @param outcome - Whether the decision was successful
 * @param appId - App identifier
 */
export async function recordCitationOutcome(
  memoryIds: string[],
  runId: string,
  outcome: 'success' | 'failure',
  appId: string
): Promise<void> {
  if (memoryIds.length === 0) return
  await SupportMemoryService.recordCitationOutcome(
    memoryIds,
    runId,
    outcome,
    appId
  )
}

// ============================================================================
// Internal Helpers
// ============================================================================

function transformResult(result: SupportSearchResult): RelevantMemory {
  const { situation, decision } = SupportMemoryService.parseContent(
    result.memory.content
  )

  return {
    id: result.memory.id,
    situation,
    decision,
    score: result.score,
    rawScore: result.raw_score,
    ageDays: result.age_days,
    outcome: result.memory.metadata.outcome,
    correction: result.memory.metadata.correction,
    category: result.memory.metadata.category,
    confidence: result.memory.metadata.confidence,
  }
}

function formatSingleMemory(memory: RelevantMemory): string {
  const lines: string[] = []
  const outcomeLabel = formatOutcomeLabel(memory.outcome)
  const ageLabel = formatAge(memory.ageDays)
  const scoreLabel = `${Math.round(memory.score * 100)}% match`

  lines.push(`### ${outcomeLabel} (${scoreLabel}, ${ageLabel})`)
  lines.push('')
  lines.push(`**Situation**: ${memory.situation}`)
  lines.push('')
  lines.push(`**Decision**: ${memory.decision}`)

  if (memory.correction) {
    lines.push('')
    lines.push(`**⚠️ Correction**: ${memory.correction}`)
  }

  return lines.join('\n')
}

function formatOutcomeLabel(
  outcome: 'success' | 'corrected' | 'failed'
): string {
  switch (outcome) {
    case 'success':
      return '✅ Successful Decision'
    case 'corrected':
      return '🔄 Corrected Decision'
    case 'failed':
      return '❌ Failed Decision'
  }
}

function getOutcomeIcon(outcome: 'success' | 'corrected' | 'failed'): string {
  switch (outcome) {
    case 'success':
      return '✅'
    case 'corrected':
      return '🔄'
    case 'failed':
      return '❌'
  }
}

function formatAge(days: number): string {
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 7) return `${Math.round(days)} days ago`
  if (days < 30) return `${Math.round(days / 7)} weeks ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  return `${Math.round(days / 365)} years ago`
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}
