/**
 * Classify Workflow
 *
 * Step 1 of the pipeline: Classifies inbound messages.
 * Triggered by SUPPORT_INBOUND_RECEIVED, emits SUPPORT_CLASSIFIED.
 *
 * Uses the classify step which combines deterministic signal extraction
 * with LLM-based classification for nuanced cases.
 */

import {
  initializeAxiom,
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

    // Run classification
    const classification = await step.run('classify', async () => {
      const stepStartTime = Date.now()

      const result = await classify({
        subject: subject || '',
        body,
        from: senderEmail,
        appId,
      })

      const durationMs = Date.now() - stepStartTime

      // Trace to Axiom with high cardinality
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

    // Emit classified event for next step in pipeline
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

    // Final trace for workflow completion
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
