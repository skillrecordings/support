/**
 * Tag Gardening Workflow
 *
 * Weekly cron job to analyze tags and generate AI-powered consolidation
 * suggestions. Runs alongside the stale template detection.
 *
 * Schedule: 0 4 * * 0 (Sundays at 4am UTC - 1 hour after stale templates)
 *
 * Process:
 * 1. Fetch all tags from Front API
 * 2. Run AI analysis for consolidation suggestions
 * 3. Post results to Slack for human review
 */

import { inngest } from '../client'
import { TAG_GARDENING_REQUESTED, TAG_HEALTH_CHECK_REQUESTED } from '../events'

/**
 * Weekly cron job to analyze tags and suggest consolidation.
 */
export const tagGardeningWorkflow = inngest.createFunction(
  {
    id: 'tag-gardening',
    name: 'Weekly Tag Gardening',
    retries: 3,
    onFailure: async ({ error, event }) => {
      console.error('[tag-gardening] Workflow failed:', {
        error: error.message,
        event: event?.name,
      })
    },
  },
  { cron: '0 4 * * 0' }, // Sundays at 4am UTC
  async ({ step, logger }) => {
    // Step 1: Fetch all tags from Front
    const tags = await step.run('fetch-tags', async () => {
      const { createFrontClient } = await import('@skillrecordings/front-sdk')

      const token = process.env.FRONT_API_TOKEN
      if (!token) {
        throw new Error('FRONT_API_TOKEN not set')
      }

      const front = createFrontClient({ apiToken: token })
      const result = await front.tags.list()

      logger.info(`Fetched ${result._results.length} tags from Front`)

      return result._results.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        highlight: t.highlight,
        is_private: t.is_private,
      }))
    })

    // Step 2: Run AI analysis
    const suggestions = await step.run('analyze-tags', async () => {
      const { analyzeTagsWithAI } = await import('../../tags/ai-suggestions')

      const result = await analyzeTagsWithAI({
        tags: tags as Parameters<typeof analyzeTagsWithAI>[0]['tags'],
        model: 'anthropic/claude-haiku-4-5',
      })

      logger.info('AI analysis complete', {
        similarGroups: result.similarGroups.length,
        categories: result.categories.length,
        archiveCandidates: result.archiveCandidates.length,
      })

      return result
    })

    // Step 3: Post to Slack if there are suggestions
    const hasSuggestions =
      suggestions.similarGroups.length > 0 ||
      suggestions.archiveCandidates.length > 0 ||
      suggestions.namingSuggestions.length > 0

    if (hasSuggestions) {
      await step.run('post-to-slack', async () => {
        const { formatSuggestionsForSlack } = await import(
          '../../tags/ai-suggestions'
        )
        const { postMessage } = await import('../../slack/client')

        const slackChannel = process.env.SLACK_TAG_GARDENING_CHANNEL
        if (!slackChannel) {
          logger.warn(
            'SLACK_TAG_GARDENING_CHANNEL not set, skipping Slack post'
          )
          return { skipped: true, reason: 'No Slack channel configured' }
        }

        const blocks = formatSuggestionsForSlack(suggestions)

        await postMessage(slackChannel, {
          text: `🏷️ Tag Gardening: ${suggestions.summary.potentialDuplicates} potential duplicates, ${suggestions.summary.archiveCandidatesCount} archive candidates`,
          blocks: blocks as unknown as Parameters<
            typeof postMessage
          >[1]['blocks'],
        })

        logger.info('Posted suggestions to Slack')
        return { posted: true, channel: slackChannel }
      })
    }

    return {
      tagsAnalyzed: tags.length,
      suggestions: {
        similarGroups: suggestions.similarGroups.length,
        categories: suggestions.categories.length,
        namingSuggestions: suggestions.namingSuggestions.length,
        archiveCandidates: suggestions.archiveCandidates.length,
      },
      hasSuggestions,
    }
  }
)

/**
 * On-demand tag gardening analysis.
 * Can be triggered manually via Inngest dashboard or API.
 */
