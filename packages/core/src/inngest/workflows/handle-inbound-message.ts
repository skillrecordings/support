import { inngest } from '../client'
import { SUPPORT_INBOUND_RECEIVED } from '../events'
import type { SupportInboundReceivedEvent } from '../events'
import { createFrontClient, type FrontMessage } from '../../front/index'
import { runSupportAgent } from '../../agent/index'
import { getDb, ActionsTable } from '@skillrecordings/database'
import { randomUUID } from 'crypto'

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
      // Convert Front messages to AI SDK message format
      const conversationMessages = context.conversationHistory
        .sort((a, b) => a.created_at - b.created_at)
        .map(msg => ({
          role: msg.is_inbound ? 'user' as const : 'assistant' as const,
          content: msg.body,
        }))

      // Run the support agent
      const result = await runSupportAgent({
        message: context.body,
        conversationHistory: conversationMessages.slice(0, -1), // Exclude current message
        customerContext: {
          email: context.senderEmail,
        },
        appId: context.appId,
      })

      // Check if escalation was requested
      const escalationCall = result.toolCalls.find(tc => tc.name === 'escalateToHuman')
      const draftCall = result.toolCalls.find(tc => tc.name === 'draftResponse')

      return {
        response: draftCall?.args?.body as string || result.response,
        toolCalls: result.toolCalls,
        requiresApproval: result.requiresApproval,
        escalated: !!escalationCall,
        escalationReason: escalationCall?.args?.reason as string | undefined,
        reasoning: result.reasoning,
      }
    })

    // Step 3: Route based on agent result
    const routingResult = await step.run('route-action', async () => {
      // If agent escalated, flag for human
      if (agentResult.escalated) {
        return {
          type: 'escalated' as const,
          reason: agentResult.escalationReason,
        }
      }

      // If action requires approval, request it
      if (agentResult.requiresApproval) {
        // Create action record in database
        const actionId = randomUUID()
        const db = getDb()

        await db.insert(ActionsTable).values({
          id: actionId,
          conversation_id: conversationId,
          app_id: context.appId,
          type: 'pending-action',
          parameters: { toolCalls: agentResult.toolCalls },
          requires_approval: true,
          created_at: new Date(),
        })

        await step.sendEvent('request-approval', {
          name: 'support/approval.requested',
          data: {
            actionId,
            conversationId,
            appId: context.appId,
            action: {
              type: 'pending-action',
              parameters: { toolCalls: agentResult.toolCalls },
            },
            agentReasoning: agentResult.reasoning || 'Agent proposed action requiring approval',
          },
        })
        return { type: 'approval-requested' as const, actionId }
      }

      // Otherwise, response is ready to send (or draft)
      return {
        type: 'response-ready' as const,
        response: agentResult.response,
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
