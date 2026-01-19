import { randomUUID } from 'crypto'
import { ActionsTable, getDb } from '@skillrecordings/database'
import { runSupportAgent } from '../../agent/index'
import { type FrontMessage, createFrontClient } from '../../front/index'
import { matchRules } from '../../router/rules'
import { systemRules } from '../../router/system-rules'
import { inngest } from '../client'
import { SUPPORT_INBOUND_RECEIVED } from '../events'
import type { SupportInboundReceivedEvent } from '../events'

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
    const { conversationId, appId, messageId, subject, _links, inboxId } =
      event.data

    console.log('[workflow] ========== HANDLE INBOUND MESSAGE ==========')
    console.log('[workflow] Event data:', JSON.stringify(event.data, null, 2))

    // Step 1: Fetch full message and conversation from Front API
    const context = await step.run('get-conversation-context', async () => {
      console.log('[workflow:context] Starting context fetch...')
      console.log('[workflow:context] conversationId:', conversationId)
      console.log('[workflow:context] messageId:', messageId)
      console.log('[workflow:context] inboxId from event:', inboxId)
      console.log('[workflow:context] _links:', JSON.stringify(_links))

      const frontToken = process.env.FRONT_API_TOKEN

      // Fallback context from event data (used when Front API unavailable or for testing)
      const fallbackContext = {
        conversationId,
        appId,
        messageId,
        subject: subject || '',
        body: event.data.messageBody || '',
        senderEmail: event.data.customerEmail || '',
        inboxId: inboxId || '',
        conversationHistory: [] as FrontMessage[],
      }

      if (!frontToken) {
        console.error(
          '[workflow:context] FATAL: FRONT_API_TOKEN not configured'
        )
        return fallbackContext
      }

      try {
        const front = createFrontClient(frontToken)

        // Fetch the triggering message (full data)
        console.log('[workflow:context] Fetching message from Front API...')
        const message = await front.getMessage(_links?.message || messageId)
        console.log('[workflow:context] Message fetched:', {
          id: message.id,
          subject: message.subject,
          bodyLength: message.body?.length,
          author: message.author,
          recipients: message.recipients,
        })

        // Fetch conversation history
        console.log('[workflow:context] Fetching conversation history...')
        const conversationHistory =
          await front.getConversationMessages(conversationId)
        console.log(
          '[workflow:context] History fetched:',
          conversationHistory.length,
          'messages'
        )

        // Extract sender email from message
        const senderEmail =
          message.author?.email ||
          message.recipients.find((r) => r.role === 'from')?.handle ||
          ''
        console.log('[workflow:context] Sender email:', senderEmail)

        // Get inbox ID - from event or fetch from conversation
        let resolvedInboxId = inboxId || ''
        if (!resolvedInboxId) {
          console.log(
            '[workflow:context] No inboxId in event, fetching from conversation...'
          )
          const fetchedInboxId =
            await front.getConversationInbox(conversationId)
          resolvedInboxId = fetchedInboxId || ''
          console.log('[workflow:context] Fetched inboxId:', resolvedInboxId)
        }

        const result = {
          conversationId,
          appId,
          messageId,
          subject: message.subject || subject || '',
          body: message.body,
          senderEmail,
          inboxId: resolvedInboxId,
          conversationHistory,
        }
        console.log('[workflow:context] Context built:', {
          ...result,
          body: result.body?.slice(0, 200) + '...',
          conversationHistory: `${result.conversationHistory.length} messages`,
        })
        return result
      } catch (error) {
        // Fallback to event data if Front API fails (e.g., 404 for test data)
        console.error('[workflow:context] Front API error:', error)
        console.log('[workflow:context] Using fallback context')
        return fallbackContext
      }
    })

    // Step 2: Check system rules for spam/bounce filtering
    const filterResult = await step.run('check-system-rules', async () => {
      console.log('[workflow:rules] Checking system rules...')
      console.log('[workflow:rules] Subject:', context.subject)
      console.log('[workflow:rules] Sender:', context.senderEmail)

      // Run message and sender through system rules
      const ruleMatch = matchRules(
        `${context.subject} ${context.body}`,
        context.senderEmail,
        systemRules
      )

      if (ruleMatch && ruleMatch.action === 'no_respond') {
        console.log(`[workflow:rules] FILTERED by rule ${ruleMatch.ruleId}`)
        return { filtered: true as const, ruleId: ruleMatch.ruleId }
      }

      console.log('[workflow:rules] Passed all rules')
      return { filtered: false as const }
    })

    // Early exit if message was filtered
    if (filterResult.filtered === true) {
      console.log('[workflow] ========== FILTERED - EXITING ==========')
      return {
        conversationId,
        messageId,
        filtered: true,
        ruleId: filterResult.ruleId,
        agentResult: null,
        routingResult: { type: 'filtered' as const },
      }
    }

    // Step 2.5: Loop prevention - limit AI responses per conversation
    const loopCheck = await step.run('check-reply-loop', async () => {
      console.log('[workflow:loop] Checking for reply loop...')
      const db = getDb()

      // Check for simple acknowledgment messages that don't need responses
      const ackPatterns = [
        /^(thanks|thank you|thx|ty)[\s!.]*$/i,
        /^(got it|okay|ok|k)[\s!.]*$/i,
        /^(perfect|great|awesome|cool)[\s!.]*$/i,
        /^(will do|sounds good|noted)[\s!.]*$/i,
      ]
      const messageText = context.body?.trim() || ''
      const isAck = ackPatterns.some((p) => p.test(messageText))
      if (isAck) {
        console.log(
          '[workflow:loop] Message is simple acknowledgment:',
          messageText
        )
        return { isLoop: true, reason: 'acknowledgment' }
      }

      // Smart loop detection:
      // - Count user messages vs AI responses
      // - If human staff replied, AI can respond again
      // - Max 2 consecutive AI responses without human staff involvement

      // Get conversation history to analyze the pattern
      const history = context.conversationHistory || []
      console.log(
        '[workflow:loop] Conversation history:',
        history.length,
        'messages'
      )

      // Find the most recent messages to analyze the pattern
      // Sort by created_at descending (most recent first)
      const sortedHistory = [...history].sort(
        (a, b) => b.created_at - a.created_at
      )

      // Count consecutive AI responses since last human staff reply or user message
      let consecutiveAiResponses = 0
      let userMessagesSinceLastAi = 0
      let humanStaffReplied = false

      for (const msg of sortedHistory) {
        if (msg.is_inbound) {
          // User message - if we haven't hit an AI response yet, count it
          if (consecutiveAiResponses === 0) {
            userMessagesSinceLastAi++
          } else {
            // User replied after AI, that's fine - stop counting
            break
          }
        } else {
          // Outbound message - check if it's from human staff or AI
          // Human staff messages typically have a real author, AI drafts don't
          // For now, assume outbound after user = we responded
          consecutiveAiResponses++
        }
      }

      console.log('[workflow:loop] Analysis:', {
        consecutiveAiResponses,
        userMessagesSinceLastAi,
        humanStaffReplied,
      })

      // Allow AI response if:
      // 1. User has sent messages since our last response
      // 2. We haven't hit 3 consecutive AI responses
      const MAX_CONSECUTIVE_AI = 3
      if (
        consecutiveAiResponses >= MAX_CONSECUTIVE_AI &&
        userMessagesSinceLastAi === 0
      ) {
        console.log(
          `[workflow:loop] ${MAX_CONSECUTIVE_AI}+ consecutive AI responses without new user message, backing off`
        )
        return {
          isLoop: true,
          reason: 'consecutive_ai_responses',
          count: consecutiveAiResponses,
        }
      }

      console.log('[workflow:loop] No loop detected, proceeding')
      return { isLoop: false, consecutiveAiResponses }
    })

    // Early exit if reply loop detected
    if (loopCheck.isLoop) {
      console.log('[workflow] ========== LOOP DETECTED - SKIPPING ==========')
      return {
        conversationId,
        messageId,
        filtered: false,
        loopDetected: true,
        agentResult: null,
        routingResult: { type: 'loop-prevented' as const },
      }
    }

    // Step 3: Run agent
    const agentResult = await step.run('run-agent', async () => {
      console.log('[workflow:agent] ========== RUNNING AGENT ==========')
      console.log('[workflow:agent] Message:', context.body?.slice(0, 500))
      console.log('[workflow:agent] Customer email:', context.senderEmail)
      console.log('[workflow:agent] App ID:', context.appId)

      // Convert Front messages to AI SDK message format
      // Filter out messages with empty content - AI SDK will reject them
      const conversationMessages = context.conversationHistory
        .sort((a, b) => a.created_at - b.created_at)
        .map((msg) => ({
          role: msg.is_inbound ? ('user' as const) : ('assistant' as const),
          content: msg.body || '',
        }))
        .filter((msg) => msg.content.trim().length > 0)

      console.log(
        '[workflow:agent] Conversation history:',
        conversationMessages.length,
        'messages'
      )
      console.log(
        '[workflow:agent] Message content lengths:',
        conversationMessages.map((m) => m.content.length)
      )

      // Ensure message body isn't empty
      const messageBody = context.body?.trim() || ''
      if (!messageBody) {
        console.error('[workflow:agent] Empty message body, cannot run agent')
        return {
          response: '',
          toolCalls: [],
          requiresApproval: false,
          escalated: true,
          escalationReason: 'Empty message body',
          reasoning: 'Message body was empty',
        }
      }

      // Run the support agent
      console.log('[workflow:agent] Calling runSupportAgent...')
      const result = await runSupportAgent({
        message: messageBody,
        conversationHistory: conversationMessages.slice(0, -1), // Exclude current message
        customerContext: {
          email: context.senderEmail,
        },
        appId: context.appId,
      })

      console.log('[workflow:agent] Agent result:', {
        responseLength: result.response?.length,
        responsePreview: result.response?.slice(0, 300),
        toolCalls: result.toolCalls.map((tc) => ({
          name: tc.name,
          args: tc.args,
        })),
        requiresApproval: result.requiresApproval,
        autoSent: result.autoSent,
      })

      // Check if escalation was requested
      const escalationCall = result.toolCalls.find(
        (tc) => tc.name === 'escalateToHuman'
      )
      const draftCall = result.toolCalls.find(
        (tc) => tc.name === 'draftResponse'
      )

      const agentOutput = {
        response: (draftCall?.args?.body as string) || result.response,
        toolCalls: result.toolCalls,
        requiresApproval: result.requiresApproval,
        escalated: !!escalationCall,
        escalationReason: escalationCall?.args?.reason as string | undefined,
        reasoning: result.reasoning,
      }
      console.log('[workflow:agent] Final agent output:', {
        responseLength: agentOutput.response?.length,
        escalated: agentOutput.escalated,
        requiresApproval: agentOutput.requiresApproval,
      })
      return agentOutput
    })

    // Step 4: Route based on agent result
    const routingResult = await step.run('route-action', async () => {
      console.log('[workflow:routing] ========== ROUTING DECISION ==========')
      console.log('[workflow:routing] Escalated:', agentResult.escalated)
      console.log(
        '[workflow:routing] Requires approval:',
        agentResult.requiresApproval
      )

      // If agent escalated, flag for human
      if (agentResult.escalated) {
        console.log('[workflow:routing] DECISION: Escalated to human')
        return {
          type: 'escalated' as const,
          reason: agentResult.escalationReason,
        }
      }

      // If action requires approval, request it
      if (agentResult.requiresApproval) {
        console.log(
          '[workflow:routing] DECISION: Requires approval, creating action record'
        )
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
        console.log('[workflow:routing] Action record created:', actionId)

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
            agentReasoning:
              agentResult.reasoning ||
              'Agent proposed action requiring approval',
          },
        })
        console.log('[workflow:routing] Approval event sent')
        return { type: 'approval-requested' as const, actionId }
      }

      // Otherwise, response is ready to send (or draft)
      console.log('[workflow:routing] DECISION: Response ready')
      return {
        type: 'response-ready' as const,
        response: agentResult.response,
      }
    })

    // Step 5: Create draft in Front and notify via Slack with rating buttons
    if (routingResult.type === 'response-ready' && routingResult.response) {
      console.log('[workflow:draft] ========== CREATING DRAFT ==========')
      console.log(
        '[workflow:draft] Response length:',
        routingResult.response.length
      )
      console.log(
        '[workflow:draft] Response preview:',
        routingResult.response.slice(0, 300)
      )
      console.log('[workflow:draft] Inbox ID:', context.inboxId)

      // Create action record for tracking feedback
      const actionId = randomUUID()
      const db = getDb()

      await step.run('create-draft-action', async () => {
        console.log('[workflow:draft] Creating action record:', actionId)
        await db.insert(ActionsTable).values({
          id: actionId,
          conversation_id: conversationId,
          app_id: context.appId,
          type: 'draft-response',
          parameters: {
            response: routingResult.response,
            inboxId: context.inboxId,
            category:
              agentResult.toolCalls.length > 0
                ? 'tool-assisted'
                : 'direct-response',
          },
          requires_approval: false, // Draft doesn't need approval, just feedback
          created_at: new Date(),
        })
        console.log('[workflow:draft] Action record created')
      })

      const draftResult = await step.run('create-draft', async () => {
        console.log('[workflow:draft] ========== CALLING FRONT API ==========')
        const frontToken = process.env.FRONT_API_TOKEN
        if (!frontToken) {
          console.error(
            '[workflow:draft] FATAL: FRONT_API_TOKEN not configured'
          )
          return { drafted: false, reason: 'no_token' }
        }

        if (!context.inboxId) {
          console.error('[workflow:draft] FATAL: No inbox ID available')
          console.error('[workflow:draft] context.inboxId:', context.inboxId)
          return { drafted: false, reason: 'no_inbox_id' }
        }

        console.log('[workflow:draft] Creating draft via Front API...')
        console.log('[workflow:draft] conversationId:', conversationId)
        console.log('[workflow:draft] inboxId:', context.inboxId)
        console.log(
          '[workflow:draft] body length:',
          routingResult.response.length
        )
        console.log(
          '[workflow:draft] body preview:',
          routingResult.response.slice(0, 200)
        )

        try {
          const front = createFrontClient(frontToken)

          // Front requires channel_id (cha_xxx), not inbox_id (inb_xxx)
          // Fetch the channel from the inbox
          console.log('[workflow:draft] Fetching channel for inbox...')
          const channelId = await front.getInboxChannel(context.inboxId)
          if (!channelId) {
            console.error(
              '[workflow:draft] No channel found for inbox:',
              context.inboxId
            )
            return { drafted: false, reason: 'no_channel_id' }
          }
          console.log('[workflow:draft] Channel ID:', channelId)

          console.log(
            '[workflow:draft] Front client created, calling createDraft...'
          )
          // TODO: Make signature_id configurable per-app in app-registry
          const FRONT_SIGNATURE_ID = '[PHONE]'
          const draft = await front.createDraft(
            conversationId,
            routingResult.response,
            channelId,
            { signatureId: FRONT_SIGNATURE_ID }
          )
          console.log('[workflow:draft] Draft created successfully!')
          console.log('[workflow:draft] Draft ID:', draft.id)
          return { drafted: true, draftId: draft.id }
        } catch (error) {
          console.error('[workflow:draft] FRONT API ERROR:', error)
          console.error('[workflow:draft] Error details:', {
            conversationId,
            inboxId: context.inboxId,
            bodyLength: routingResult.response.length,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          })
          throw error // Re-throw to let Inngest retry
        }
      })

      // Notify Slack about the draft with rating buttons
      if (draftResult.drafted) {
        console.log('[workflow:slack] ========== NOTIFYING SLACK ==========')
        await step.run('notify-slack-draft', async () => {
          const { postMessage } = await import('../../slack/client')
          const channel = process.env.SLACK_APPROVAL_CHANNEL
          if (!channel) {
            console.error(
              '[workflow:slack] FATAL: SLACK_APPROVAL_CHANNEL not configured'
            )
            return { notified: false }
          }
          console.log('[workflow:slack] Channel:', channel)

          // Front conversation URL format
          const frontUrl = `https://app.frontapp.com/open/${conversationId}`

          // Block Kit blocks - cast needed due to @slack/web-api type restrictions
          const blocks = [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Draft Response Created*\n\nApp: *${context.appId}*\nCustomer: ${context.senderEmail || 'Unknown'}`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Draft preview:*\n>${routingResult.response.slice(0, 300).replace(/\n/g, '\n>')}${routingResult.response.length > 300 ? '...' : ''}`,
              },
            },
            {
              type: 'actions',
              block_id: `draft_rating_${actionId}`,
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Open in Front' },
                  url: frontUrl,
                  style: 'primary',
                },
                {
                  type: 'button',
                  action_id: `rate_good_${actionId}`,
                  text: { type: 'plain_text', text: '👍 Good' },
                  value: JSON.stringify({
                    actionId,
                    rating: 'good',
                    appId: context.appId,
                  }),
                },
                {
                  type: 'button',
                  action_id: `rate_bad_${actionId}`,
                  text: { type: 'plain_text', text: '👎 Bad' },
                  value: JSON.stringify({
                    actionId,
                    rating: 'bad',
                    appId: context.appId,
                  }),
                },
              ],
            },
          ] as const

          console.log('[workflow:slack] Posting message...')
          await postMessage(channel, {
            text: `Draft response created for ${context.appId}`,
            blocks: blocks as unknown as import('@slack/web-api').Block[],
          })

          console.log('[workflow:slack] Slack notification sent!')
          return { notified: true, channel, actionId }
        })
      } else {
        console.log(
          '[workflow:draft] Draft not created, skipping Slack notification'
        )
        console.log(
          '[workflow:draft] draftResult:',
          JSON.stringify(draftResult)
        )
      }
    }

    console.log('[workflow] ========== WORKFLOW COMPLETE ==========')
    console.log('[workflow] Final result:', {
      conversationId,
      messageId,
      routingType: routingResult.type,
      agentEscalated: agentResult.escalated,
      agentRequiresApproval: agentResult.requiresApproval,
    })

    return {
      conversationId,
      messageId,
      routingResult,
      agentResult,
    }
  }
)
