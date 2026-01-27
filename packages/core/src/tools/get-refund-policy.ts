import { IntegrationClient } from '@skillrecordings/sdk/client'
import { RefundPolicySchema } from '@skillrecordings/sdk/types'
import type { RefundPolicy } from '@skillrecordings/sdk/types'
import { z } from 'zod'
import { getApp } from '../services/app-registry'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Parameters for checking refund policy.
 */
const getRefundPolicyParams = z.object({
  /**
   * App ID to query the correct integration endpoint
   */
  appId: z.string().min(1, 'App ID is required'),
})

/**
 * Result returned by getRefundPolicy tool.
 * Wraps RefundPolicy with a human-readable summary.
 */
export interface RefundPolicyResult {
  /** Whether the policy was found */
  found: boolean
  /** Refund policy data if found */
  policy: RefundPolicy | null
  /** Human-readable summary for agent response */
  summary: string
  /** Error message if check failed */
  error?: string
}

/**
 * Format refund policy summary for agent to use in responses.
 */
function formatPolicySummary(policy: RefundPolicy): string {
  const parts: string[] = []

  parts.push(
    `Auto-approved refunds: within ${policy.autoApproveWindowDays} days of purchase.`
  )
  parts.push(
    `Manual approval: ${policy.autoApproveWindowDays}-${policy.manualApproveWindowDays} days after purchase.`
  )

  if (policy.noRefundAfterDays) {
    parts.push(`No refunds after ${policy.noRefundAfterDays} days.`)
  }

  if (policy.specialConditions && policy.specialConditions.length > 0) {
    parts.push('Special conditions:')
    for (const condition of policy.specialConditions) {
      parts.push(`• ${condition}`)
    }
  }

  if (policy.policyUrl) {
    parts.push(`Full policy: ${policy.policyUrl}`)
  }

  return parts.join('\n')
}

/**
 * Get the refund policy for an app.
 *
 * Returns auto-approval and manual-approval windows, special conditions,
 * and policy URL. Use this instead of hardcoded defaults — each app may
 * have different refund windows.
 *
 * @example
 * ```typescript
 * // Customer asks: "What's your refund policy?"
 * const result = await getRefundPolicy.execute({
 *   appId: 'total-typescript',
 * }, context)
 *
 * if (result.success && result.data.policy) {
 *   // Agent: "Refunds are automatically approved within 30 days of purchase."
 * }
 * ```
 */
export const getRefundPolicy = createTool({
  name: 'get_refund_policy',
  description:
    'Get the refund policy for an app. Returns auto-approval window (days), manual-approval window (days), hard cutoff, special conditions, and policy URL. Use this instead of assuming a fixed refund window — each product may differ.',
  parameters: getRefundPolicyParams,
  execute: async (
    { appId },
    context: ExecutionContext
  ): Promise<RefundPolicyResult> => {
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

    // Call getRefundPolicy
    let policy: RefundPolicy
    try {
      policy = await client.getRefundPolicy()
    } catch (error) {
      if (error instanceof Error && error.message.includes('not implemented')) {
        return {
          found: false,
          policy: null,
          summary:
            'This app does not provide a custom refund policy. Default policy applies: 30 days auto-approved, 30-45 days manual approval.',
          error: 'Method not implemented by app',
        }
      }
      throw error
    }

    // Validate response matches expected schema
    const parsed = RefundPolicySchema.safeParse(policy)
    if (!parsed.success) {
      throw new Error(
        `App returned invalid RefundPolicy format: ${JSON.stringify(parsed.error.issues)}`
      )
    }

    return {
      found: true,
      policy: parsed.data,
      summary: formatPolicySummary(parsed.data),
    }
  },
})
