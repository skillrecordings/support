/**
 * Handle Escalation Workflow
 *
 * Processes SUPPORT_ESCALATED events by:
 * 1. Gathering additional context if not already available
 * 2. Generating a magic link for customer access
 * 3. Formatting and adding an escalation comment to Front
 * 4. Adding appropriate tags to the conversation
 * 5. Notifying Slack for all escalations (with priority-specific formatting)
 */

import type { App } from '@skillrecordings/database'
import { createFrontClient } from '@skillrecordings/front-sdk'
import { IntegrationClient } from '@skillrecordings/sdk/client'
import type { KnownBlock } from '@slack/types'
import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import {
  type EscalationContext,
  type PurchaseInfo,
  formatEscalationComment,
} from '../../pipeline/steps/comment'
import { getApp } from '../../services/app-registry'
import { postMessage } from '../../slack/client'
import { inngest } from '../client'
import { type EscalationPriority, SUPPORT_ESCALATED } from '../events'

// ============================================================================
// Step Return Types
// ============================================================================

interface AppContextResult {
  app: App | null
  magicLink: string | undefined
  purchases: PurchaseInfo[]
}

export interface CommentResult {
  added: boolean
  error?: string
}

export interface TagResult {
  tagged: boolean
  tagId?: string
  error?: string
}

export interface SlackResult {
  notified: boolean
  channel?: string
  ts?: string
  reason?: string
  error?: string
}

// ============================================================================
// Constants
// ============================================================================

/** Front tag IDs for different escalation types - configure via env or database */
const ESCALATION_TAGS: Record<EscalationPriority, string | undefined> = {
  urgent: process.env.FRONT_TAG_URGENT,
  normal: process.env.FRONT_TAG_ESCALATED,
  instructor: process.env.FRONT_TAG_INSTRUCTOR,
  teammate_support: process.env.FRONT_TAG_TEAMMATE_SUPPORT,
  voc: process.env.FRONT_TAG_VOC,
}

/** Slack channels for notifications */
const SLACK_ESCALATION_CHANNEL = process.env.SLACK_ESCALATION_CHANNEL
const SLACK_INSTRUCTOR_CHANNEL = process.env.SLACK_INSTRUCTOR_CHANNEL

// ============================================================================
// Slack Notification Blocks
// ============================================================================

interface SlackEscalationInput {
  conversationId: string
  appId: string
  customerEmail: string
  priority: EscalationPriority
  reason: string
  category: string
  subject: string
  body?: string
  signals?: Record<string, boolean>
}

/** Priority emoji prefix mapping */
const PRIORITY_DISPLAY: Record<EscalationPriority, string> = {
  urgent: '🚨 URGENT',
  instructor: '👨‍🏫 Instructor',
  normal: '📋 Escalation',
  teammate_support: '🤝 Teammate Support',
  voc: '📊 Voice of Customer',
}

function buildEscalationBlocks(input: SlackEscalationInput): KnownBlock[] {
  const {
    conversationId,
    appId,
    customerEmail,
    priority,
    reason,
    category,
    subject,
    body,
    signals,
  } = input

  // Front conversation URL
  const frontUrl = `https://app.frontapp.com/open/${conversationId}`

  const priorityDisplay = PRIORITY_DISPLAY[priority] ?? '⚠️ Escalated'

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${priorityDisplay} - Support Escalation`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*App:* ${appId}`,
        },
        {
          type: 'mrkdwn',
          text: `*Category:* ${category}`,
        },
        {
          type: 'mrkdwn',
          text: `*Customer:* ${customerEmail}`,
        },
        {
          type: 'mrkdwn',
          text: `*Subject:* ${subject.length > 50 ? subject.slice(0, 50) + '...' : subject}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason:* ${reason}`,
      },
    },
  ]

  // Include classification signals if any are flagged
  if (signals) {
    const flagged = Object.entries(signals)
      .filter(([, value]) => value)
      .map(([key]) => {
        // Pretty-print signal names: hasLegalThreat → Legal Threat
        const label = key
          .replace(/^has/, '')
          .replace(/([A-Z])/g, ' $1')
          .trim()
        return `⚠️ ${label}`
      })

    if (flagged.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Signals:* ${flagged.join(' · ')}`,
        },
      })
    }
  }

  // Include message body so reviewers don't have to click through to Front
  if (body) {
    const truncatedBody = body.length > 500 ? body.slice(0, 500) + '…' : body
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Message:*\n>${truncatedBody.replace(/\n/g, '\n>')}`,
        },
      }
    )
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Open in Front',
          emoji: true,
        },
        url: frontUrl,
        style: 'primary',
      },
    ],
  })

  return blocks
}

// ============================================================================
// Workflow
// ============================================================================

