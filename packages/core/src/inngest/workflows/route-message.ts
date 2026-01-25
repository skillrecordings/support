/**
 * Route Workflow - Step 2 of the pipeline
 *
 * Decides what action to take based on classification.
 * Routes to different handlers based on the action type.
 */

import {
  initializeAxiom,
  log,
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

    await log('info', 'route workflow started', {
      workflow: 'support-route',
      conversationId,
      messageId,
      appId,
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

    // Handle terminal actions
    if (routeResult.action === 'silence') {
      await log('info', 'route workflow completed - silence', {
        workflow: 'support-route',
        conversationId,
        messageId,
        action: 'silence',
        reason: routeResult.reason,
        totalDurationMs: Date.now() - workflowStartTime,
      })
      await traceWorkflowStep({
        workflowName: 'support-route',
        conversationId,
        appId,
        stepName: 'complete',
        durationMs: Date.now() - workflowStartTime,
        success: true,
        metadata: { action: 'silence', terminal: true },
      })
      return { conversationId, messageId, route: routeResult, terminal: true }
    }

    // Handle escalation actions
    const escalationActions = ['escalate_urgent', 'escalate_human', 'escalate_instructor', 'support_teammate', 'catalog_voc']
    if (escalationActions.includes(routeResult.action)) {
      const priority = routeResult.action === 'escalate_urgent' ? 'urgent' 
        : routeResult.action === 'escalate_instructor' ? 'instructor'
        : routeResult.action === 'support_teammate' ? 'teammate_support'
        : routeResult.action === 'catalog_voc' ? 'voc'
        : 'normal'

      await log('info', 'route workflow completed - escalation', {
        workflow: 'support-route',
        conversationId,
        messageId,
        action: routeResult.action,
        priority,
        reason: routeResult.reason,
        totalDurationMs: Date.now() - workflowStartTime,
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
          priority: priority as 'urgent' | 'normal' | 'instructor' | 'teammate_support' | 'voc',
        },
      })
      return { conversationId, messageId, route: routeResult, escalated: true, priority }
    }

    // Handle respond action - continue to gather step
    if (routeResult.action === 'respond') {
      await log('info', 'route workflow completed - respond', {
        workflow: 'support-route',
        conversationId,
        messageId,
        action: 'respond',
        reason: routeResult.reason,
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

      return { conversationId, messageId, route: routeResult }
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
      },
    })
    return { conversationId, messageId, route: routeResult, escalated: true, priority: 'normal' }
  }
)
