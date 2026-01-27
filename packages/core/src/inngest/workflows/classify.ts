/**
 * Classify Workflow
 *
 * Step 1 of the pipeline: Classifies inbound messages.
 * Triggered by SUPPORT_INBOUND_RECEIVED, emits SUPPORT_CLASSIFIED.
 *
 * IMPORTANT: The webhook passes empty body/senderEmail - we fetch from Front API.
 */

import { createFrontClient, extractCustomerEmail } from '../../front/client'
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
    const {
      conversationId,
      messageId,
      appId,
      subject,
      body,
      senderEmail,
      traceId,
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'classify workflow started', {
      workflow: 'support-classify',
      conversationId,
      messageId,
      appId,
      traceId,
      senderEmail,
      subjectPreview: subject?.slice(0, 100),
      bodyLength: body?.length ?? 0,
    })

    // Fetch full message from Front API (webhook passes empty body/senderEmail)
    const fetchedMessage = await step.run('fetch-message', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'fetching message from Front API', {
        workflow: 'support-classify',
        step: 'fetch-message',
        messageId,
        conversationId,
        traceId,
      })

      try {
        const frontApiToken = process.env.FRONT_API_TOKEN
        if (!frontApiToken) {
          await log(
            'warn',
            'FRONT_API_TOKEN not configured, using webhook values',
            {
              workflow: 'support-classify',
              step: 'fetch-message',
              messageId,
              conversationId,
              traceId,
            }
          )
          return {
            fetchedBody: body,
            fetchedSenderEmail: senderEmail,
            fetched: false,
          }
        }

        const front = createFrontClient(frontApiToken)
        const message = await front.getMessage(messageId)

        await log('debug', 'raw recipients from Front API', {
          workflow: 'support-classify',
          step: 'fetch-message',
          messageId,
          traceId,
          recipients: message.recipients,
        })

        // Extract sender using the helper (prioritizes reply-to, falls back to from)
        const fetchedSenderEmail = extractCustomerEmail(message)
        // Use text field (plain text), not body (HTML)
        const fetchedBody = message.text || ''

        const durationMs = Date.now() - stepStartTime

        await log('info', 'message fetched from Front API', {
          workflow: 'support-classify',
          step: 'fetch-message',
          messageId,
          conversationId,
          traceId,
          fetchedSenderEmail,
          bodyLength: fetchedBody?.length,
          recipientCount: message.recipients?.length ?? 0,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-classify',
          conversationId,
          appId,
          stepName: 'fetch-message',
          durationMs,
          success: true,
          metadata: {
            traceId,
            fetchedSenderEmail,
            bodyLength: fetchedBody?.length,
            recipientCount: message.recipients?.length ?? 0,
          },
        })

        return { fetchedBody, fetchedSenderEmail, fetched: true }
      } catch (error) {
        const durationMs = Date.now() - stepStartTime

        await log('error', 'Front API fetch failed, using webhook values', {
          workflow: 'support-classify',
          step: 'fetch-message',
          messageId,
          conversationId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'support-classify',
          conversationId,
          appId,
          stepName: 'fetch-message',
          durationMs,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })

        // Graceful degradation: continue with original (possibly empty) values
        return {
          fetchedBody: body,
          fetchedSenderEmail: senderEmail,
          fetched: false,
        }
      }
    })

    // Use fetched values, falling back to webhook values
    const effectiveBody = fetchedMessage.fetchedBody || body || ''
    const effectiveSenderEmail =
      fetchedMessage.fetchedSenderEmail || senderEmail || ''

    await log('debug', 'effective values for classification', {
      workflow: 'support-classify',
      conversationId,
      messageId,
      traceId,
      effectiveSenderEmail,
      effectiveBodyLength: effectiveBody.length,
      usedFetchedValues: fetchedMessage.fetched,
    })

    // Run classification
    const classification = await step.run('classify', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'running classification step', {
        workflow: 'support-classify',
        step: 'classify',
        conversationId,
        appId,
        traceId,
      })

      const result = await classify({
        subject: subject || '',
        body: effectiveBody,
        from: effectiveSenderEmail,
        appId,
      })

      const durationMs = Date.now() - stepStartTime

      await log('info', 'classification complete', {
        workflow: 'support-classify',
        step: 'classify',
        conversationId,
        appId,
        traceId,
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
        messageLength: effectiveBody.length,
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
      traceId,
      category: classification.category,
    })

    await step.sendEvent('emit-classified', {
      name: SUPPORT_CLASSIFIED,
      data: {
        conversationId,
        messageId,
        appId,
        subject: subject || '',
        body: effectiveBody,
        senderEmail: effectiveSenderEmail,
        classification: {
          category: classification.category,
          confidence: classification.confidence,
          signals: classification.signals as Record<string, boolean>,
          reasoning: classification.reasoning,
        },
        traceId,
      },
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'classify workflow completed', {
      workflow: 'support-classify',
      conversationId,
      messageId,
      appId,
      traceId,
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
