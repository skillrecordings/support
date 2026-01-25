/**
 * Template sync workflow
 *
 * Runs daily at 2am UTC to sync Front templates into the vector store.
 * This enables semantic search for finding relevant response templates
 * during agent-assisted support conversations.
 *
 * Schedule: 0 2 * * * (daily at 2am UTC, before retention cleanup at 3am)
 */

import { inngest } from '../client'

/**
 * Daily cron job to sync Front templates to vector store.
 *
 * Process:
 * 1. Fetch all apps from database
 * 2. For each app, sync templates from Front
 * 3. Upsert templates as 'response' type vectors
 * 4. Return sync report
 *
 * Note: Uses lazy imports inside step to avoid serverless/Turbopack build issues.
 */
export const syncTemplatesWorkflow = inngest.createFunction(
  {
    id: 'sync-templates',
    name: 'Sync Front Templates to Vector Store',
    retries: 3,
    onFailure: async ({ error, event }) => {
      // Log failure for observability
      console.error('[sync-templates] Workflow failed:', {
        error: error.message,
        event: event?.name,
      })
    },
  },
  { cron: '0 2 * * *' }, // Daily at 2am UTC
  async ({ step, logger }) => {
    const report = await step.run('sync-all-templates', async () => {
      // Lazy-init inside step to prevent import-time initialization
      const { syncAllAppTemplates } = await import('../../templates/sync')

      const results = await syncAllAppTemplates()

      // Convert Map to plain object for serialization
      const summary: Record<
        string,
        {
          synced: number
          skipped: number
          errors: number
        }
      > = {}

      let totalSynced = 0
      let totalSkipped = 0
      let totalErrors = 0

      for (const [appSlug, result] of results) {
        summary[appSlug] = {
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors.length,
        }
        totalSynced += result.synced
        totalSkipped += result.skipped
        totalErrors += result.errors.length
      }

      return {
        apps: summary,
        totals: {
          synced: totalSynced,
          skipped: totalSkipped,
          errors: totalErrors,
        },
        completedAt: new Date().toISOString(),
      }
    })

    logger.info('[sync-templates] Completed', { report })

    return report
  }
)

/**
 * Manual trigger event for template sync.
 * Allows syncing templates outside the cron schedule.
 */
export const TEMPLATES_SYNC_REQUESTED = 'templates/sync.requested' as const

export type TemplatesSyncRequestedEvent = {
  name: typeof TEMPLATES_SYNC_REQUESTED
  data: {
    /** Optional: specific app to sync (syncs all if not provided) */
    appId?: string
    /** Optional: requestor info for audit */
    requestedBy?: string
  }
}

/**
 * On-demand template sync triggered by event.
 * Can be used to sync a specific app or all apps.
 */
export const syncTemplatesOnDemand = inngest.createFunction(
  {
    id: 'sync-templates-on-demand',
    name: 'Sync Templates (On-Demand)',
    retries: 2,
  },
  { event: TEMPLATES_SYNC_REQUESTED },
  async ({ event, step, logger }) => {
    const { appId, requestedBy } = event.data

    logger.info('[sync-templates-on-demand] Starting', {
      appId: appId ?? 'all',
      requestedBy,
    })

    if (appId) {
      // Sync specific app
      const result = await step.run(`sync-app-${appId}`, async () => {
        const { syncTemplates } = await import('../../templates/sync')
        return syncTemplates({ appId })
      })

      return {
        apps: { [appId]: result },
        totals: {
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors.length,
        },
        triggeredBy: requestedBy,
        completedAt: new Date().toISOString(),
      }
    }

    // Sync all apps
    const report = await step.run('sync-all-templates', async () => {
      const { syncAllAppTemplates } = await import('../../templates/sync')
      const results = await syncAllAppTemplates()

      const summary: Record<
        string,
        { synced: number; skipped: number; errors: number }
      > = {}
      let totalSynced = 0
      let totalSkipped = 0
      let totalErrors = 0

      for (const [slug, result] of results) {
        summary[slug] = {
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors.length,
        }
        totalSynced += result.synced
        totalSkipped += result.skipped
        totalErrors += result.errors.length
      }

      return {
        apps: summary,
        totals: {
          synced: totalSynced,
          skipped: totalSkipped,
          errors: totalErrors,
        },
      }
    })

    return {
      ...report,
      triggeredBy: requestedBy,
      completedAt: new Date().toISOString(),
    }
  }
)
