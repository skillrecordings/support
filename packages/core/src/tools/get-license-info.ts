import { IntegrationClient } from '@skillrecordings/sdk/client'
import { LicenseInfoSchema } from '@skillrecordings/sdk/types'
import type { LicenseInfo } from '@skillrecordings/sdk/types'
import { z } from 'zod'
import { getApp } from '../services/app-registry'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Parameters for checking license info.
 */
const getLicenseInfoParams = z.object({
  /**
   * Purchase ID for the team/enterprise license
   */
  purchaseId: z.string().min(1, 'Purchase ID is required'),
  /**
   * App ID to query the correct integration endpoint
   */
  appId: z.string().min(1, 'App ID is required'),
})

/**
 * Result returned by getLicenseInfo tool.
 * Wraps LicenseInfo with a human-readable summary.
 */
export interface LicenseInfoResult {
  /** Whether the lookup was successful */
  found: boolean
  /** License info data if found */
  license: LicenseInfo | null
  /** Human-readable summary for agent response */
  summary: string
  /** Error message if check failed */
  error?: string
}

/**
 * Format license info summary for agent to use in responses.
 */
function formatLicenseSummary(license: LicenseInfo): string {
  const parts: string[] = []

  parts.push(
    `License type: ${license.licenseType} (purchase ${license.purchaseId}).`
  )
  parts.push(
    `Seats: ${license.claimedSeats}/${license.totalSeats} claimed, ${license.availableSeats} available.`
  )

  if (license.expiresAt) {
    parts.push(`Expires: ${license.expiresAt}.`)
  } else {
    parts.push('No expiration (lifetime license).')
  }

  if (license.adminEmail) {
    parts.push(`License admin: ${license.adminEmail}.`)
  }

  if (license.claimedBy.length > 0) {
    parts.push(`Claimed seats (${license.claimedBy.length}):`)
    for (const seat of license.claimedBy.slice(0, 10)) {
      const lastActive = seat.lastActiveAt
        ? `, last active ${seat.lastActiveAt}`
        : ''
      parts.push(`• ${seat.email} (claimed ${seat.claimedAt}${lastActive})`)
    }
    if (license.claimedBy.length > 10) {
      parts.push(`  ...and ${license.claimedBy.length - 10} more`)
    }
  } else {
    parts.push('No seats claimed yet.')
  }

  return parts.join('\n')
}

/**
 * Check team license details for a purchase.
 *
 * Returns seat counts, claimed members, license type, and admin info.
 * Use this when customers ask about team/enterprise seat allocation,
 * adding team members, or license management.
 *
 * @example
 * ```typescript
 * // Customer asks: "How many seats do we have left on our team license?"
 * const result = await getLicenseInfo.execute({
 *   purchaseId: 'purchase-456',
 *   appId: 'total-typescript',
 * }, context)
 *
 * if (result.success && result.data.license) {
 *   const { availableSeats, totalSeats } = result.data.license
 *   // Agent: "Your team license has 5 of 20 seats remaining."
 * }
 * ```
 */
export const getLicenseInfo = createTool({
  name: 'get_license_info',
  description:
    'Check team license details for a purchase. Returns license type (individual/team/enterprise/site), total and claimed seat counts, list of claimed members with emails and activity dates, license expiration, and admin email. Use this when customers ask about team seats, adding members, or license management.',
  parameters: getLicenseInfoParams,
  execute: async (
    { purchaseId, appId },
    context: ExecutionContext
  ): Promise<LicenseInfoResult> => {
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

    // Call getLicenseInfo — uses requestOptional internally (returns null for 501)
    let license: LicenseInfo | null
    try {
      license = await client.getLicenseInfo(purchaseId)
    } catch (error) {
      if (error instanceof Error && error.message.includes('not implemented')) {
        return {
          found: false,
          license: null,
          summary:
            'This app does not support license info queries. Cannot check team seat details.',
          error: 'Method not implemented by app',
        }
      }
      throw error
    }

    // getLicenseInfo returns null for non-team purchases or 501 responses
    if (!license) {
      return {
        found: false,
        license: null,
        summary: `No license information found for purchase ${purchaseId}. This may be an individual purchase (not a team license), or the app does not support license queries.`,
      }
    }

    // Validate response matches expected schema
    const parsed = LicenseInfoSchema.safeParse(license)
    if (!parsed.success) {
      throw new Error(
        `App returned invalid LicenseInfo format: ${JSON.stringify(parsed.error.issues)}`
      )
    }

    return {
      found: true,
      license: parsed.data,
      summary: formatLicenseSummary(parsed.data),
    }
  },
})
