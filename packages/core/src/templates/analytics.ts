/**
 * Template analytics module for tracking usage, edits, and effectiveness.
 *
 * Provides logging and aggregation functions to understand template performance
 * for optimization and the template gardening system.
 *
 * Uses Axiom for real-time logging with high cardinality support.
 */

import { log as axiomLog } from '../observability/axiom'

// ============================================================================
// Types
// ============================================================================

/**
 * Individual template usage event.
 * Logged when a template is matched and potentially used.
 */
export interface TemplateUsage {
  id: string
  templateId: string
  appId: string
  conversationId: string
  category: string
  matchConfidence: number
  wasEdited: boolean
  editDistance?: number
  wasApproved: boolean
  timestamp: Date
}

/**
 * Aggregated template statistics.
 * Computed from usage events for optimization decisions.
 */
export interface TemplateStats {
  templateId: string
  appId: string
  usageCount: number
  editRate: number
  approvalRate: number
  avgEditDistance: number
  lastUsed: Date
  staleDays: number
}

/**
 * Input for logging template usage.
 */
export interface LogTemplateUsageInput {
  templateId: string
  templateName: string
  appId: string
  conversationId: string
  category: string
  matchConfidence: number
  /** Whether template was used (vs. LLM fallback) */
  wasUsed: boolean
  /** All candidates considered for this match */
  candidates?: Array<{
    templateId: string
    name: string
    score: number
  }>
  /** Duration of matching in ms */
  matchDurationMs?: number
}

/**
 * Input for logging template edits.
 */
export interface LogTemplateEditInput {
  templateId: string
  templateName: string
  appId: string
  conversationId: string
  /** Original template content length */
  originalLength: number
  /** Edited content length */
  editedLength: number
  /** Levenshtein or similar distance metric */
  editDistance: number
  /** Edit distance as percentage of original */
  editPercentage: number
  /** Who made the edit */
  editorId?: string
  /** Time spent editing in ms (if tracked) */
  editDurationMs?: number
}

/**
 * Input for logging template approval/rejection.
 */
export interface LogTemplateApprovalInput {
  templateId: string
  templateName: string
  appId: string
  conversationId: string
  /** Whether the template-based response was approved */
  approved: boolean
  /** If rejected, why */
  rejectionReason?: string
  /** Who approved/rejected */
  reviewerId?: string
  /** Time from draft to decision in ms */
  reviewDurationMs?: number
}

/**
 * Query options for template stats.
 */
export interface TemplateStatsQuery {
  appId: string
  templateId?: string
  /** Time range start (defaults to 30 days ago) */
  since?: Date
  /** Time range end (defaults to now) */
  until?: Date
  /** Minimum usage count to include */
  minUsageCount?: number
}

// ============================================================================
// Axiom Trace Functions
// ============================================================================

/**
 * Send a template analytics trace to Axiom.
 */
async function traceTemplateAnalytics(
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  await axiomLog('info', `template.${eventType}`, {
    type: 'template-analytics',
    eventType,
    _time: new Date().toISOString(),
    ...data,
  })
}

// ============================================================================
// Logging Functions
// ============================================================================

/**
 * Log when a template is matched and used (or not used).
 *
 * Call this when the template matcher runs, regardless of whether
 * a template was actually used or fell back to LLM.
 *
 * @param input - Template usage details
 *
 * @example
 * ```ts
 * await logTemplateUsage({
 *   templateId: 'front_template_abc123',
 *   templateName: 'Access Issues Response',
 *   appId: 'total-typescript',
 *   conversationId: 'cnv_xyz',
 *   category: 'support_access',
 *   matchConfidence: 0.92,
 *   wasUsed: true,
 *   matchDurationMs: 45
 * })
 * ```
 */
