/**
 * Classify Workflow
 *
 * Step 1 of the pipeline: Classifies inbound messages.
 * Triggered by SUPPORT_INBOUND_RECEIVED, emits SUPPORT_CLASSIFIED.
 *
 * Uses the classify step which combines deterministic signal extraction
 * with LLM-based classification for nuanced cases.
 */

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

    // Run classification
    const classification = await step.run('classify', async () => {
      return classify({
        subject: subject || '',
        body,
        from: senderEmail,
        appId,
      })
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

    return { conversationId, messageId, classification }
  }
)
