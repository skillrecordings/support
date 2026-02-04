/**
 * Route Workflow - Step 2 of the pipeline
 *
 * Decides what action to take based on classification.
 * Routes to different handlers based on the action type.
 *
 * Also handles:
 * - Tagging conversations based on category
 * - Archiving silenced conversations
 * - Adding agent decision comments
 */

import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import { archiveConversation } from '../../pipeline/steps/archive'
import { addDecisionComment } from '../../pipeline/steps/comment'
import { route } from '../../pipeline/steps/route'
import { applyTag } from '../../pipeline/steps/tag'
import type {
  ClassifyOutput,
  MessageCategory,
  MessageSignals,
} from '../../pipeline/types'
import { type TagRegistry, createTagRegistry } from '../../tags/registry'
import { inngest } from '../client'
import {
  SUPPORT_CLASSIFIED,
  SUPPORT_ESCALATED,
  SUPPORT_ROUTED,
} from '../events'

function toMessageSignals(signals: Record<string, boolean>): MessageSignals {
  return {
    hasEmailInBody: signals.hasEmailInBody ?? false,
    hasPurchaseDate: signals.hasPurchaseDate ?? false,
    hasErrorMessage: signals.hasErrorMessage ?? false,
    isReply: signals.isReply ?? false,
    mentionsInstructor: signals.mentionsInstructor ?? false,
    hasAngrySentiment: signals.hasAngrySentiment ?? false,
    isAutomated: signals.isAutomated ?? false,
    isVendorOutreach: signals.isVendorOutreach ?? false,
    hasLegalThreat: signals.hasLegalThreat ?? false,
    hasOutsidePolicyTimeframe: signals.hasOutsidePolicyTimeframe ?? false,
    isPersonalToInstructor: signals.isPersonalToInstructor ?? false,
    isPresalesFaq: signals.isPresalesFaq ?? false,
    isPresalesTeam: signals.isPresalesTeam ?? false,
  }
}