export async function logTemplateUsage(
  input: LogTemplateUsageInput
): Promise<void> {
  const {
    templateId,
    templateName,
    appId,
    conversationId,
    category,
    matchConfidence,
    wasUsed,
    candidates,
    matchDurationMs,
  } = input

  await traceTemplateAnalytics('usage', {
    templateId,
    templateName,
    appId,
    conversationId,
    category,
    matchConfidence,
    wasUsed,
    candidateCount: candidates?.length ?? 0,
    topCandidates: candidates?.slice(0, 3).map((c) => ({
      id: c.templateId,
      name: c.name,
      score: c.score,
    })),
    matchDurationMs,
  })

  // Also log at debug level for local development visibility
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[template-analytics] ${wasUsed ? 'USED' : 'SKIPPED'} ` +
        `template="${templateName}" confidence=${matchConfidence.toFixed(3)} ` +
        `app=${appId} category=${category}`
    )
  }
}

/**
 * Log when a human edits a template-sourced draft.
 *
 * Call this when detecting that the final response differs from
 * the original template content. Helps identify templates that
 * need refinement.
 *
 * @param input - Edit details including distance metrics
 *
 * @example
 * ```ts
 * await logTemplateEdit({
 *   templateId: 'front_template_abc123',
 *   templateName: 'Access Issues Response',
 *   appId: 'total-typescript',
 *   conversationId: 'cnv_xyz',
 *   originalLength: 450,
 *   editedLength: 520,
 *   editDistance: 85,
 *   editPercentage: 18.9,
 *   editorId: 'user_123'
 * })
 * ```
 */
export async function logTemplateEdit(
  input: LogTemplateEditInput
): Promise<void> {
  const {
    templateId,
    templateName,
    appId,
    conversationId,
    originalLength,
    editedLength,
    editDistance,
    editPercentage,
    editorId,
    editDurationMs,
  } = input

  // Categorize edit severity
  const editSeverity =
    editPercentage < 10
      ? 'minor'
      : editPercentage < 30
        ? 'moderate'
        : editPercentage < 50
          ? 'significant'
          : 'major'

  await traceTemplateAnalytics('edit', {
    templateId,
    templateName,
    appId,
    conversationId,
    originalLength,
    editedLength,
    editDistance,
    editPercentage,
    editSeverity,
    lengthDelta: editedLength - originalLength,
    editorId,
    editDurationMs,
  })

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[template-analytics] EDIT template="${templateName}" ` +
        `severity=${editSeverity} editPct=${editPercentage.toFixed(1)}% ` +
        `distance=${editDistance}`
    )
  }
}

/**
 * Log when a template-based response is approved or rejected.
 *
 * Tracks whether the template was ultimately useful for the conversation.
 *
 * @param input - Approval/rejection details
 *
 * @example
 * ```ts
 * await logTemplateApproval({
 *   templateId: 'front_template_abc123',
 *   templateName: 'Access Issues Response',
 *   appId: 'total-typescript',
 *   conversationId: 'cnv_xyz',
 *   approved: true,
 *   reviewerId: 'user_123',
 *   reviewDurationMs: 15000
 * })
 * ```
 */
