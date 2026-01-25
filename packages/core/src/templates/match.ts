/**
 * Template matching module for finding and using canned responses.
 *
 * Before generating an LLM draft, checks if a high-confidence template
 * match exists in the vector store. If found with sufficient confidence,
 * uses the template instead of generating a fresh response.
 */

import type { GatherOutput } from '../pipeline/types'
import { queryVectors } from '../vector/client'

// ============================================================================
// Types
// ============================================================================

export interface TemplateMatch {
  templateId: string
  content: string
  name: string
  confidence: number
  frontId: string // Original Front template ID
}

export interface MatchTemplateOptions {
  /** App ID for scoping template search */
  appId: string
  /** Message category for relevance */
  category: string
  /** Gathered context including user/purchase info */
  context: GatherOutput
  /** Query text (usually message subject + body) */
  query: string
  /** Minimum confidence threshold (default 0.9) */
  threshold?: number
  /** Maximum templates to consider (default 5) */
  topK?: number
}

export interface TemplateMatchResult {
  match: TemplateMatch | null
  /** All candidates considered (for debugging/analytics) */
  candidates: Array<{
    templateId: string
    name: string
    score: number
  }>
  /** Time taken to match in ms */
  durationMs: number
}

export interface TemplateUsageLog {
  type: 'template_match' | 'llm_generation'
  templateId?: string
  templateName?: string
  confidence?: number
  appId: string
  category: string
  timestamp: number
}

// ============================================================================
// Template Matching
// ============================================================================

/**
 * Attempt to find a high-confidence template match for the given query.
 *
 * Searches the vector store for templates (type='response', source='canned-response')
 * and returns the best match if it exceeds the confidence threshold.
 *
 * @param options - Match options including query, appId, and threshold
 * @returns TemplateMatch if found above threshold, null otherwise
 *
 * @example
 * ```ts
 * const result = await matchTemplate({
 *   appId: 'total-typescript',
 *   category: 'support_access',
 *   context: gatherResult,
 *   query: 'I cannot access my course',
 *   threshold: 0.9
 * })
 *
 * if (result.match) {
 *   // Use template instead of LLM
 *   const response = interpolateTemplate(result.match.content, {
 *     customer_name: context.user?.name || 'there'
 *   })
 * }
 * ```
 */
export async function matchTemplate(
  options: MatchTemplateOptions
): Promise<TemplateMatchResult> {
  const { appId, query, threshold = 0.9, topK = 5 } = options

  const startTime = Date.now()

  // Build filter for templates only
  // Filter: type='response' AND source='canned-response' AND appId matches
  const filter = `type = 'response' AND source = 'canned-response' AND appId = '${appId}'`

  const results = await queryVectors({
    data: query,
    topK,
    includeMetadata: true,
    includeData: true,
    filter,
  })

  const candidates = results.map((r) => ({
    templateId: r.id,
    name: r.metadata?.title || 'Unknown',
    score: r.score,
  }))

  // Find best match above threshold
  const bestMatch = results.find((r) => r.score >= threshold)

  const match: TemplateMatch | null = bestMatch
    ? {
        templateId: bestMatch.id,
        content: bestMatch.data || '',
        name: bestMatch.metadata?.title || 'Unknown',
        confidence: bestMatch.score,
        // Extract Front ID from the vector ID (format: front_template_{id})
        frontId: extractFrontId(bestMatch.id),
      }
    : null

  return {
    match,
    candidates,
    durationMs: Date.now() - startTime,
  }
}

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

// ============================================================================
// Template Interpolation
// ============================================================================

/**
 * Standard template variables that can be interpolated.
 */
export interface TemplateVariables {
  customer_name?: string
  product_name?: string
  email?: string
  [key: string]: string | undefined
}

/**
 * Build template variables from gathered context.
 *
 * @param context - Gathered context from pipeline
 * @returns Variables ready for interpolation
 */
export function buildTemplateVariables(
  context: GatherOutput
): TemplateVariables {
  return {
    customer_name: context.user?.name || undefined,
    email: context.user?.email || undefined,
    product_name: context.purchases[0]?.productName || undefined,
  }
}

/**
 * Interpolate template variables in content.
 *
 * Replaces `{{variable_name}}` patterns with corresponding values.
 * Unknown variables are left as-is to avoid breaking templates.
 *
 * @param content - Template content with {{variable}} placeholders
 * @param variables - Key-value pairs for substitution
 * @returns Interpolated content
 *
 * @example
 * ```ts
 * const result = interpolateTemplate(
 *   'Hi {{customer_name}}, your {{product_name}} purchase is confirmed.',
 *   { customer_name: 'Joel', product_name: 'Total TypeScript' }
 * )
 * // => 'Hi Joel, your Total TypeScript purchase is confirmed.'
 * ```
 */
export function interpolateTemplate(
  content: string,
  variables: TemplateVariables
): string {
  // Match {{variable_name}} patterns (with optional whitespace)
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, varName) => {
    const value = variables[varName]
    // Return the value if defined, otherwise keep the placeholder
    return value !== undefined ? value : match
  })
}

/**
 * Check if a template has unresolved variables after interpolation.
 *
 * @param content - Interpolated content
 * @returns Array of unresolved variable names
 */
export function findUnresolvedVariables(content: string): string[] {
  const matches = content.match(/\{\{\s*(\w+)\s*\}\}/g) || []
  return matches.map((m) => m.replace(/\{\{\s*|\s*\}\}/g, ''))
}

// ============================================================================
// Usage Tracking
// ============================================================================

/**
 * Log template usage for analytics.
 *
 * This function logs whether a template was used vs LLM generation.
 * In production, this could write to a database, send to analytics, etc.
 *
 * @param log - Usage log entry
 */
export function logTemplateUsage(log: TemplateUsageLog): void {
  // For now, just console log. In production, send to analytics service.
  if (log.type === 'template_match') {
    console.log(
      `[template-usage] TEMPLATE_MATCH appId=${log.appId} category=${log.category} ` +
        `templateId=${log.templateId} templateName="${log.templateName}" ` +
        `confidence=${log.confidence?.toFixed(3)}`
    )
  } else {
    console.log(
      `[template-usage] LLM_GENERATION appId=${log.appId} category=${log.category}`
    )
  }
}

/**
 * Create a usage log entry for template match.
 */
export function createTemplateUsageLog(
  appId: string,
  category: string,
  match: TemplateMatch | null
): TemplateUsageLog {
  if (match) {
    return {
      type: 'template_match',
      templateId: match.templateId,
      templateName: match.name,
      confidence: match.confidence,
      appId,
      category,
      timestamp: Date.now(),
    }
  }
  return {
    type: 'llm_generation',
    appId,
    category,
    timestamp: Date.now(),
  }
}
