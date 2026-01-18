import { queryVectors } from '../vector/client'

/**
 * Result of matching against canned responses
 */
export interface CannedMatch {
  /** Whether a match was found above threshold */
  matched: boolean
  /** The matched response text (if matched) */
  response?: string
  /** ID of the matched template (if matched) */
  templateId?: string
  /** Similarity score from vector search (if matched) */
  similarity?: number
}

/**
 * Match a message against canned responses using vector similarity.
 *
 * Searches the vector store for type='response' documents filtered by appId.
 * Returns a match if the top result exceeds the similarity threshold.
 *
 * @param message - The message to match against canned responses
 * @param appId - App ID to filter responses
 * @param threshold - Minimum similarity score (default: 0.92)
 * @returns CannedMatch with match status and response if found
 *
 * @example
 * ```ts
 * const match = await matchCannedResponse(
 *   'I want a refund please',
 *   'totaltypescript',
 *   0.92
 * )
 *
 * if (match.matched) {
 *   console.log(match.response) // Canned response text
 *   console.log(match.templateId) // resp-refund-standard
 *   console.log(match.similarity) // 0.95
 * }
 * ```
 */
export async function matchCannedResponse(
  message: string,
  appId: string,
  threshold: number = 0.92
): Promise<CannedMatch> {
  // Query vector store for type='response' docs filtered by appId
  const results = await queryVectors({
    data: message,
    topK: 1,
    includeMetadata: true,
    includeData: true,
    filter: `appId = "${appId}" AND type = "response"`,
  })

  // No results or no data in result
  if (results.length === 0 || !results[0]?.data) {
    return { matched: false }
  }

  const topResult = results[0]
  const score = topResult.score

  // Check if score meets threshold
  if (score < threshold) {
    return { matched: false }
  }

  return {
    matched: true,
    response: topResult.data,
    templateId: topResult.id,
    similarity: score,
  }
}

/**
 * Interpolate variables in a canned response template.
 *
 * Replaces {{variable_name}} placeholders with provided values.
 * Preserves template syntax for missing variables.
 *
 * @param template - Template string with {{variable}} placeholders
 * @param variables - Object mapping variable names to values
 * @returns Interpolated string
 *
 * @example
 * ```ts
 * const template = 'Hi {{customer_name}}, your {{product_name}} is ready.'
 * const result = interpolateTemplate(template, {
 *   customer_name: 'Alice',
 *   product_name: 'Total TypeScript'
 * })
 * // => 'Hi Alice, your Total TypeScript is ready.'
 * ```
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return variables[varName] ?? match
  })
}
