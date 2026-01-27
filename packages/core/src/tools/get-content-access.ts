import { IntegrationClient } from '@skillrecordings/sdk/client'
import { ContentAccessSchema } from '@skillrecordings/sdk/types'
import type { ContentAccess } from '@skillrecordings/sdk/types'
import { z } from 'zod'
import { getApp } from '../services/app-registry'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Parameters for checking content access.
 */
const getContentAccessParams = z.object({
  /**
   * User ID to check access for
   */
  userId: z.string().min(1, 'User ID is required'),
  /**
   * App ID to query the correct integration endpoint
   */
  appId: z.string().min(1, 'App ID is required'),
})

/**
 * Result returned by getContentAccess tool.
 * Wraps ContentAccess with a human-readable summary.
 */
export interface ContentAccessResult {
  /** Whether the lookup was successful */
  found: boolean
  /** Content access data if found */
  access: ContentAccess | null
  /** Human-readable summary for agent response */
  summary: string
  /** Error message if check failed */
  error?: string
}

/**
 * Format content access summary for agent to use in responses.
 */
function formatAccessSummary(access: ContentAccess): string {
  const parts: string[] = []

  if (access.products.length === 0) {
    parts.push('User has no product access.')
    return parts.join(' ')
  }

  parts.push(`User has access to ${access.products.length} product(s):`)

  for (const product of access.products) {
    const accessDesc = `${product.productName} (${product.accessLevel})`
    if (product.expiresAt) {
      parts.push(`• ${accessDesc} — expires ${product.expiresAt}`)
    } else {
      parts.push(`• ${accessDesc} — lifetime access`)
    }

    if (product.modules && product.modules.length > 0) {
      const accessible = product.modules.filter((m) => m.accessible).length
      parts.push(
        `  Modules: ${accessible}/${product.modules.length} accessible`
      )
    }
  }

  if (access.teamMembership) {
    const team = access.teamMembership
    parts.push(
      `Team membership: ${team.teamName} (${team.role}), seat claimed ${team.seatClaimedAt}.`
    )
  }

  return parts.join('\n')
}

/**
 * Check what content a user can actually access.
 *
 * Goes beyond purchase data to show per-product and per-module access levels,
 * including team membership. Use this to debug access issues — "I bought the
 * course but can't see lesson X".
 *
 * @example
 * ```typescript
 * // Customer says: "I can't access the advanced modules"
 * const result = await getContentAccess.execute({
 *   userId: 'user-123',
 *   appId: 'total-typescript',
 * }, context)
 *
 * if (result.success && result.data.access) {
 *   // Check which modules are accessible vs not
 *   const product = result.data.access.products[0]
 *   const blocked = product.modules?.filter(m => !m.accessible)
 *   // Agent: "I can see you have partial access. These modules are locked: ..."
 * }
 * ```
 */
export const getContentAccess = createTool({
  name: 'get_content_access',
  description:
    'Check what content a user can actually access. Use this to debug access issues — shows per-product access levels, individual module access, team membership, and expiration dates. More granular than purchase history alone.',
  parameters: getContentAccessParams,
  execute: async (
    { userId, appId },
    context: ExecutionContext
  ): Promise<ContentAccessResult> => {
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

    // Call getContentAccess — handle 501 Not Implemented gracefully
    let access: ContentAccess | null
    try {
      access = await client.getContentAccess(userId)
    } catch (error) {
      if (error instanceof Error && error.message.includes('not implemented')) {
        return {
          found: false,
          access: null,
          summary:
            'This app does not support content access checking. Try using purchase history instead.',
          error: 'Method not implemented by app',
        }
      }
      throw error
    }

    if (!access) {
      return {
        found: false,
        access: null,
        summary: `No content access data found for user ${userId}.`,
      }
    }

    // Validate response matches expected schema
    const parsed = ContentAccessSchema.safeParse(access)
    if (!parsed.success) {
      throw new Error(
        `App returned invalid ContentAccess format: ${JSON.stringify(parsed.error.issues)}`
      )
    }

    return {
      found: true,
      access: parsed.data,
      summary: formatAccessSummary(parsed.data),
    }
  },
})