export const tagGardeningOnDemand = inngest.createFunction(
  {
    id: 'tag-gardening-on-demand',
    name: 'Tag Gardening (On Demand)',
    retries: 2,
  },
  { event: TAG_GARDENING_REQUESTED },
  async ({ step, event, logger }) => {
    const skipSlack = event.data?.skipSlack ?? false

    // Step 1: Fetch all tags from Front
    const tags = await step.run('fetch-tags', async () => {
      const { createFrontClient } = await import('@skillrecordings/front-sdk')

      const token = process.env.FRONT_API_TOKEN
      if (!token) {
        throw new Error('FRONT_API_TOKEN not set')
      }

      const front = createFrontClient({ apiToken: token })
      const result = await front.tags.list()

      return result._results.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        highlight: t.highlight,
        is_private: t.is_private,
      }))
    })

    // Step 2: Run AI analysis
    const suggestions = await step.run('analyze-tags', async () => {
      const { analyzeTagsWithAI } = await import('../../tags/ai-suggestions')

      return analyzeTagsWithAI({
        tags: tags as Parameters<typeof analyzeTagsWithAI>[0]['tags'],
        model: event.data?.model ?? 'anthropic/claude-haiku-4-5',
      })
    })

    // Step 3: Optionally post to Slack
    if (!skipSlack) {
      const hasSuggestions =
        suggestions.similarGroups.length > 0 ||
        suggestions.archiveCandidates.length > 0 ||
        suggestions.namingSuggestions.length > 0

      if (hasSuggestions) {
        await step.run('post-to-slack', async () => {
          const { formatSuggestionsForSlack } = await import(
            '../../tags/ai-suggestions'
          )
          const { postMessage } = await import('../../slack/client')

          const slackChannel =
            event.data?.slackChannel ?? process.env.SLACK_TAG_GARDENING_CHANNEL
          if (!slackChannel) {
            logger.warn('No Slack channel configured')
            return { skipped: true }
          }

          const blocks = formatSuggestionsForSlack(suggestions)

          await postMessage(slackChannel, {
            text: `🏷️ Tag Gardening: ${suggestions.summary.potentialDuplicates} potential duplicates, ${suggestions.summary.archiveCandidatesCount} archive candidates`,
            blocks: blocks as unknown as Parameters<
              typeof postMessage
            >[1]['blocks'],
          })

          return { posted: true }
        })
      }
    }

    return {
      tagsAnalyzed: tags.length,
      suggestions,
    }
  }
)

/**
 * Tag Health Check Workflow
 *
 * Quick daily check for tag system health - counts, unused tags, etc.
 * Lighter weight than full gardening analysis.
 *
 * Schedule: 0 6 * * * (Daily at 6am UTC)
 */
export const tagHealthCheckWorkflow = inngest.createFunction(
  {
    id: 'tag-health-check',
    name: 'Daily Tag Health Check',
    retries: 2,
  },
  { cron: '0 6 * * *' }, // Daily at 6am UTC
  async ({ step, logger }) => {
    const stats = await step.run('check-tag-health', async () => {
      const { createFrontClient } = await import('@skillrecordings/front-sdk')

      const token = process.env.FRONT_API_TOKEN
      if (!token) {
        throw new Error('FRONT_API_TOKEN not set')
      }

      const front = createFrontClient({ apiToken: token })
      const result = await front.tags.list()
      const tags = result._results

      // Basic health stats
      const totalTags = tags.length
      const privateTags = tags.filter((t) => t.is_private).length
      const tagsByColor = new Map<string | null, number>()

      for (const tag of tags) {
        const color = tag.highlight ?? null
        tagsByColor.set(color, (tagsByColor.get(color) || 0) + 1)
      }

      logger.info('Tag health check complete', { totalTags, privateTags })

      return {
        totalTags,
        privateTags,
        publicTags: totalTags - privateTags,
        byColor: Object.fromEntries(tagsByColor),
        checkedAt: new Date().toISOString(),
      }
    })

    return stats
  }
)

/**
 * On-demand tag health check.
 */
export const tagHealthCheckOnDemand = inngest.createFunction(
  {
    id: 'tag-health-check-on-demand',
    name: 'Tag Health Check (On Demand)',
    retries: 1,
  },
  { event: TAG_HEALTH_CHECK_REQUESTED },
  async ({ step, logger }) => {
    const stats = await step.run('check-tag-health', async () => {
      const { createFrontClient } = await import('@skillrecordings/front-sdk')

      const token = process.env.FRONT_API_TOKEN
      if (!token) {
        throw new Error('FRONT_API_TOKEN not set')
      }

      const front = createFrontClient({ apiToken: token })
      const result = await front.tags.list()
      const tags = result._results

      const totalTags = tags.length
      const privateTags = tags.filter((t) => t.is_private).length
      const tagsByColor = new Map<string | null, number>()

      for (const tag of tags) {
        const color = tag.highlight ?? null
        tagsByColor.set(color, (tagsByColor.get(color) || 0) + 1)
      }

      return {
        totalTags,
        privateTags,
        publicTags: totalTags - privateTags,
        byColor: Object.fromEntries(tagsByColor),
        tags: tags.map((t) => ({
          id: t.id,
          name: t.name,
          highlight: t.highlight,
          is_private: t.is_private,
        })),
        checkedAt: new Date().toISOString(),
      }
    })

    return stats
  }
)
