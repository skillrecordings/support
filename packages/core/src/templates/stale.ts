/**
 * Stale template detection module.
 *
 * Identifies templates that haven't been used recently or have poor performance
 * metrics, flagging them for review or removal to keep the template library
 * clean and effective.
 *
 * Stale criteria:
 * - 'unused': No matches in the specified number of days
 * - 'low_match': Low match rate compared to other templates
 * - 'high_edit_rate': Templates frequently edited after use (low quality)
 * - 'superseded': Newer template with similar content performing better
 */

import { getVectorIndex } from '../vector/client'
import type { VectorDocumentMetadata } from '../vector/types'

// ============================================================================
// Types
// ============================================================================

export type StaleReason =
  | 'unused'
  | 'low_match'
  | 'high_edit_rate'
  | 'superseded'

export interface StaleTemplate {
  /** Vector store template ID (e.g., front_template_xxx) */
  templateId: string
  /** Original Front template ID */
  frontId: string
  /** Template name */
  name: string
  /** Why this template is considered stale */
  reason: StaleReason
  /** Days since last successful match */
  daysSinceUsed: number
  /** Total number of times template was matched */
  usageCount: number
  /** Rate at which template responses were edited (0-1) */
  editRate?: number
  /** Template confidence score when matched */
  lastMatchConfidence?: number
}

export interface FindStaleTemplatesOptions {
  /** App ID for scoping template search */
  appId: string
  /** Days without usage to consider stale (default 90) */
  unusedDays?: number
  /** Minimum usage count to avoid being flagged as unused (default 1) */
  minUsageCount?: number
  /** Edit rate threshold above which template is flagged (default 0.5 = 50%) */
  maxEditRate?: number
  /** Include low-match templates (default true) */
  includeLowMatch?: boolean
}

export interface StaleTemplatesResult {
  /** Templates identified as stale */
  stale: StaleTemplate[]
  /** Total templates scanned */
  totalScanned: number
  /** Templates still active */
  activeCount: number
  /** Breakdown by reason */
  byReason: Record<StaleReason, number>
  /** Scan timestamp */
  scannedAt: string
}

// ============================================================================
// Stale Template Detection
// ============================================================================

/**
 * Find stale templates for an app based on usage patterns.
 *
 * This function queries the vector store for all templates belonging to an app
 * and identifies those that are candidates for review/removal based on:
 *
 * 1. **Unused**: No successful matches in `unusedDays` (default 90 days)
 * 2. **Low Match**: Very low confidence scores when matched
 * 3. **High Edit Rate**: Template responses frequently edited by humans
 * 4. **Superseded**: Similar newer template performing better
 *
 * @param options - Search options including appId and thresholds
 * @returns Promise with stale templates and statistics
 *
 * @example
 * ```ts
 * const result = await findStaleTemplates({
 *   appId: 'total-typescript',
 *   unusedDays: 90,
 *   minUsageCount: 1
 * })
 *
 * for (const template of result.stale) {
 *   console.log(`${template.name}: ${template.reason} (${template.daysSinceUsed} days)`)
 * }
 * ```
 */
export async function findStaleTemplates(
  options: FindStaleTemplatesOptions
): Promise<StaleTemplatesResult> {
  const {
    appId,
    unusedDays = 90,
    minUsageCount = 1,
    maxEditRate = 0.5,
    includeLowMatch = true,
  } = options

  const index = getVectorIndex()
  const now = Date.now()
  const unusedThreshold = now - unusedDays * 24 * 60 * 60 * 1000

  // Query all templates for this app from vector store
  // Using a generic query with high topK to get all templates
  const filter = `type = 'response' AND source = 'canned-response' AND appId = '${appId}'`

  // Upstash doesn't have a "list all" API, so we query with a generic term
  // and high topK to retrieve as many templates as possible
  const results = await index.query({
    data: 'support customer help', // Generic query to match templates
    topK: 1000, // Get up to 1000 templates
    includeMetadata: true,
    includeData: true,
    filter,
  })

  const staleTemplates: StaleTemplate[] = []
  const byReason: Record<StaleReason, number> = {
    unused: 0,
    low_match: 0,
    high_edit_rate: 0,
    superseded: 0,
  }

  for (const result of results) {
    const metadata = result.metadata as VectorDocumentMetadata | undefined
    if (!metadata) continue

    const templateId = String(result.id)
    const frontId = extractFrontId(templateId)
    const name = metadata.title || 'Unknown'
    const usageCount = metadata.usageCount || 0
    const lastUpdatedStr = metadata.lastUpdated
    const editRate = calculateEditRate(metadata)

    // Calculate days since last use (using lastUpdated as proxy)
    const lastUpdated = lastUpdatedStr
      ? new Date(lastUpdatedStr).getTime()
      : now - unusedDays * 24 * 60 * 60 * 1000 - 1 // Assume stale if no lastUpdated
    const daysSinceUsed = Math.floor(
      (now - lastUpdated) / (24 * 60 * 60 * 1000)
    )

    // Check stale reasons (in priority order)
    let reason: StaleReason | null = null

    // 1. Check if unused
    if (usageCount < minUsageCount && daysSinceUsed >= unusedDays) {
      reason = 'unused'
    }
    // 2. Check edit rate (if we have usage data)
    else if (
      editRate !== undefined &&
      editRate > maxEditRate &&
      usageCount > 0
    ) {
      reason = 'high_edit_rate'
    }
    // 3. Check low match (very low relevance scores)
    else if (
      includeLowMatch &&
      result.score < 0.6 && // Low relevance to generic query suggests niche/outdated
      usageCount === 0 &&
      daysSinceUsed > unusedDays / 2
    ) {
      reason = 'low_match'
    }

    if (reason) {
      staleTemplates.push({
        templateId,
        frontId,
        name,
        reason,
        daysSinceUsed,
        usageCount,
        editRate,
        lastMatchConfidence: result.score,
      })
      byReason[reason]++
    }
  }

  // Sort by days since used (most stale first)
  staleTemplates.sort((a, b) => b.daysSinceUsed - a.daysSinceUsed)

  return {
    stale: staleTemplates,
    totalScanned: results.length,
    activeCount: results.length - staleTemplates.length,
    byReason,
    scannedAt: new Date().toISOString(),
  }
}

