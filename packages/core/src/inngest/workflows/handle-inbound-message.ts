import { inngest } from '../client'
import { SUPPORT_INBOUND_RECEIVED } from '../events'
import type { SupportInboundReceivedEvent } from '../events'
import { createFrontClient, type FrontMessage } from '../../front/index.js'

/**
 * Handles inbound messages received from Front.
 *
 * Workflow:
 * 1. Fetch conversation context (past messages, customer data)
 * 2. Run agent to analyze and generate response
 * 3. If action requires approval, emit support/approval.requested
 *    Otherwise, emit support/action.approved for immediate execution
 *
 * Triggered by: support/inbound.received
 */
export const handleInboundMessage = inngest.createFunction(
  {
    id: 'handle-inbound-message',
    name: 'Handle Inbound Message',
  },
  { event: SUPPORT_INBOUND_RECEIVED },
  async ({ event, step }) => {
    const { conversationId, appId, messageId, subject, _links } = event.data

    // Step 1: Fetch full message and conversation from Front API
    const context = await step.run('get-conversation-context', async () => {
      const frontToken = process.env.FRONT_API_TOKEN
      if (!frontToken) {
        console.error('[workflow] FRONT_API_TOKEN not configured')
        return {
          conversationId,
          appId,
          messageId,
          subject: subject || '',
          body: '',
          senderEmail: '',
          conversationHistory: [] as FrontMessage[],
        }
      }

      const front = createFrontClient(frontToken)

      // Fetch the triggering message (full data)
      const message = await front.getMessage(
        _links?.message || messageId
      )

      // Fetch conversation history
      const conversationHistory = await front.getConversationMessages(conversationId)

      // Extract sender email from message
      const senderEmail = message.author?.email ||
        message.recipients.find(r => r.role === 'from')?.handle ||
        ''

      return {
        conversationId,
        appId,
        messageId,
        subject: message.subject || subject || '',
        body: message.body,
        senderEmail,
        conversationHistory,
      }
    })

    // Step 2: Run agent
    const agentResult = await step.run('run-agent', async () => {
      // TODO: Implement agent logic
      // - Analyze message intent
      // - Generate response draft
      // - Determine if action is needed (refund, license transfer, etc)
      // - Assess confidence level
      return {
        response: 'Agent response placeholder',
        action: null as
          | null
          | {
              type: string
              parameters: Record<string, unknown>
              requiresApproval: boolean
            },
        agentReasoning: 'Placeholder reasoning',
        confidence: 0.0,
      }
    })

    // Step 3: Route based on approval requirement
    const routingResult = await step.run('route-action', async () => {
      if (!agentResult.action) {
        // No action needed, just respond
        return { type: 'no-action' as const }
      }

      if (agentResult.action.requiresApproval) {
        // Action requires human approval
        await step.sendEvent('request-approval', {
          name: 'support/approval.requested',
          data: {
            actionId: `action-${conversationId}-${Date.now()}`,
            conversationId,
            appId,
            action: {
              type: agentResult.action.type,
              parameters: agentResult.action.parameters,
            },
            agentReasoning: agentResult.agentReasoning,
          },
        })
        return { type: 'approval-requested' as const }
      } else {
        // Auto-approve and execute
        await step.sendEvent('auto-approve', {
          name: 'support/action.approved',
          data: {
            actionId: `action-${conversationId}-${Date.now()}`,
            approvedBy: 'system-auto-approval',
            approvedAt: new Date().toISOString(),
          },
        })
        return { type: 'auto-approved' as const }
      }
    })

    return {
      conversationId,
      messageId,
      routingResult,
      agentResult,
    }
  }
)
