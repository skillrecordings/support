/**
 * Data integrity assertion helper for pipeline steps.
 *
 * Throws with structured logging when critical fields are empty/missing
 * at step boundaries. Used to catch data loss bugs early.
 */

import { log } from '../observability/axiom'

/**
 * Assert that all specified fields are non-empty.
 * Throws an Error if any field is undefined, null, or empty string.
 *
 * @param step - Pipeline step name (e.g., "draft-response/receive")
 * @param fields - Record of field names to their values
 */
export async function assertDataIntegrity(
  step: string,
  fields: Record<string, unknown>
): Promise<void> {
  for (const [name, value] of Object.entries(fields)) {
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      const error = `Data integrity violation at ${step}: ${name} is empty`
      await log('error', error, { step, field: name, value })
      throw new Error(error)
    }
  }
}

/**
 * Build a data flow diagnostic object for structured logging.
 * Shows which fields are present vs empty and their sizes.
 *
 * @param step - Pipeline step name
 * @param direction - "receiving" or "emitting"
 * @param data - The event data to diagnose
 */
export function buildDataFlowCheck(
  step: string,
  direction: 'receiving' | 'emitting',
  data: {
    subject?: string
    body?: string
    history?: unknown[]
    purchases?: unknown[]
    category?: string
    confidence?: number
    reasoning?: string
    draftContent?: string
    signals?: Record<string, boolean>
  }
): Record<string, unknown> {
  return {
    data_flow_check: true,
    step,
    direction,
    // Field presence
    hasSubject: !!data.subject,
    hasBody: !!data.body,
    hasHistory: Array.isArray(data.history) && data.history.length > 0,
    hasPurchases: Array.isArray(data.purchases) && data.purchases.length > 0,
    hasCategory: !!data.category,
    hasConfidence: data.confidence !== undefined && data.confidence !== null,
    hasReasoning: !!data.reasoning,
    hasDraftContent: !!data.draftContent,
    hasSignals: !!data.signals,
    // Field sizes
    subjectLength: data.subject?.length ?? 0,
    bodyLength: data.body?.length ?? 0,
    historyCount: data.history?.length ?? 0,
    purchaseCount: data.purchases?.length ?? 0,
    draftContentLength: data.draftContent?.length ?? 0,
    signalCount: data.signals ? Object.keys(data.signals).length : 0,
  }
}
