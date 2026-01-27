import { IntegrationClient } from '@skillrecordings/sdk/client'
import { UserActivitySchema } from '@skillrecordings/sdk/types'
import type { UserActivity } from '@skillrecordings/sdk/types'
import { z } from 'zod'
import { getApp } from '../services/app-registry'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Parameters for checking recent user activity.
 */
const getRecentActivityParams = z.object({
  /**
   * User ID to check activity for
   */
  userId: z.string().min(1, 'User ID is required'),
  /**
   * App ID to query the correct integration endpoint
   */
  appId: z.string().min(1, 'App ID is required'),
})

/**
 * Result returned by getRecentActivity tool.
 * Wraps UserActivity with a human-readable summary.
 */
export interface RecentActivityResult {
  /** Whether the lookup was successful */
  found: boolean
  /** User activity data if found */
  activity: UserActivity | null
  /** Human-readable summary for agent response */
  summary: string
  /** Error message if check failed */
  error?: string
}

/**
 * Format activity summary for agent to use in responses.
 */
function formatActivitySummary(activity: UserActivity): string {
  const parts: string[] = []

  // Login info
  if (activity.lastLoginAt) {
    parts.push(`Last login: ${activity.lastLoginAt}.`)
  } else {
    parts.push('No login recorded.')
  }

  if (activity.lastActiveAt) {
    parts.push(`Last active: ${activity.lastActiveAt}.`)
  }

  // Progress
  parts.push(
    `Progress: ${activity.lessonsCompleted}/${activity.totalLessons} lessons completed (${activity.completionPercent}%).`
  )

  // Recent items
  if (activity.recentItems.length > 0) {
    parts.push(`Recent activity (${activity.recentItems.length} items):`)
    for (const item of activity.recentItems.slice(0, 5)) {
      const typeLabel = item.type.replace(/_/g, ' ')
      parts.push(`• ${typeLabel}: ${item.title} (${item.timestamp})`)
    }
    if (activity.recentItems.length > 5) {
      parts.push(`  ...and ${activity.recentItems.length - 5} more`)
    }
  } else {
    parts.push('No recent activity recorded.')
  }

  return parts.join('\n')
}

/**
 * Check a user's recent activity and progress.
 *
 * Returns last login, completion percentage, and recent actions. Use this
 * to debug access issues ("when did they last log in?") and for refund
 * triage ("have they actually used the product?").
 *
 * @example
 * ```typescript
 * // Customer requests a refund — check if they've used the product
 * const result = await getRecentActivity.execute({
 *   userId: 'user-123',
 *   appId: 'total-typescript',
 * }, context)
 *
 * if (result.success && result.data.activity) {
 *   const { completionPercent, lastLoginAt } = result.data.activity
 *   // Agent: "I can see you've completed 15% of the course and last logged in 3 days ago."
 * }
 * ```
 */
export const getRecentActivity = createTool({
  name: 'get_recent_activity',
  description:
    "Check a user's recent activity and progress. Returns last login, lesson completion percentage, and recent actions (lessons completed, exercises submitted, downloads). Use this for refund triage (has the user actually used the product?) and access debugging (when did they last log in?).",
  parameters: getRecentActivityParams,
  execute: async (
    { userId, appId },
    context: ExecutionContext
  ): Promise<RecentActivityResult> => {
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

    // Call getRecentActivity — handle 501 Not Implemented gracefully
    let activity: UserActivity | null
    try {
      activity = await client.getRecentActivity(userId)
    } catch (error) {
      if (error instanceof Error && error.message.includes('not implemented')) {
        return {
          found: false,
          activity: null,
          summary:
            'This app does not support activity tracking. Cannot check user progress or login history.',
          error: 'Method not implemented by app',
        }
      }
      throw error
    }

    if (!activity) {
      return {
        found: false,
        activity: null,
        summary: `No activity data found for user ${userId}.`,
      }
    }

    // Validate response matches expected schema
    const parsed = UserActivitySchema.safeParse(activity)
    if (!parsed.success) {
      throw new Error(
        `App returned invalid UserActivity format: ${JSON.stringify(parsed.error.issues)}`
      )
    }

    return {
      found: true,
      activity: parsed.data,
      summary: formatActivitySummary(parsed.data),
    }
  },
})