/**
 * Find stale templates across all apps.
 *
 * @returns Map of app slug to stale templates result
 */
export async function findAllStaleTemplates(
  options?: Omit<FindStaleTemplatesOptions, 'appId'>
): Promise<Map<string, StaleTemplatesResult>> {
  // Lazy import to avoid circular dependencies
  const { database, AppsTable } = await import('@skillrecordings/database')

  const apps = await database.select().from(AppsTable)
  const results = new Map<string, StaleTemplatesResult>()

  for (const app of apps) {
    try {
      const staleResult = await findStaleTemplates({
        appId: app.slug,
        ...options,
      })
      results.set(app.slug, staleResult)
    } catch (error) {
      console.error(`[stale-templates] Error scanning ${app.slug}:`, error)
      results.set(app.slug, {
        stale: [],
        totalScanned: 0,
        activeCount: 0,
        byReason: { unused: 0, low_match: 0, high_edit_rate: 0, superseded: 0 },
        scannedAt: new Date().toISOString(),
      })
    }
  }

  return results
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the original Front template ID from the vector document ID.
 * Vector IDs are stored as `front_template_{frontId}`.
 */
function extractFrontId(vectorId: string): string {
  const prefix = 'front_template_'
  if (vectorId.startsWith(prefix)) {
    return vectorId.slice(prefix.length)
  }
  return vectorId
}

/**
 * Calculate edit rate from metadata.
 *
 * Edit rate = edits / usageCount
 * This indicates how often template responses needed human modification.
 */
function calculateEditRate(
  metadata: VectorDocumentMetadata
): number | undefined {
  const usageCount = metadata.usageCount || 0
  // TODO: Track edit count in metadata when template gardening system is complete
  // For now, return undefined as we don't have this data yet
  // const editCount = metadata.editCount || 0
  // return usageCount > 0 ? editCount / usageCount : undefined
  return undefined
}

// ============================================================================
// Formatting / Reporting
// ============================================================================

/**
 * Format stale templates into a Slack-friendly report.
 *
 * @param appSlug - App identifier
 * @param result - Stale templates result
 * @returns Formatted markdown report
 */
export function formatStaleReport(
  appSlug: string,
  result: StaleTemplatesResult
): string {
  const lines: string[] = []

  lines.push(`*📋 Stale Template Report: ${appSlug}*`)
  lines.push(`Scanned: ${result.totalScanned} templates`)
  lines.push(`Active: ${result.activeCount} | Stale: ${result.stale.length}`)
  lines.push('')

  if (result.stale.length === 0) {
    lines.push('✅ No stale templates found!')
    return lines.join('\n')
  }

  lines.push('*Breakdown by reason:*')
  if (result.byReason.unused > 0) {
    lines.push(`• Unused (>${90} days): ${result.byReason.unused}`)
  }
  if (result.byReason.high_edit_rate > 0) {
    lines.push(`• High edit rate: ${result.byReason.high_edit_rate}`)
  }
  if (result.byReason.low_match > 0) {
    lines.push(`• Low match rate: ${result.byReason.low_match}`)
  }
  if (result.byReason.superseded > 0) {
    lines.push(`• Superseded: ${result.byReason.superseded}`)
  }

  lines.push('')
  lines.push('*Top stale templates:*')

  // Show top 10 stale templates
  const top10 = result.stale.slice(0, 10)
  for (const template of top10) {
    const reasonEmoji = {
      unused: '💤',
      low_match: '📉',
      high_edit_rate: '✏️',
      superseded: '🔄',
    }[template.reason]

    lines.push(
      `${reasonEmoji} *${template.name}* - ${template.daysSinceUsed}d unused, ${template.usageCount} uses`
    )
  }

  if (result.stale.length > 10) {
    lines.push(`_...and ${result.stale.length - 10} more_`)
  }

  return lines.join('\n')
}

/**
 * Build summary statistics across all apps.
 */
export function buildStalesSummary(
  results: Map<string, StaleTemplatesResult>
): {
  totalApps: number
  totalTemplates: number
  totalStale: number
  byReason: Record<StaleReason, number>
} {
  let totalTemplates = 0
  let totalStale = 0
  const byReason: Record<StaleReason, number> = {
    unused: 0,
    low_match: 0,
    high_edit_rate: 0,
    superseded: 0,
  }

  for (const result of results.values()) {
    totalTemplates += result.totalScanned
    totalStale += result.stale.length
    byReason.unused += result.byReason.unused
    byReason.low_match += result.byReason.low_match
    byReason.high_edit_rate += result.byReason.high_edit_rate
    byReason.superseded += result.byReason.superseded
  }

  return {
    totalApps: results.size,
    totalTemplates,
    totalStale,
    byReason,
  }
}
