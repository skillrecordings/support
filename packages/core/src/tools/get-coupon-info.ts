import { IntegrationClient } from '@skillrecordings/sdk/client'
import { CouponInfoSchema } from '@skillrecordings/sdk/types'
import type { CouponInfo } from '@skillrecordings/sdk/types'
import { z } from 'zod'
import { getApp } from '../services/app-registry'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Parameters for checking coupon info.
 */
const getCouponInfoParams = z.object({
  /**
   * Coupon or discount code to look up
   */
  code: z.string().min(1, 'Coupon code is required'),
  /**
   * App ID to query the correct integration endpoint
   */
  appId: z.string().min(1, 'App ID is required'),
})

/**
 * Result returned by getCouponInfo tool.
 * Wraps CouponInfo with a human-readable summary.
 */
export interface CouponInfoResult {
  /** Whether the coupon was found */
  found: boolean
  /** Coupon info data if found */
  coupon: CouponInfo | null
  /** Human-readable summary for agent response */
  summary: string
  /** Error message if check failed */
  error?: string
}

/**
 * Format coupon info summary for agent to use in responses.
 */
function formatCouponSummary(coupon: CouponInfo): string {
  const parts: string[] = []

  const discount =
    coupon.discountType === 'percent'
      ? `${coupon.discountAmount}% off`
      : `$${(coupon.discountAmount / 100).toFixed(2)} off`

  if (coupon.valid) {
    parts.push(`Coupon "${coupon.code}" is valid — ${discount}.`)
  } else {
    parts.push(`Coupon "${coupon.code}" is not valid.`)
  }

  if (coupon.restrictionType) {
    parts.push(`Restriction: ${coupon.restrictionType}.`)
  }

  if (coupon.maxUses) {
    parts.push(`Usage: ${coupon.usageCount}/${coupon.maxUses} used.`)
  }

  if (coupon.expiresAt) {
    parts.push(`Expires: ${coupon.expiresAt}.`)
  }

  return parts.join(' ')
}

/**
 * Look up coupon or discount code details.
 *
 * Returns whether the code is valid, discount amount, usage limits,
 * and expiration. Use when customers ask about a specific coupon code.
 *
 * @example
 * ```typescript
 * // Customer asks: "Does the code LAUNCH20 still work?"
 * const result = await getCouponInfo.execute({
 *   code: 'LAUNCH20',
 *   appId: 'total-typescript',
 * }, context)
 *
 * if (result.success && result.data.coupon) {
 *   // Agent: "The code LAUNCH20 is valid for 20% off."
 * }
 * ```
 */
export const getCouponInfo = createTool({
  name: 'get_coupon_info',
  description:
    'Look up coupon or discount code details. Returns whether the code is valid, discount type and amount, usage count, max uses, restriction type (PPP, student, bulk), and expiration date. Use when customers ask about a specific coupon or discount code.',
  parameters: getCouponInfoParams,
  execute: async (
    { code, appId },
    context: ExecutionContext
  ): Promise<CouponInfoResult> => {
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

    // Call getCouponInfo — uses requestOptional internally (returns null for 501)
    let coupon: CouponInfo | null
    try {
      coupon = await client.getCouponInfo(code)
    } catch (error) {
      if (error instanceof Error && error.message.includes('not implemented')) {
        return {
          found: false,
          coupon: null,
          summary:
            'This app does not support coupon lookups. Cannot verify the code.',
          error: 'Method not implemented by app',
        }
      }
      throw error
    }

    if (!coupon) {
      return {
        found: false,
        coupon: null,
        summary: `Coupon code "${code}" was not found.`,
      }
    }

    // Validate response matches expected schema
    const parsed = CouponInfoSchema.safeParse(coupon)
    if (!parsed.success) {
      throw new Error(
        `App returned invalid CouponInfo format: ${JSON.stringify(parsed.error.issues)}`
      )
    }

    return {
      found: true,
      coupon: parsed.data,
      summary: formatCouponSummary(parsed.data),
    }
  },
})
