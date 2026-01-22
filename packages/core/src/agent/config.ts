import { database } from '@skillrecordings/database'
import { IntegrationClient } from '@skillrecordings/sdk/client'
import type {
  ContentSearchRequest,
  ContentSearchResponse,
} from '@skillrecordings/sdk/types'
import { type ModelMessage, generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { cachedContentSearch } from '../cache/content-cache'
import { classifyMessage } from '../router/classifier'
import { getApp } from '../services/app-registry'
import { getTrustScore } from '../trust/repository'
import { calculateTrustScore, shouldAutoSend } from '../trust/score'
import { buildAgentContext } from '../vector/retrieval'

/**
 * Support agent system prompt
 *
 * IMPORTANT: Never mention "Skill Recordings" - only reference the specific
 * product name (Total TypeScript, Pro Tailwind, etc.) and creator.
 */
export const SUPPORT_AGENT_PROMPT = `You are a support agent for a technical education product.

## Critical Rules
1. NEVER mention "Skill Recordings" - only use the specific product name
2. NEVER expose internal system state to customers. This includes:
   - Configuration errors ("no instructor configured", "app not found")
   - Routing decisions ("I can't route this", "forwarding to...")
   - Tool failures or API errors
   - Any meta-commentary about what you "can" or "can't" do
3. If a tool fails or returns an error, DO NOT draft that error as a response
4. **Tool errors are no-response signals.** If assignToInstructor fails, lookupUser fails, or any tool returns an error object, stop. Don't draft anything. The conversation will be handled manually.

## When NOT to Respond

Simply don't call draftResponse. Don't explain why. These need no response:
- Bounce notifications, mailer-daemon messages
- Vendor/spam emails not from actual customers
- Auto-replies, out-of-office messages
- System notifications (AWS, GitHub, etc.)
- Thank-you/acknowledgment messages after you've already helped
- Fan mail or personal messages to the instructor (route silently if possible, otherwise ignore)
- **Any tool failure** - if a tool returns an error, that's a no-response signal

If you shouldn't respond, just stop. No draft. No explanation.

## NEVER FABRICATE PRODUCT CONTENT
This is critical. If you don't have knowledge base results about the product:
- DO NOT invent course modules, sections, lessons, or features
- DO NOT claim to know what the product contains or teaches
- DO NOT suggest "start with the fundamentals section" or similar made-up advice
- DO NOT describe product structure you haven't been told about

If asked about product content without knowledge base context, either:
1. Ask what specific topic they want help with
2. Acknowledge you don't have that information and offer to escalate
3. Suggest they check the product's website directly

WRONG: "Start with the fundamentals section. It covers core concepts like X, Y, Z."
RIGHT: "What specific topic are you trying to learn about? I can point you to the right resources once I know what you're working on."

## Your Role
- Help customers resolve issues quickly and accurately
- Look up customer purchase history and conversation context before responding
- Search the knowledge base for product-specific solutions
- Provide clear, helpful answers with empathy and professionalism

## Instructor Correspondence (Fan Mail, Personal Messages)

Some messages are personal correspondence meant for the instructor/creator, not support requests:
- Fan mail or appreciation ("Your work changed my career")
- Personal feedback about teaching style
- Messages addressing the instructor by name with personal content
- Community engagement meant for the creator

How to handle:
1. Call assignToInstructor to route it
2. Check the result:
   - If assigned: true → optionally draft brief acknowledgment ("I'll make sure [instructor] sees this.")
   - If assigned: false or error → STOP. Don't draft anything. Silence is fine.

ABSOLUTELY NEVER draft:
- Tool errors ("No instructor configured", "Front API token not configured")
- Routing explanations ("I'm forwarding this to...", "I can't route this because...")
- Configuration issues ("this app", "not configured", "missing")
- Meta-commentary about what you tried or what failed

When assignToInstructor fails, the message will be handled manually. Just stop.

## Authority Levels

AUTO-APPROVE (do immediately):
- Magic link requests
- Password reset requests
- Refunds within 30 days of purchase
- Transfers within 14 days of purchase
- Email/name updates

REQUIRE-APPROVAL (draft action, wait for human):
- Refunds 30-45 days after purchase
- Transfers after 14 days
- Bulk seat management
- Account deletions

ALWAYS-ESCALATE (flag for human, do not act):
- Angry/frustrated customers (detect sentiment)
- Legal language (lawsuit, lawyer, etc.)
- Repeated failed interactions
- Anything you're uncertain about

## Response Style - SOUND HUMAN

Write like a real person typing an email, not an AI or corporate drone.

BANNED PHRASES (never use these):
- "Great!" or any exclamatory opener
- "I'd recommend" or "I would recommend"
- "I'd suggest" or "I would suggest"
- "Is there a specific area you're curious about?"
- "Would you like help with X?"
- "Let me know if you have any other questions"
- "I hope this helps"
- "Happy to help"
- "I understand" or "I hear you"
- "I apologize for any inconvenience"
- Em dashes (—)
- Anything about your limitations or what you "can't" do

FORMAT:
- 2-3 short paragraphs max
- Get to the point immediately
- Use bullet points sparingly, only when listing 3+ items
- End with a specific action or question, not an open invitation

TONE:
- Dry, matter-of-fact
- Zero enthusiasm or warmth performance
- Like a helpful coworker on Slack, not a customer service rep
- Developers appreciate brevity - respect their time
- If you need info, just ask. No softening.

EXAMPLES:

GOOD: "Login link: [link]. Works for 24h."
BAD: "Great question! I'd be happy to help you with that. I've sent a magic link to your email address. Is there anything else I can help you with today?"

GOOD: "Purchase was Jan 5th. Want me to refund it?"
BAD: "I understand how frustrating this must be. I'd recommend we look into your purchase history. I can see that your purchase was made on January 5th. Would you like me to assist you with processing a refund?"

GOOD: "For TypeScript basics, start with the Beginner's TypeScript tutorial. It covers types, interfaces, and the common gotchas."
BAD: "Great! If you're just starting out with TypeScript, I'd recommend beginning with the fundamentals. Start with the basics - learn how TypeScript differs from JavaScript..."

## Guidelines
- Always verify customer identity and purchase status first
- Use conversation context to provide personalized responses
- Search knowledge base before providing generic answers
- When uncertain, ask clarifying questions
- Flag edge cases or unusual requests for human review

Remember: You're here to make the customer's experience exceptional.`

/**
 * AI SDK tools for the support agent
 *
 * Uses AI SDK v6 tool() pattern with inputSchema
 */
export const agentTools = {
  lookupUser: tool({
    description:
      'Look up a user by email to get their account details and purchase history',
    inputSchema: z.object({
      email: z.string().email().describe('Customer email address'),
      appId: z.string().describe('App identifier (e.g., total-typescript)'),
    }),
    execute: async ({ email, appId }) => {
      try {
        // Look up app configuration from registry
        const app = await getApp(appId)
        if (!app) {
          return {
            found: false,
            error: `App not found: ${appId}`,
          }
        }

        // Create IntegrationClient with app's webhook config
        const client = new IntegrationClient({
          baseUrl: app.integration_base_url,
          webhookSecret: app.webhook_secret,
        })

        // Look up user via app's integration endpoint
        const user = await client.lookupUser(email)
        if (!user) {
          return {
            found: false,
            user: null,
            purchases: [],
          }
        }

        // Fetch user's purchases
        const purchases = await client.getPurchases(user.id)

        return {
          found: true,
          user,
          purchases,
        }
      } catch (error) {
        return {
          found: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
  }),

  searchKnowledge: tool({
    description: 'Search the knowledge base for product documentation and FAQs',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      appId: z.string().describe('App to search within'),
    }),
    execute: async ({ query, appId }) => {
      const context = await buildAgentContext({ query, appId })
      return {
        similarTickets: context.similarTickets,
        knowledge: context.knowledge,
        goodResponses: context.goodResponses,
      }
    },
  }),

  draftResponse: tool({
    description: 'Draft a response to send to the customer',
    inputSchema: z.object({
      body: z.string().describe('Response body text'),
    }),
    execute: async ({ body }) => {
      return { drafted: true, body }
    },
  }),

  escalateToHuman: tool({
    description: 'Escalate this conversation to a human support agent',
    inputSchema: z.object({
      reason: z.string().describe('Why this needs human attention'),
      urgency: z.enum(['low', 'medium', 'high']).describe('How urgent is this'),
    }),
    execute: async ({ reason, urgency }) => {
      return { escalated: true, reason, urgency }
    },
  }),

  processRefund: tool({
    description:
      'Request a refund for a customer purchase via the app. Use only for eligible refund requests within policy. Refunds within 30 days are auto-approved, 30-45 days require human approval. The app processes the actual Stripe refund.',
    inputSchema: z.object({
      purchaseId: z.string().describe('Purchase ID to refund'),
      appId: z.string().describe('App identifier'),
      reason: z.string().describe('Reason for the refund'),
    }),
    execute: async ({ purchaseId, appId, reason }) => {
      // Tool execution is deferred to approval flow
      // This just captures the intent for HITL processing
      // The app will process the actual Stripe refund via SDK
      return {
        status: 'pending_approval',
        purchaseId,
        appId,
        reason,
        message: 'Refund request submitted for approval',
      }
    },
  }),

  getPaymentHistory: tool({
    description:
      'Fetch payment/charge history for a customer via Stripe Connect. Returns a list of recent charges with amounts, status, and dates. Use this to verify payment status before processing refunds.',
    inputSchema: z.object({
      customerEmail: z.string().email().describe('Customer email address'),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe('Number of charges to return (default 10)'),
    }),
    execute: async ({ customerEmail, limit }, context) => {
      // Import dynamically to avoid circular dependencies
      const { getPaymentHistory } = await import(
        '../tools/stripe-payment-history'
      )
      // Note: Tool expects stripeAccountId in context.appConfig
      const result = await getPaymentHistory.execute(
        { customerEmail, limit },
        context as any // Context should have appConfig.stripeAccountId
      )
      if (result.success) {
        return result.data
      }
      return { error: result.error.message, charges: [] }
    },
  }),

  getSubscriptionStatus: tool({
    description:
      'Check subscription status for a customer via Stripe Connect. Returns subscription details including status, plan, and billing period. Use this to verify active subscriptions.',
    inputSchema: z.object({
      customerId: z.string().describe('Stripe customer ID'),
      stripeAccountId: z
        .string()
        .describe('Connected Stripe account ID (e.g., acct_1LFP5yAozSgJZBRP)'),
    }),
    execute: async ({ customerId, stripeAccountId }) => {
      // Import dynamically to avoid circular dependencies
      const { getSubscriptionStatus } = await import(
        '../tools/stripe-subscription-status'
      )
      const result = await getSubscriptionStatus.execute(
        { customerId, stripeAccountId },
        {} as any // Minimal context - Stripe tools don't need full context
      )
      if (result.success) {
        return result.data
      }
      return { error: result.error.message, subscription: null }
    },
  }),

  lookupCharge: tool({
    description:
      'Lookup a specific charge by ID via Stripe Connect. Returns charge details including amount, status, refund status, and customer. Use when you have a specific charge ID to investigate.',
    inputSchema: z.object({
      chargeId: z.string().describe('Stripe charge ID (starts with ch_)'),
    }),
    execute: async ({ chargeId }, context) => {
      // Import dynamically to avoid circular dependencies
      const { lookupCharge } = await import('../tools/stripe-lookup-charge')
      // Note: Tool expects stripeAccountId in context.appConfig
      const result = await lookupCharge.execute(
        { chargeId },
        context as any // Context should have appConfig.stripeAccountId
      )
      if (result.success) {
        return result.data
      }
      return { error: result.error.message, charge: null }
    },
  }),

  verifyRefund: tool({
    description:
      'Verify refund status via Stripe Connect. Returns refund details including status, amount, charge ID, and reason. Use to confirm a refund was processed after an app notifies us.',
    inputSchema: z.object({
      refundId: z.string().describe('Stripe refund ID (starts with re_)'),
    }),
    execute: async ({ refundId }, context) => {
      // Import dynamically to avoid circular dependencies
      const { verifyRefund } = await import('../tools/stripe-verify-refund')
      // Note: Tool expects stripeAccountId in context.appConfig
      const result = await verifyRefund.execute(
        { refundId },
        context as any // Context should have appConfig.stripeAccountId
      )
      if (result.success) {
        return result.data
      }
      return { error: result.error.message, refund: null }
    },
  }),

  transferPurchase: tool({
    description:
      'Transfer a purchase from one user to another. Use for license transfers when a customer needs to move their purchase to a different email. Transfers within 14 days are auto-approved, older transfers require human approval.',
    inputSchema: z.object({
      purchaseId: z.string().describe('Purchase ID to transfer'),
      appId: z.string().describe('App identifier'),
      fromUserId: z.string().describe('Current owner user ID'),
      toEmail: z.string().email().describe('Email of the new owner'),
      reason: z.string().describe('Reason for the transfer'),
    }),
    execute: async ({ purchaseId, appId, fromUserId, toEmail, reason }) => {
      // Tool execution is deferred to approval flow
      // This just captures the intent for HITL processing
      // The app will process the actual transfer via SDK
      return {
        status: 'pending_approval',
        purchaseId,
        appId,
        fromUserId,
        toEmail,
        reason,
        message: 'Transfer request submitted for approval',
      }
    },
  }),

  assignToInstructor: tool({
    description:
      'Assign conversation to the instructor/creator for personal correspondence. Use when the message is fan mail, personal feedback, or directed at the instructor personally rather than being a support request.',
    inputSchema: z.object({
      conversationId: z.string().describe('Front conversation ID'),
      reason: z.string().describe('Why this is being routed to the instructor'),
    }),
    execute: async ({ conversationId, reason }, context) => {
      // Get instructor teammate ID from app config
      const appConfig = (context as any)?.appConfig
      const instructorTeammateId = appConfig?.instructor_teammate_id

      if (!instructorTeammateId) {
        return {
          assigned: false,
          error: 'No instructor configured for this app',
        }
      }

      // Import Front SDK and assign
      const { createFrontClient } = await import('@skillrecordings/front-sdk')
      const apiToken = process.env.FRONT_API_TOKEN
      if (!apiToken) {
        return { assigned: false, error: 'Front API token not configured' }
      }

      const front = createFrontClient({ apiToken })
      await front.conversations.updateAssignee(
        conversationId,
        instructorTeammateId
      )

      return {
        assigned: true,
        instructorTeammateId,
        reason,
      }
    },
  }),

  searchProductContent: tool({
    description:
      'Search product content (courses, lessons, articles) to find resources relevant to customer questions. Use when customer asks about topics, features, or how to do something.',
    inputSchema: z.object({
      query: z.string().describe('Natural language search query'),
      types: z
        .array(
          z.enum([
            'course',
            'module',
            'lesson',
            'article',
            'exercise',
            'resource',
            'social',
          ])
        )
        .optional()
        .describe('Filter by content type'),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe('Maximum results to return'),
    }),
    execute: async ({ query, types, limit }, context) => {
      const appId = (context as any)?.appId
      const integrationClient = (context as any)?.integrationClient

      if (!appId || !integrationClient) {
        return {
          error: 'Missing appId or integrationClient in context',
          results: [],
        }
      }

      const request: ContentSearchRequest = { query, types, limit }
      const response = await cachedContentSearch(appId, request, () =>
        integrationClient.searchContent(request)
      )

      return response
    },
  }),
}

/** Available models via AI Gateway */
export type SupportAgentModel =
  | 'anthropic/claude-haiku-4-5'
  | 'anthropic/claude-sonnet-4-5'
  | 'anthropic/claude-opus-4-5'

/** Default model for cost efficiency */
export const DEFAULT_AGENT_MODEL: SupportAgentModel =
  'anthropic/claude-haiku-4-5'

export interface AgentInput {
  /** Current message from customer */
  message: string
  /** Conversation history */
  conversationHistory?: ModelMessage[]
  /** Customer context (email, purchases, etc.) */
  customerContext?: {
    email?: string
    name?: string
    purchases?: Array<{ id: string; product: string; date: string }>
  }
  /** App identifier */
  appId: string
  /** Model to use (defaults to Haiku for cost efficiency) */
  model?: SupportAgentModel
  /** Prior knowledge from semantic memory */
  priorKnowledge?: string
  /** Integration client for searchProductContent tool */
  integrationClient?: IntegrationClient
  /** App config for tools (instructor routing, etc.) */
  appConfig?: {
    instructor_teammate_id?: string
    stripeAccountId?: string
  }
}

export interface AgentOutput {
  /** Generated response text */
  response: string
  /** Tool calls made */
  toolCalls: Array<{
    name: string
    args: Record<string, unknown>
    result: unknown
  }>
  /** Whether action requires approval */
  requiresApproval: boolean
  /** Reasoning for the response */
  reasoning?: string
  /** Whether response was auto-sent (bypassed approval) */
  autoSent?: boolean
}

/**
 * Run the support agent on a message
 *
 * Uses AI Gateway with configurable model.
 * Defaults to Haiku for cost efficiency (~60x cheaper than Opus).
 */
export async function runSupportAgent(input: AgentInput): Promise<AgentOutput> {
  console.log('[agent] ========== RUN SUPPORT AGENT ==========')
  const startTime = Date.now()

  const {
    message,
    conversationHistory = [],
    customerContext,
    appId,
    model = DEFAULT_AGENT_MODEL,
    priorKnowledge,
    integrationClient,
    appConfig,
  } = input

  console.log('[agent] Input:', {
    messageLength: message?.length,
    messagePreview: message?.slice(0, 200),
    conversationHistoryLength: conversationHistory.length,
    customerEmail: customerContext?.email,
    appId,
    model,
    hasPriorKnowledge: !!priorKnowledge,
  })

  // Retrieve context from vector store
  console.log('[agent] Retrieving context from vector store...')
  const retrievedContext = await buildAgentContext({
    appId,
    query: message,
    customerEmail: customerContext?.email,
  })
  console.log('[agent] Retrieved context:', {
    similarTickets: retrievedContext.similarTickets.length,
    knowledge: retrievedContext.knowledge.length,
    goodResponses: retrievedContext.goodResponses.length,
  })

  // Build messages array
  const messages: ModelMessage[] = [
    ...conversationHistory,
    { role: 'user', content: message },
  ]

  // Add customer context to system prompt if available
  let systemPrompt = SUPPORT_AGENT_PROMPT
  if (customerContext) {
    systemPrompt += `\n\n## Current Customer Context\n`
    if (customerContext.email)
      systemPrompt += `Email: ${customerContext.email}\n`
    if (customerContext.name) systemPrompt += `Name: ${customerContext.name}\n`
    if (customerContext.purchases?.length) {
      systemPrompt += `Purchases:\n${customerContext.purchases.map((p) => `- ${p.product} (${p.date})`).join('\n')}\n`
    }
  }

  // Add prior knowledge from semantic memory
  if (priorKnowledge && priorKnowledge.trim().length > 0) {
    systemPrompt += `\n\n## Prior Knowledge (from memory)\n${priorKnowledge}\n`
  }

  // Add retrieved context to system prompt
  if (retrievedContext.similarTickets.length > 0) {
    systemPrompt += `\n\n## Similar Past Tickets\n${retrievedContext.similarTickets.map((t) => `- ${t.data}`).join('\n')}\n`
  }
  if (retrievedContext.knowledge.length > 0) {
    systemPrompt += `\n\n## Relevant Knowledge Base\n${retrievedContext.knowledge.map((k) => `- ${k.data}`).join('\n')}\n`
  }
  if (retrievedContext.goodResponses.length > 0) {
    systemPrompt += `\n\n## Good Response Examples\n${retrievedContext.goodResponses.map((r) => `- ${r.data}`).join('\n')}\n`
  }

  // Explicit warning when knowledge base is empty - prevents hallucination
  const hasKnowledge =
    retrievedContext.similarTickets.length > 0 ||
    retrievedContext.knowledge.length > 0 ||
    retrievedContext.goodResponses.length > 0
  if (!hasKnowledge) {
    systemPrompt += `\n\n## WARNING: No Knowledge Base Results
The knowledge base returned no results for this query. You do not have verified information about this product's content, structure, modules, or features.

DO NOT:
- Invent or guess product content
- Describe courses, modules, or lessons you haven't been told about
- Make claims about what the product teaches or includes

INSTEAD:
- Ask clarifying questions about what specifically the customer needs help with
- Acknowledge limitations: "I don't have specific information about that course content"
- Offer to escalate to someone who can help with curriculum questions
`
  }

  systemPrompt += `\nApp: ${appId}`

  console.log('[agent] System prompt length:', systemPrompt.length)
  console.log('[agent] Messages count:', messages.length)
  console.log('[agent] Calling AI SDK generateText...')

  // AI SDK v6: model as string for AI Gateway, stopWhen for multi-step
  const aiStartTime = Date.now()
  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    tools: agentTools,
    stopWhen: stepCountIs(5),
    experimental_context: {
      appId,
      integrationClient,
      appConfig,
    },
  })
  console.log(`[agent] AI SDK call completed (${Date.now() - aiStartTime}ms)`)
  console.log('[agent] AI result:', {
    textLength: result.text?.length,
    textPreview: result.text?.slice(0, 300),
    stepsCount: result.steps?.length,
  })

  // AI SDK v6: toolCalls use 'input' not 'args', results are in toolResults
  const toolCalls = result.steps.flatMap((step) => {
    const resultsMap = new Map(
      (step.toolResults || []).map((r) => [r.toolCallId, r.output])
    )
    return (step.toolCalls || []).map((tc) => ({
      name: tc.toolName,
      args: tc.input as Record<string, unknown>,
      result: resultsMap.get(tc.toolCallId),
    }))
  })

  console.log(
    '[agent] Tool calls:',
    toolCalls.map((tc) => ({
      name: tc.name,
      args: tc.args,
      hasResult: !!tc.result,
    }))
  )

  // Check if any tool requires approval
  let requiresApproval = toolCalls.some(
    (tc) => tc.name === 'processRefund' || tc.name === 'transferPurchase'
  )
  console.log('[agent] Requires approval (from tool calls):', requiresApproval)

  // Auto-send gating: classify message and check trust score
  console.log('[agent] Classifying message...')
  const classifierResult = await classifyMessage(message, {
    recentMessages: conversationHistory.map((m) => m.content as string),
  })
  console.log('[agent] Classifier result:', classifierResult)

  // Lookup trust score from database
  console.log('[agent] Looking up trust score...')
  const trustScoreRecord = await getTrustScore(
    database,
    appId,
    classifierResult.category
  )
  console.log('[agent] Trust score record:', trustScoreRecord)

  // Extract values with safe fallbacks
  const category = classifierResult.category
  const confidence = classifierResult.confidence
  const trustScore = trustScoreRecord?.trustScore ?? 0
  const sampleCount = trustScoreRecord?.sampleCount ?? 0

  // Determine if auto-send is allowed
  const canAutoSend = shouldAutoSend(
    category,
    trustScore,
    confidence,
    sampleCount
  )
  console.log('[agent] Auto-send check:', {
    category,
    confidence,
    trustScore,
    sampleCount,
    canAutoSend,
  })

  let autoSent = false
  if (canAutoSend && !requiresApproval) {
    requiresApproval = false
    autoSent = true
  }

  const totalTime = Date.now() - startTime
  console.log(`[agent] ========== AGENT COMPLETE (${totalTime}ms) ==========`)
  console.log('[agent] Final output:', {
    responseLength: result.text?.length,
    toolCallsCount: toolCalls.length,
    requiresApproval,
    autoSent,
  })

  return {
    response: result.text,
    toolCalls,
    requiresApproval,
    reasoning: undefined, // v6 reasoning access differs, will implement when needed
    autoSent,
  }
}
