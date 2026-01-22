import { IntegrationClient } from '@skillrecordings/sdk/client'
import { ProductStatusSchema } from '@skillrecordings/sdk/types'
import type { ProductStatus } from '@skillrecordings/sdk/types'
import { z } from 'zod'
import { getApp } from '../services/app-registry'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Parameters for checking product availability.
 */
const checkProductAvailabilityParams = z.object({
  /**
   * Product identifier (slug or ID)
   */
  productId: z.string().min(1, 'Product ID is required'),
  /**
   * App ID to query the correct integration endpoint
   */
  appId: z.string().min(1, 'App ID is required'),
})

/**
 * Result returned by checkProductAvailability tool.
 * Extends ProductStatus with human-readable summary.
 */
export interface ProductAvailabilityResult {
  /** Whether the check was successful */
  found: boolean
  /** Product status data if found */
  status: ProductStatus | null
  /** Human-readable summary for agent response */
  summary: string
  /** Error message if check failed */
  error?: string
}

/**
 * Format availability summary for agent to use in responses.
 */
function formatAvailabilitySummary(status: ProductStatus): string {
  const parts: string[] = []

  // Product type context
  if (status.productType === 'self-paced') {
    parts.push('This is a self-paced course.')
  } else if (status.productType === 'live') {
    parts.push('This is a live workshop.')
  } else if (status.productType === 'cohort') {
    parts.push('This is a cohort-based course.')
  }

  // Availability status
  if (status.soldOut) {
    parts.push('SOLD OUT.')
    if (status.quantityAvailable > 0) {
      parts.push(`All ${status.quantityAvailable} seats have been claimed.`)
    }
  } else if (!status.available) {
    parts.push('Currently unavailable.')
    if (status.state === 'draft') {
      parts.push('Not yet released.')
    } else if (status.state === 'archived') {
      parts.push('This product has been archived.')
    }
  } else {
    parts.push('Available for purchase.')
    if (status.quantityAvailable > 0 && status.quantityRemaining >= 0) {
      parts.push(
        `${status.quantityRemaining} of ${status.quantityAvailable} seats remaining.`
      )
    } else if (status.quantityAvailable === -1) {
      parts.push('Unlimited availability.')
    }
  }

  // Enrollment window for cohorts
  if (status.enrollmentOpen || status.enrollmentClose) {
    if (status.enrollmentOpen && status.enrollmentClose) {
      parts.push(
        `Enrollment window: ${status.enrollmentOpen} to ${status.enrollmentClose}.`
      )
    } else if (status.enrollmentClose) {
      parts.push(`Enrollment closes: ${status.enrollmentClose}.`)
    }
  }

  // Event dates for live events
  if (status.startsAt) {
    parts.push(`Starts: ${status.startsAt}.`)
  }
  if (status.endsAt) {
    parts.push(`Ends: ${status.endsAt}.`)
  }

  return parts.join(' ')
}

/**
 * Check product availability/inventory status.
 *
 * CRITICAL: The agent should call this BEFORE claiming a product is sold out,
 * unavailable, or making any statements about seat availability. Without this
 * tool, the agent may give incorrect availability information.
 *
 * @example
 * ```typescript
 * // Customer asks: "Is the TypeScript workshop still available?"
 * const result = await checkProductAvailability.execute({
 *   productId: 'ts-workshop-feb-2026',
 *   appId: 'total-typescript',
 * }, context)
 *
 * if (result.success && result.data.status?.soldOut) {
 *   // Agent: "Sorry, this workshop is sold out (0 of 50 seats remaining)"
 * }
 * ```
 */
export const checkProductAvailability = createTool({
  name: 'check_product_availability',
  description:
    'Check product availability and inventory status. ALWAYS use this before telling customers about seat availability, sold-out status, or whether they can purchase a product. Returns availability, remaining seats, and enrollment windows.',
  parameters: checkProductAvailabilityParams,
  execute: async (
    { productId, appId },
    context: ExecutionContext
  ): Promise<ProductAvailabilityResult> => {
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

    // Check if app supports getProductStatus
    let status: ProductStatus | null
    try {
      status = await client.getProductStatus(productId)
    } catch (error) {
      // Handle 501 Not Implemented gracefully
      if (error instanceof Error && error.message.includes('not implemented')) {
        return {
          found: false,
          status: null,
          summary: `This app does not support product availability checking. Cannot verify seat availability.`,
          error: 'Method not implemented by app',
        }
      }
      throw error
    }

    if (!status) {
      return {
        found: false,
        status: null,
        summary: `Product not found: ${productId}. The product may not exist or the app may not support availability checking.`,
      }
    }

    // Validate response matches expected schema
    const parsed = ProductStatusSchema.safeParse(status)
    if (!parsed.success) {
      throw new Error(
        `App returned invalid ProductStatus format: ${JSON.stringify(parsed.error.issues)}`
      )
    }

    return {
      found: true,
      status: parsed.data,
      summary: formatAvailabilitySummary(parsed.data),
    }
  },
})
