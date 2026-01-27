import { IntegrationClient } from '@skillrecordings/sdk/client'
import { PromotionSchema } from '@skillrecordings/sdk/types'
import type { Promotion } from '@skillrecordings/sdk/types'
import { z } from 'zod'
import { getApp } from '../services/app-registry'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Parameters for checking active promotions.
 */
const getActivePromotionsParams = z.object({
  /**
   * App ID to query the correct integration endpoint
   */
  appId: z.string().min(1, 'App ID is required'),
})

/**
 * Result returned by getActivePromotions tool.
 * Wraps Promotion[] with a human-readable summary.
 */
export interface ActivePromotionsResult {
  /** Whether any promotions were found */
  found: boolean
  /** Active promotions list */
  promotions: Promotion[]
  /** Human-readable summary for agent response */
  summary: string
  /** Error message if check failed */
  error?: string
}

/**
 * Format promotions summary for agent to use in responses.
 */
function formatPromotionsSummary(promotions: Promotion[]): string {
  if (promotions.length === 0) {
    return 'No active promotions at this time.'
  }

  const parts: string[] = [`${promotions.length} active promotion(s):`]

  for (const promo of promotions) {
    const discount =
      promo.discountType === 'percent'
        ? `${promo.discountAmount}% off`
        : `$${(promo.discountAmount / 100).toFixed(2)} off`

    let line = `• ${promo.name} — ${discount}`
    if (promo.code) {
      line += ` (code: ${promo.code})`
    }
    if (promo.validUntil) {
      line += ` — expires ${promo.validUntil}`
    }
    if (promo.conditions) {
      line += ` — ${promo.conditions}`
    }
    parts.push(line)
  }

  return parts.join('\n')
}

/**
 * Check active promotions for an app.
 *
 * Returns currently active sales, discounts, and coupon codes. Use this
 * when customers ask about pricing, discounts, or available deals.
 *
 * @example
 * ```typescript
 * // Customer asks: "Are there any discounts available?"
 * const result = await getActivePromotions.execute({
 *   appId: 'total-typescript',
 * }, context)
 *
 * if (result.success && result.data.promotions.length > 0) {
 *   // Agent: "There's currently a 20% off sale running through Friday."
 * }
 * ```
 */
export const getActivePromotions = createTool({
  name: 'get_active_promotions',
  description:
    'Check active promotions and discounts for a product. Returns currently running sales with discount amounts, coupon codes, and validity dates. Use when customers ask about pricing, discounts, or deals.',
  parameters: getActivePromotionsParams,
  execute: async (
    { appId },
    context: ExecutionContext
  ): Promise<ActivePromotionsResult> => {
    // Look up app configuration
    const app = await getApp(appId)
    if (!app) {
      throw new Error(`App not found: ${appId}`)
    }

    // Create integration client
    const client = new IntegrationClient({
      baseUrl: app.integration_base_url,
      webhookSecret: app.webhook_secret,
    })

    // Call getActivePromotions — uses requestOptional internally (returns [] for 501)
    let promotions: Promotion[]
    try {
      promotions = await client.getActivePromotions()
    } catch (error) {
      if (error instanceof Error && error.message.includes('not implemented')) {
        return {
          found: false,
          promotions: [],
          summary:
            'This app does not support promotion queries. Cannot check current discounts.',
          error: 'Method not implemented by app',
        }
      }
      throw error
    }

    // Filter to active promotions only
    const active = promotions.filter((p) => p.active)

    // Validate each promotion matches expected schema
    for (const promo of active) {
      const parsed = PromotionSchema.safeParse(promo)
      if (!parsed.success) {
        throw new Error(
          `App returned invalid Promotion format: ${JSON.stringify(parsed.error.issues)}`
        )
      }
    }

    return {
      found: active.length > 0,
      promotions: active,
      summary: formatPromotionsSummary(active),
    }
  },
})
