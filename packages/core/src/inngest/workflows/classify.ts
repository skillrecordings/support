/**
 * Classify Workflow
 *
 * Step 1 of the pipeline: Classifies inbound messages.
 * Triggered by SUPPORT_INBOUND_RECEIVED, emits SUPPORT_CLASSIFIED.
 */

import {
  initializeAxiom,
  log,
  traceClassification,
  traceWorkflowStep,
} from '../../observability/axiom'
import { classify } from '../../pipeline/steps/classify'
import { inngest } from '../client'
import { SUPPORT_CLASSIFIED, SUPPORT_INBOUND_RECEIVED } from '../events'

export const classifyWorkflow = inngest.createFunction(
  {
    id: 'support-classify',
    name: 'Classify Inbound Message',
    retries: 2,
  },
  { event: SUPPORT_INBOUND_RECEIVED },
  async ({ event, step }) => {
    const { conversationId, messageId, appId, subject, body, senderEmail } =
      event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'classify workflow started', {
      workflow: 'support-classify',
      conversationId,
      messageId,
      appId,
      senderEmail,
      subjectPreview: subject?.slice(0, 100),
      bodyLength: body?.length ?? 0,
    })

    // Run classification
    const classification = await step.run('classify', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'running classification step', {
        workflow: 'support-classify',
        step: 'classify',
        conversationId,
        appId,
      })

      const result = await classify({
        subject: subject || '',
        body,
        from: senderEmail,
        appId,
      })

      const durationMs = Date.now() - stepStartTime

      await log('info', 'classification complete', {
        workflow: 'support-classify',
        step: 'classify',
        conversationId,
        appId,
        category: result.category,
        confidence: result.confidence,
        signalCount: Object.values(result.signals).filter(Boolean).length,
        signals: result.signals,
        reasoning: result.reasoning,
        durationMs,
      })

      await traceClassification({
        conversationId,
        appId,
        messageId,
        category: result.category,
        complexity: 'standard',
        confidence: result.confidence,
        reasoning: result.reasoning ?? '',
        messageLength: body?.length ?? 0,
        durationMs,
      })

      await traceWorkflowStep({
        workflowName: 'support-classify',
        conversationId,
        appId,
        stepName: 'classify',
        durationMs,
        success: true,
        metadata: {
          category: result.category,
          confidence: result.confidence,
          signalCount: Object.values(result.signals).filter(Boolean).length,
        },
      })

      return result
    })

    await log('debug', 'emitting classified event', {
      workflow: 'support-classify',
      conversationId,
      messageId,
      category: classification.category,
    })

    await step.sendEvent('emit-classified', {
      name: SUPPORT_CLASSIFIED,
      data: {
        conversationId,
        messageId,
        appId,
        subject: subject || '',
        body,
        senderEmail,
        classification: {
          category: classification.category,
          confidence: classification.confidence,
          signals: classification.signals as Record<string, boolean>,
          reasoning: classification.reasoning,
        },
      },
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'classify workflow completed', {
      workflow: 'support-classify',
      conversationId,
      messageId,
      appId,
      category: classification.category,
      confidence: classification.confidence,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-classify',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        category: classification.category,
        confidence: classification.confidence,
      },
    })

    return { conversationId, messageId, classification }
  }
)