export const routeWorkflow = inngest.createFunction(
  {
    id: 'support-route',
    name: 'Route Classified Message',
    retries: 2,
  },
  { event: SUPPORT_CLASSIFIED },
  async ({ event, step }) => {
    const {
      conversationId,
      messageId,
      appId,
      subject,
      body,
      senderEmail,
      classification,
      inboxId,
      traceId,
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'route workflow started', {
      workflow: 'support-route',
      conversationId,
      messageId,
      appId,
      traceId,
      category: classification.category,
      confidence: classification.confidence,
    })

    // Run routing logic
    const routeResult = await step.run('route', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'running routing step', {
        workflow: 'support-route',
        step: 'route',
        conversationId,
        traceId,
        category: classification.category,
      })

      const fullClassification: ClassifyOutput = {
        category: classification.category as ClassifyOutput['category'],
        confidence: classification.confidence,
        signals: toMessageSignals(classification.signals),
        reasoning: classification.reasoning,
      }

      const result = route({
        message: { subject, body, from: senderEmail },
        classification: fullClassification,
        appConfig: {
          appId,
          instructorConfigured: false,
          autoSendEnabled: false,
        },
      })

      const durationMs = Date.now() - stepStartTime

      await log('info', 'routing decision made', {
        workflow: 'support-route',
        step: 'route',
        conversationId,
        appId,
        traceId,
        action: result.action,
        reason: result.reason,
        category: classification.category,
        durationMs,
      })

      await traceWorkflowStep({
        workflowName: 'support-route',
        conversationId,
        appId,
        stepName: 'route',
        durationMs,
        success: true,
        metadata: {
          action: result.action,
          reason: result.reason,
          category: classification.category,
        },
      })

      return result
    })

    // Apply category tag to conversation (fire-and-forget)
    const tagResult = await step.run('apply-tag', async () => {
      const stepStartTime = Date.now()
      const frontApiToken = process.env.FRONT_API_TOKEN

      if (!frontApiToken) {
        await log('error', 'FRONT_API_TOKEN not set, cannot apply tag', {
          workflow: 'support-route',
          step: 'apply-tag',
          conversationId,
          category: classification.category,
        })
        return {
          tagged: false,
          error: 'FRONT_API_TOKEN not set in environment',
        }
      }

      try {
        const result = await applyTag(
          {
            conversationId,
            category: classification.category as MessageCategory,
            appConfig: {
              appId,
              instructorConfigured: false,
              autoSendEnabled: false,
            },
          },
          { frontApiToken }
        )

        const durationMs = Date.now() - stepStartTime

        if (result.tagged) {
          await log('info', 'tag applied successfully', {
            workflow: 'support-route',
            step: 'apply-tag',
            conversationId,
            category: classification.category,
            tagId: result.tagId,
            tagName: result.tagName,
            durationMs,
            tagged: result.tagged,
          })
        } else {
          await log('error', 'tag application returned failure', {
            workflow: 'support-route',
            step: 'apply-tag',
            conversationId,
            category: classification.category,
            tagName: result.tagName,
            error: result.error,
            durationMs,
            tagged: result.tagged,
          })
        }

        await traceWorkflowStep({
          workflowName: 'support-route',
          conversationId,
          appId,
          stepName: 'apply-tag',
          durationMs,
          success: result.tagged,
          error: result.tagged ? undefined : result.error,
          metadata: {
            tagId: result.tagId,
            tagName: result.tagName,
            category: classification.category,
          },
        })

        return result
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        await log('error', 'tag step threw unexpected exception', {
          workflow: 'support-route',
          step: 'apply-tag',
          conversationId,
          category: classification.category,
          error: errorMsg,
          errorType:
            error instanceof Error ? error.constructor.name : 'unknown',
        })
        return {
          tagged: false,
          error: errorMsg,
        }
      }
    })

    // Handle terminal actions
    if (routeResult.action === 'silence') {
      // Archive the conversation (fire-and-forget)
      const archiveResult = await step.run('archive-conversation', async () => {
        const stepStartTime = Date.now()
        const frontApiToken = process.env.FRONT_API_TOKEN

        if (!frontApiToken) {
          await log('warn', 'FRONT_API_TOKEN not set, skipping archive', {
            workflow: 'support-route',
            step: 'archive-conversation',
            conversationId,
          })
          return { archived: false, error: 'No API token' }
        }

        try {
          const result = await archiveConversation(
            {
              conversationId,
              action: routeResult.action,
              reason: routeResult.reason,
              appConfig: {
                appId,
                instructorConfigured: false,
                autoSendEnabled: false,
              },
            },
            { frontApiToken }
          )

          await log('info', 'conversation archived', {
            workflow: 'support-route',
            step: 'archive-conversation',
            conversationId,
            archived: result.archived,
            reason: routeResult.reason,
            durationMs: Date.now() - stepStartTime,
          })

          await traceWorkflowStep({
            workflowName: 'support-route',
            conversationId,
            appId,
            stepName: 'archive-conversation',
            durationMs: Date.now() - stepStartTime,
            success: result.archived,
            metadata: { reason: routeResult.reason },
          })

          return result
        } catch (error) {
          await log('error', 'archive failed', {
            workflow: 'support-route',
            step: 'archive-conversation',
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
          return {
            archived: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })

      await log('info', 'route workflow completed - silence', {
        workflow: 'support-route',
        conversationId,
        messageId,
        action: 'silence',
        reason: routeResult.reason,
        tagged: tagResult?.tagged,
        archived: archiveResult?.archived,
        totalDurationMs: Date.now() - workflowStartTime,
      })
      await traceWorkflowStep({
        workflowName: 'support-route',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: Date.now() - workflowStartTime,
        success: true,
        metadata: {
          action: 'silence',
          terminal: true,
          tagged: tagResult?.tagged,
          archived: archiveResult?.archived,
        },
      })
      return {
        conversationId,
        messageId,
        route: routeResult,
        terminal: true,
        tagged: tagResult?.tagged,
        archived: archiveResult?.archived,
      }
    }

    // Handle escalation actions
    const escalationActions = [
      'escalate_urgent',
      'escalate_human',
      'escalate_instructor',
      'support_teammate',
      'catalog_voc',
    ]
    if (escalationActions.includes(routeResult.action)) {
      const priority =
        routeResult.action === 'escalate_urgent'
          ? 'urgent'
          : routeResult.action === 'escalate_instructor'
            ? 'instructor'
            : routeResult.action === 'support_teammate'
              ? 'teammate_support'
              : routeResult.action === 'catalog_voc'
                ? 'voc'
                : 'normal'

      // Add decision comment for escalation (fire-and-forget)
      await step.run('add-decision-comment-escalation', async () => {
        const stepStartTime = Date.now()
        const frontApiToken = process.env.FRONT_API_TOKEN
        if (!frontApiToken) {
          await log(
            'warn',
            'FRONT_API_TOKEN not set, skipping decision comment',
            {
              workflow: 'support-route',
              step: 'add-decision-comment-escalation',
              conversationId,
            }
          )
          return { added: false, error: 'No API token' }
        }

        try {
          const result = await addDecisionComment(
            conversationId,
            {
              category: classification.category,
              confidence: classification.confidence,
              reasoning: classification.reasoning,
              action: routeResult.action,
              actionReason: routeResult.reason,
              customerEmail: senderEmail,
            },
            { frontApiToken }
          )

          const durationMs = Date.now() - stepStartTime

          await log('info', 'decision comment added', {
            workflow: 'support-route',
            step: 'add-decision-comment-escalation',
            conversationId,
            action: routeResult.action,
            added: result.added,
            priority,
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'support-route',
            conversationId,
            appId,
            stepName: 'add-decision-comment-escalation',
            durationMs,
            success: result.added,
            metadata: {
              action: routeResult.action,
              priority,
              category: classification.category,
            },
          })

          return result
        } catch (error) {
          const durationMs = Date.now() - stepStartTime
          const errorMsg =
            error instanceof Error ? error.message : String(error)

          await log('error', 'decision comment failed', {
            workflow: 'support-route',
            step: 'add-decision-comment-escalation',
            conversationId,
            error: errorMsg,
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'support-route',
            conversationId,
            appId,
            stepName: 'add-decision-comment-escalation',
            durationMs,
            success: false,
            error: errorMsg,
          })

          return {
            added: false,
            error: errorMsg,
          }
        }
      })

      await log('info', 'route workflow completed - escalation', {
        workflow: 'support-route',
        conversationId,
        messageId,
        action: routeResult.action,
        priority,
        reason: routeResult.reason,
        tagged: tagResult?.tagged,
        totalDurationMs: Date.now() - workflowStartTime,
      })

      await traceWorkflowStep({
        workflowName: 'support-route',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: Date.now() - workflowStartTime,
        success: true,
        metadata: {
          action: routeResult.action,
          priority,
          escalated: true,
          tagged: tagResult?.tagged,
        },
      })

      await step.sendEvent('emit-escalation', {
        name: SUPPORT_ESCALATED,
        data: {
          conversationId,
          messageId,
          appId,
          subject,
          body,
          senderEmail,
          classification,
          route: routeResult,
          priority: priority as
            | 'urgent'
            | 'normal'
            | 'instructor'
            | 'teammate_support'
            | 'voc',
          inboxId,
          traceId,
        },
      })
      return {
        conversationId,
        messageId,
        route: routeResult,
        escalated: true,
        priority,
        tagged: tagResult?.tagged,
      }
    }

    // Handle respond action - continue to gather step
    if (routeResult.action === 'respond') {
      // Note: Decision comment for 'respond' is added later in the pipeline
      // after drafting, when we have full context. See execute-approved-action.ts

      await log('info', 'route workflow completed - respond', {
        workflow: 'support-route',
        conversationId,
        messageId,
        action: 'respond',
        reason: routeResult.reason,
        tagged: tagResult?.tagged,
        totalDurationMs: Date.now() - workflowStartTime,
      })

      await step.sendEvent('emit-routed', {
        name: SUPPORT_ROUTED,
        data: {
          conversationId,
          messageId,
          appId,
          subject,
          body,
          senderEmail,
          classification,
          route: { action: routeResult.action, reason: routeResult.reason },
          inboxId,
          traceId,
        },
      })

      await traceWorkflowStep({
        workflowName: 'support-route',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: Date.now() - workflowStartTime,
        success: true,
        metadata: { action: 'respond', tagged: tagResult?.tagged },
      })

      return {
        conversationId,
        messageId,
        route: routeResult,
        tagged: tagResult?.tagged,
      }
    }

    // Fallback - unknown action
    await log('warn', 'route workflow completed - unknown action', {
      workflow: 'support-route',
      conversationId,
      messageId,
      action: routeResult.action,
      reason: routeResult.reason,
      totalDurationMs: Date.now() - workflowStartTime,
    })

    await step.sendEvent('emit-unknown-escalation', {
      name: SUPPORT_ESCALATED,
      data: {
        conversationId,
        messageId,
        appId,
        subject,
        body,
        senderEmail,
        classification,
        route: routeResult,
        priority: 'normal' as const,
        inboxId,
        traceId,
      },
    })
    return {
      conversationId,
      messageId,
      route: routeResult,
      escalated: true,
      priority: 'normal',
    }
  }
)
