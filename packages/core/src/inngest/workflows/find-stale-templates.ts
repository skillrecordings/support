/**
 * Stale template detection workflow
 *
 * Runs weekly on Sundays at 3am UTC to identify templates that haven't been
 * used recently or have poor performance metrics. Generates a report and
 * optionally notifies via Slack.
 *
 * Schedule: 0 3 * * 0 (Sundays at 3am UTC)
 *
 * This is part of the Agent-Assisted Template Gardening System.
 */

import { inngest } from '../client'

/**
 * Weekly cron job to find stale templates.
 *
 * Process:
 * 1. Scan all apps for stale templates
 * 2. Generate per-app and summary reports
 * 3. Post to Slack if stale templates found
 *
 * Note: Uses lazy imports inside steps to avoid serverless/Turbopack build issues.
 */
export const findStaleTemplatesWorkflow = inngest.createFunction(
  {
    id: 'find-stale-templates',
    name: 'Weekly Stale Template Check',
    retries: 3,
    onFailure: async ({ error, event }) => {
      console.error('[find-stale-templates] Workflow failed:', {
        error: error.message,
        event: event?.name,
      })
    },
  },
  { cron: '0 3 * * 0' }, // Sundays at 3am UTC
  async ({ step, logger }) => {
    // Step 1: Find stale templates across all apps
    const scanResults = await step.run('scan-all-apps', async () => {
      const { findAllStaleTemplates, buildStalesSummary } = await import(
        '../../templates/stale'
      )

      const results = await findAllStaleTemplates({
        unusedDays: 90,
        minUsageCount: 1,
        maxEditRate: 0.5,
        includeLowMatch: true,
      })

      // Convert Map to serializable format
      const appResults: Record<
        string,
        {
          stale: Array<{
            templateId: string
            frontId: string
            name: string
            reason: string
            daysSinceUsed: number
            usageCount: number
            editRate?: number
          }>
          totalScanned: number
          activeCount: number
          byReason: Record<string, number>
          scannedAt: string
        }
      > = {}

      for (const [appSlug, result] of results) {
        appResults[appSlug] = {
          stale: result.stale.map((s) => ({
            templateId: s.templateId,
            frontId: s.frontId,
            name: s.name,
            reason: s.reason,
            daysSinceUsed: s.daysSinceUsed,
            usageCount: s.usageCount,
            editRate: s.editRate,
          })),
          totalScanned: result.totalScanned,
          activeCount: result.activeCount,
          byReason: result.byReason,
          scannedAt: result.scannedAt,
        }
      }

      const summary = buildStalesSummary(results)

      return {
        apps: appResults,
        summary,
      }
    })

    // Step 2: Generate and post Slack report if there are stale templates
    const totalStale = scanResults.summary.totalStale

    if (totalStale > 0) {
      await step.run('notify-slack', async () => {
        const { formatStaleReport } = await import('../../templates/stale')
        const { postMessage } = await import('../../slack/client')
        const { database, AppsTable } = await import(
          '@skillrecordings/database'
        )
        const { eq } = await import('drizzle-orm')

        // Build the summary message
        const summaryLines: string[] = [
          '🌿 *Weekly Stale Template Report*',
          '',
          `Found *${totalStale}* stale templates across ${scanResults.summary.totalApps} apps`,
          '',
          '*Breakdown:*',
        ]

        if (scanResults.summary.byReason.unused > 0) {
          summaryLines.push(
            `• 💤 Unused (>90 days): ${scanResults.summary.byReason.unused}`
          )
        }
        if (scanResults.summary.byReason.high_edit_rate > 0) {
          summaryLines.push(
            `• ✏️ High edit rate: ${scanResults.summary.byReason.high_edit_rate}`
          )
        }
        if (scanResults.summary.byReason.low_match > 0) {
          summaryLines.push(
            `• 📉 Low match rate: ${scanResults.summary.byReason.low_match}`
          )
        }
        if (scanResults.summary.byReason.superseded > 0) {
          summaryLines.push(
            `• 🔄 Superseded: ${scanResults.summary.byReason.superseded}`
          )
        }

        summaryLines.push('')

        // Add per-app details for apps with stale templates
        for (const [appSlug, result] of Object.entries(scanResults.apps)) {
          if (result.stale.length > 0) {
            summaryLines.push(
              `*${appSlug}*: ${result.stale.length} stale / ${result.totalScanned} total`
            )

            // Show top 3 stale templates per app
            const top3 = result.stale.slice(0, 3)
            for (const template of top3) {
              summaryLines.push(
                `  → _${template.name}_ (${template.daysSinceUsed}d, ${template.reason})`
              )
            }
            if (result.stale.length > 3) {
              summaryLines.push(`  _...and ${result.stale.length - 3} more_`)
            }
            summaryLines.push('')
          }
        }

        // Find an app with escalation channel configured for posting
        const apps = await database.select().from(AppsTable)
        const appWithChannel = apps.find((app) => app.escalation_slack_channel)

        if (appWithChannel?.escalation_slack_channel) {
          try {
            await postMessage(appWithChannel.escalation_slack_channel, {
              text: summaryLines.join('\n'),
            })

            return {
              notified: true,
              channel: appWithChannel.escalation_slack_channel,
            }
          } catch (error) {
            logger.warn('[find-stale-templates] Failed to post to Slack:', {
              error: error instanceof Error ? error.message : 'Unknown error',
            })
            return { notified: false, error: 'Failed to post to Slack' }
          }
        }

        return { notified: false, reason: 'No Slack channel configured' }
      })
    }

    logger.info('[find-stale-templates] Completed', {
      totalStale,
      totalScanned: scanResults.summary.totalTemplates,
      apps: Object.keys(scanResults.apps).length,
    })

    return {
      summary: scanResults.summary,
      apps: scanResults.apps,
      completedAt: new Date().toISOString(),
    }
  }
)