export async function logTemplateApproval(
  input: LogTemplateApprovalInput
): Promise<void> {
  const {
    templateId,
    templateName,
    appId,
    conversationId,
    approved,
    rejectionReason,
    reviewerId,
    reviewDurationMs,
  } = input

  await traceTemplateAnalytics('approval', {
    templateId,
    templateName,
    appId,
    conversationId,
    approved,
    rejectionReason,
    reviewerId,
    reviewDurationMs,
  })

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[template-analytics] ${approved ? 'APPROVED' : 'REJECTED'} ` +
        `template="${templateName}" ` +
        `${rejectionReason ? `reason="${rejectionReason}"` : ''}`
    )
  }
}

// ============================================================================
// Stats Aggregation Functions
// ============================================================================

/**
 * Get aggregated statistics for a specific template.
 *
 * In production, this would query Axiom or a materialized view.
 * Currently returns a placeholder - implement Axiom query when needed.
 *
 * @param query - Query parameters
 * @returns Aggregated stats for the template
 *
 * @example
 * ```ts
 * const stats = await getTemplateStats({
 *   appId: 'total-typescript',
 *   templateId: 'front_template_abc123',
 *   since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days
 * })
 *
 * if (stats.editRate > 0.5) {
 *   console.log('Template needs refinement - over 50% edit rate')
 * }
 * ```
 */
export async function getTemplateStats(
  query: TemplateStatsQuery & { templateId: string }
): Promise<TemplateStats | null> {
  const { appId, templateId, since, until } = query

  // Log the stats request for tracking which templates are being analyzed
  await axiomLog('debug', 'template.stats.query', {
    type: 'template-analytics',
    eventType: 'stats_query',
    appId,
    templateId,
    since: since?.toISOString(),
    until: until?.toISOString(),
  })

  // TODO: Implement Axiom APL query for real stats aggregation
  // Query would look something like:
  //
  // ['support-traces']
  // | where type == 'template-analytics'
  // | where appId == '<appId>'
  // | where templateId == '<templateId>'
  // | where _time >= ago(30d)
  // | summarize
  //     usageCount = countif(eventType == 'usage' and wasUsed == true),
  //     editCount = countif(eventType == 'edit'),
  //     approvalCount = countif(eventType == 'approval' and approved == true),
  //     totalApprovals = countif(eventType == 'approval'),
  //     avgEditDistance = avgif(editDistance, eventType == 'edit'),
  //     lastUsed = max(_time)
  //   by templateId, appId

  // For now, return null to indicate no data
  // Real implementation needs Axiom's query API
  console.log(
    `[template-analytics] getTemplateStats: query for ${templateId} in ${appId}`
  )

  return null
}

/**
 * Get statistics for all templates in an app.
 *
 * Returns ranked list of templates by usage, with effectiveness metrics.
 * Useful for identifying templates that need attention.
 *
 * @param query - Query parameters
 * @returns Array of template stats, sorted by usage count descending
 *
 * @example
 * ```ts
 * const allStats = await getAppTemplateStats({
 *   appId: 'total-typescript',
 *   minUsageCount: 5 // Only templates used 5+ times
 * })
 *
 * // Find stale templates
 * const stale = allStats.filter(s => s.staleDays > 90)
 *
 * // Find low-performing templates
 * const lowPerformers = allStats.filter(s =>
 *   s.approvalRate < 0.5 || s.editRate > 0.7
 * )
 * ```
 */
export async function getAppTemplateStats(
  query: TemplateStatsQuery
): Promise<TemplateStats[]> {
  const { appId, since, until, minUsageCount } = query

  await axiomLog('debug', 'template.stats.app_query', {
    type: 'template-analytics',
    eventType: 'app_stats_query',
    appId,
    since: since?.toISOString(),
    until: until?.toISOString(),
    minUsageCount,
  })

  // TODO: Implement Axiom APL query for real stats aggregation
  // Query would aggregate by templateId within the app

  console.log(
    `[template-analytics] getAppTemplateStats: query for all templates in ${appId}`
  )

  return []
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate edit distance between two strings using Levenshtein distance.
 *
 * Useful for measuring how much a template was modified.
 *
 * @param original - Original template content
 * @param edited - Edited content
 * @returns Levenshtein distance (number of edits)
 */
export function calculateEditDistance(
  original: string,
  edited: string
): number {
  const m = original.length
  const n = edited.length

  // Create matrix with explicit initialization
  const dp: number[][] = []
  for (let i = 0; i <= m; i++) {
    dp[i] = []
    for (let j = 0; j <= n; j++) {
      dp[i]![j] = 0
    }
  }

  // Initialize base cases
  for (let i = 0; i <= m; i++) {
    dp[i]![0] = i
  }
  for (let j = 0; j <= n; j++) {
    dp[0]![j] = j
  }

  // Fill matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (original[i - 1] === edited[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!
      } else {
        dp[i]![j] =
          1 +
          Math.min(
            dp[i - 1]![j]!, // deletion
            dp[i]![j - 1]!, // insertion
            dp[i - 1]![j - 1]! // substitution
          )
      }
    }
  }

  return dp[m]![n]!
}

/**
 * Calculate edit percentage (normalized distance).
 *
 * @param original - Original content
 * @param edited - Edited content
 * @returns Percentage of content that changed (0-100)
 */
export function calculateEditPercentage(
  original: string,
  edited: string
): number {
  const distance = calculateEditDistance(original, edited)
  const maxLength = Math.max(original.length, edited.length)

  if (maxLength === 0) return 0

  return (distance / maxLength) * 100
}

/**
 * Determine if a template needs attention based on its stats.
 *
 * @param stats - Template statistics
 * @returns Object with attention flags and reasons
 */
export function analyzeTemplateHealth(stats: TemplateStats): {
  needsAttention: boolean
  reasons: string[]
  severity: 'low' | 'medium' | 'high'
} {
  const reasons: string[] = []

  // Check edit rate (high edit rate = template not quite right)
  if (stats.editRate > 0.7) {
    reasons.push(`High edit rate: ${(stats.editRate * 100).toFixed(0)}%`)
  } else if (stats.editRate > 0.5) {
    reasons.push(`Moderate edit rate: ${(stats.editRate * 100).toFixed(0)}%`)
  }

  // Check approval rate (low approval = template not useful)
  if (stats.approvalRate < 0.5) {
    reasons.push(`Low approval rate: ${(stats.approvalRate * 100).toFixed(0)}%`)
  } else if (stats.approvalRate < 0.7) {
    reasons.push(
      `Below-average approval rate: ${(stats.approvalRate * 100).toFixed(0)}%`
    )
  }

  // Check staleness (template not being matched)
  if (stats.staleDays > 90) {
    reasons.push(`Stale: not used in ${stats.staleDays} days`)
  } else if (stats.staleDays > 60) {
    reasons.push(`Getting stale: ${stats.staleDays} days since last use`)
  }

  // Check average edit distance (large edits = template far from ideal)
  if (stats.avgEditDistance > 100) {
    reasons.push(
      `Large average edits: ${stats.avgEditDistance.toFixed(0)} chars`
    )
  }

  // Determine severity
  let severity: 'low' | 'medium' | 'high' = 'low'
  if (reasons.length >= 3 || stats.approvalRate < 0.3 || stats.editRate > 0.8) {
    severity = 'high'
  } else if (reasons.length >= 2 || stats.approvalRate < 0.5) {
    severity = 'medium'
  }

  return {
    needsAttention: reasons.length > 0,
    reasons,
    severity,
  }
}
