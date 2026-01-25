/**
 * Route Workflow - Step 2 of the eval pipeline
 *
 * Triggered after classification, decides what action to take.
 * Routes to different handlers based on the action type.
 *
 * Listens: support/inbound.classified
 * Emits: support/inbound.routed (for respond action)
 *        support/inbound.escalated (for escalation actions)
 */

import {
  initializeAxiom,
  traceWorkflowStep,
} from '../../observability/axiom'
import { route } from '../../pipeline/steps/route'
import type { ClassifyOutput, MessageSignals } from '../../pipeline/types'
import { inngest } from '../client'
import {
  SUPPORT_CLASSIFIED,
  SUPPORT_ESCALATED,
  SUPPORT_ROUTED,
} from '../events'

/**
 * Converts partial signals from event data to full MessageSignals.
 * Missing signals default to false.
 */
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
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    // Run routing logic
    const routeResult = await step.run('route', async () => {
      const stepStartTime = Date.now()

      // Convert event classification to full ClassifyOutput
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

    // Handle terminal actions - no further events needed
    if (routeResult.action === 'silence') {
      await traceWorkflowStep({
        workflowName: 'support-route',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: Date.now() - workflowStartTime,
        success: true,
        metadata: { action: 'silence', terminal: true },
      })
      return {
        conversationId,
        messageId,
        route: routeResult,
        terminal: true,
      }
    }

    // Handle escalation actions
    if (routeResult.action === 'escalate_urgent') {
      await step.sendEvent('emit-urgent-escalation', {
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
          priority: 'urgent' as const,
        },
      })
      return {
        conversationId,
        messageId,
        route: routeResult,
        escalated: true,
        priority: 'urgent',
      }
    }

    if (routeResult.action === 'escalate_human') {
      await step.sendEvent('emit-human-escalation', {
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

    if (routeResult.action === 'escalate_instructor') {
      await step.sendEvent('emit-instructor-escalation', {
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
          priority: 'instructor' as const,
        },
      })
      return {
        conversationId,
        messageId,
        route: routeResult,
        escalated: true,
        priority: 'instructor',
      }
    }

    // Handle support_teammate action (add context comment)
    if (routeResult.action === 'support_teammate') {
      await step.sendEvent('emit-support-teammate', {
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
          priority: 'teammate_support' as const,
        },
      })
      return {
        conversationId,
        messageId,
        route: routeResult,
        terminal: true,
        teammateSupport: true,
      }
    }

    // Handle catalog_voc action (voice of customer cataloging)
    if (routeResult.action === 'catalog_voc') {
      await step.sendEvent('emit-catalog-voc', {
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
          priority: 'voc' as const,
        },
      })
      return {
        conversationId,
        messageId,
        route: routeResult,
        terminal: true,
        vocCataloged: true,
      }
    }

    // Handle respond action - continue to gather step
    if (routeResult.action === 'respond') {
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
          route: {
            action: routeResult.action,
            reason: routeResult.reason,
          },
        },
      })

      await traceWorkflowStep({
        workflowName: 'support-route',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: Date.now() - workflowStartTime,
        success: true,
        metadata: { action: 'respond' },
      })

      return {
        conversationId,
        messageId,
        route: routeResult,
      }
    }

    // Fallback - unknown action, treat as escalation
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