/**
 * Manual trigger event for stale template check.
 * Allows running the check outside the cron schedule.
 */
export const STALE_TEMPLATES_CHECK_REQUESTED =
  'templates/stale-check.requested' as const

export type StaleTemplatesCheckRequestedEvent = {
  name: typeof STALE_TEMPLATES_CHECK_REQUESTED
  data: {
    /** Optional: specific app to check (checks all if not provided) */
    appId?: string
    /** Optional: override unused days threshold */
    unusedDays?: number
    /** Optional: requestor info for audit */
    requestedBy?: string
  }
}

/**
 * On-demand stale template check triggered by event.
 */
export const findStaleTemplatesOnDemand = inngest.createFunction(
  {
    id: 'find-stale-templates-on-demand',
    name: 'Find Stale Templates (On-Demand)',
    retries: 2,
  },
  { event: STALE_TEMPLATES_CHECK_REQUESTED },
  async ({ event, step, logger }) => {
    const { appId, unusedDays = 90, requestedBy } = event.data

    logger.info('[find-stale-templates-on-demand] Starting', {
      appId: appId ?? 'all',
      unusedDays,
      requestedBy,
    })

    if (appId) {
      // Check specific app
      const result = await step.run(`check-app-${appId}`, async () => {
        const { findStaleTemplates } = await import('../../templates/stale')
        return findStaleTemplates({
          appId,
          unusedDays,
        })
      })

      return {
        apps: { [appId]: result },
        summary: {
          totalApps: 1,
          totalTemplates: result.totalScanned,
          totalStale: result.stale.length,
          byReason: result.byReason,
        },
        triggeredBy: requestedBy,
        completedAt: new Date().toISOString(),
      }
    }

    // Check all apps
    const scanResults = await step.run('check-all-apps', async () => {
      const { findAllStaleTemplates, buildStalesSummary } = await import(
        '../../templates/stale'
      )

      const results = await findAllStaleTemplates({ unusedDays })

      // Convert Map to serializable format
      const appResults: Record<string, unknown> = {}
      for (const [slug, result] of results) {
        appResults[slug] = result
      }

      return {
        apps: appResults,
        summary: buildStalesSummary(results),
      }
    })

    return {
      ...scanResults,
      triggeredBy: requestedBy,
      completedAt: new Date().toISOString(),
    }
  }
)