export const handleEscalation = inngest.createFunction(
  {
    id: 'support-handle-escalation',
    name: 'Handle Support Escalation',
    retries: 2,
  },
  { event: SUPPORT_ESCALATED },
  async ({ event, step }) => {
    const {
      conversationId,
      messageId,
      appId,
      subject,
      body,
      senderEmail,
      classification,
      route,
      priority,
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'escalation workflow started', {
      workflow: 'support-handle-escalation',
      conversationId,
      messageId,
      appId,
      priority,
      category: classification.category,
      routeAction: route.action,
    })

    // Step 1: Get app config and lookup customer
    const appContext = (await step.run(
      'gather-app-context',
      async (): Promise<AppContextResult> => {
        const stepStartTime = Date.now()

        await log('debug', 'gathering app context', {
          workflow: 'support-handle-escalation',
          step: 'gather-app-context',
          appId,
        })

        const app = await getApp(appId)

        let magicLink: string | undefined
        let purchases: PurchaseInfo[] = []

        if (app?.integration_base_url && app?.webhook_secret) {
          try {
            const client = new IntegrationClient({
              baseUrl: app.integration_base_url,
              webhookSecret: app.webhook_secret,
            })

            // Generate magic link
            try {
              const linkResult = await client.generateMagicLink({
                email: senderEmail,
                expiresIn: 60 * 60 * 24, // 24 hours
              })
              magicLink = linkResult.url

              await log('debug', 'magic link generated', {
                workflow: 'support-handle-escalation',
                step: 'gather-app-context',
                conversationId,
                hasLink: true,
              })
            } catch (linkError) {
              await log('warn', 'magic link generation failed', {
                workflow: 'support-handle-escalation',
                step: 'gather-app-context',
                conversationId,
                error:
                  linkError instanceof Error
                    ? linkError.message
                    : String(linkError),
              })
            }

            // Lookup user and purchases
            try {
              const user = await client.lookupUser(senderEmail)
              if (user) {
                const userPurchases = await client.getPurchases(user.id)
                purchases = userPurchases.map((p) => ({
                  productName: p.productName,
                  purchasedAt:
                    p.purchasedAt instanceof Date
                      ? p.purchasedAt.toISOString()
                      : String(p.purchasedAt),
                  status: p.status,
                  amount: p.amount,
                }))
              }
            } catch (userError) {
              await log('warn', 'user lookup failed', {
                workflow: 'support-handle-escalation',
                step: 'gather-app-context',
                conversationId,
                error:
                  userError instanceof Error
                    ? userError.message
                    : String(userError),
              })
            }
          } catch (error) {
            await log('error', 'app integration client failed', {
              workflow: 'support-handle-escalation',
              step: 'gather-app-context',
              conversationId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        const durationMs = Date.now() - stepStartTime

        await traceWorkflowStep({
          workflowName: 'support-handle-escalation',
          conversationId,
          appId,
          stepName: 'gather-app-context',
          durationMs,
          success: true,
          metadata: {
            hasApp: !!app,
            hasMagicLink: !!magicLink,
            purchaseCount: purchases.length,
          },
        })

        return {
          app,
          magicLink,
          purchases,
        }
      }
    )) as AppContextResult

    // Step 2: Add escalation comment to Front
    const commentResult = (await step.run(
      'add-escalation-comment',
      async (): Promise<CommentResult> => {
        const stepStartTime = Date.now()

        const frontToken = process.env.FRONT_API_TOKEN
        if (!frontToken) {
          await log('warn', 'FRONT_API_TOKEN not set, skipping comment', {
            workflow: 'support-handle-escalation',
            step: 'add-escalation-comment',
            conversationId,
          })
          return { added: false, error: 'FRONT_API_TOKEN not configured' }
        }

        try {
          const front = createFrontClient({ apiToken: frontToken })

          const escalationContext: EscalationContext = {
            type: priority,
            reason: route.reason,
            customer: {
              email: senderEmail,
            },
            purchases: appContext.purchases,
            classification: {
              category: classification.category,
              confidence: classification.confidence,
              reasoning: classification.reasoning,
            },
            links: appContext.magicLink
              ? { magicLogin: appContext.magicLink }
              : undefined,
          }

          const commentBody = formatEscalationComment(escalationContext)

          await front.conversations.addComment(conversationId, commentBody)

          const durationMs = Date.now() - stepStartTime

          await log('info', 'escalation comment added', {
            workflow: 'support-handle-escalation',
            step: 'add-escalation-comment',
            conversationId,
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'support-handle-escalation',
            conversationId,
            appId,
            stepName: 'add-escalation-comment',
            durationMs,
            success: true,
          })

          return { added: true }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error)

          await log('error', 'failed to add escalation comment', {
            workflow: 'support-handle-escalation',
            step: 'add-escalation-comment',
            conversationId,
            error: errorMsg,
          })

          await traceWorkflowStep({
            workflowName: 'support-handle-escalation',
            conversationId,
            appId,
            stepName: 'add-escalation-comment',
            durationMs: Date.now() - stepStartTime,
            success: false,
            metadata: { error: errorMsg },
          })

          return { added: false, error: errorMsg }
        }
      }
    )) as CommentResult

    // Step 3: Add appropriate tags
    const tagResult = (await step.run(
      'add-escalation-tags',
      async (): Promise<TagResult> => {
        const stepStartTime = Date.now()

        const frontToken = process.env.FRONT_API_TOKEN
        if (!frontToken) {
          return { tagged: false, error: 'FRONT_API_TOKEN not configured' }
        }

        const tagId = ESCALATION_TAGS[priority]
        if (!tagId) {
          await log('debug', 'no tag configured for escalation priority', {
            workflow: 'support-handle-escalation',
            step: 'add-escalation-tags',
            conversationId,
            priority,
          })
          return {
            tagged: false,
            error: `No tag configured for priority: ${priority}`,
          }
        }

        try {
          const front = createFrontClient({ apiToken: frontToken })
          await front.conversations.addTag(conversationId, tagId)

          const durationMs = Date.now() - stepStartTime

          await log('info', 'escalation tag added', {
            workflow: 'support-handle-escalation',
            step: 'add-escalation-tags',
            conversationId,
            tagId,
            priority,
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'support-handle-escalation',
            conversationId,
            appId,
            stepName: 'add-escalation-tags',
            durationMs,
            success: true,
            metadata: { tagId, priority },
          })

          return { tagged: true, tagId }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error)

          await log('error', 'failed to add escalation tag', {
            workflow: 'support-handle-escalation',
            step: 'add-escalation-tags',
            conversationId,
            tagId,
            error: errorMsg,
          })

          return { tagged: false, error: errorMsg }
        }
      }
    )) as TagResult

    // Step 4: Notify Slack for ALL escalations
    const slackResult = (await step.run(
      'notify-slack',
      async (): Promise<SlackResult> => {
        const stepStartTime = Date.now()

        // Determine which channel to use
        // instructor → dedicated instructor channel (with fallback)
        // everything else → general escalation channel
        const channel =
          priority === 'instructor'
            ? (SLACK_INSTRUCTOR_CHANNEL ?? SLACK_ESCALATION_CHANNEL)
            : SLACK_ESCALATION_CHANNEL

        if (!channel) {
          await log('warn', 'no slack channel configured for escalation', {
            workflow: 'support-handle-escalation',
            step: 'notify-slack',
            conversationId,
            priority,
          })
          return { notified: false, error: 'No Slack channel configured' }
        }

        try {
          const blocks = buildEscalationBlocks({
            conversationId,
            appId,
            customerEmail: senderEmail,
            priority,
            reason: route.reason,
            category: classification.category,
            subject: subject || '(no subject)',
            body,
            signals: classification.signals,
          })

          const priorityLabel = PRIORITY_DISPLAY[priority] ?? 'Escalated'
          // Urgent escalations mention @here to ensure immediate attention
          const mentionPrefix = priority === 'urgent' ? '<!here> ' : ''

          const { ts, channel: slackChannel } = await postMessage(channel, {
            text: `${mentionPrefix}${priorityLabel} escalation from ${appId}: ${route.reason}`,
            blocks,
          })

          const durationMs = Date.now() - stepStartTime

          await log('info', 'slack notification sent', {
            workflow: 'support-handle-escalation',
            step: 'notify-slack',
            conversationId,
            channel: slackChannel,
            messageTs: ts,
            priority,
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'support-handle-escalation',
            conversationId,
            appId,
            stepName: 'notify-slack',
            durationMs,
            success: true,
            metadata: { channel: slackChannel, messageTs: ts, priority },
          })

          return { notified: true, channel: slackChannel, ts }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error)

          await log('error', 'failed to send slack notification', {
            workflow: 'support-handle-escalation',
            step: 'notify-slack',
            conversationId,
            channel,
            error: errorMsg,
          })

          await traceWorkflowStep({
            workflowName: 'support-handle-escalation',
            conversationId,
            appId,
            stepName: 'notify-slack',
            durationMs: Date.now() - stepStartTime,
            success: false,
            metadata: { error: errorMsg },
          })

          return { notified: false, error: errorMsg }
        }
      }
    )) as SlackResult

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'escalation workflow completed', {
      workflow: 'support-handle-escalation',
      conversationId,
      messageId,
      appId,
      priority,
      commentAdded: commentResult.added,
      tagAdded: tagResult.tagged,
      slackNotified: slackResult.notified,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-handle-escalation',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        priority,
        commentAdded: commentResult.added,
        tagAdded: tagResult.tagged,
        slackNotified: slackResult.notified,
      },
    })

    return {
      conversationId,
      messageId,
      priority,
      results: {
        context: {
          hasMagicLink: !!appContext.magicLink,
          purchaseCount: appContext.purchases.length,
        },
        comment: commentResult,
        tags: tagResult,
        slack: slackResult,
      },
      totalDurationMs,
    }
  }
)
