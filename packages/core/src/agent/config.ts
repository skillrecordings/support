import { IntegrationClient } from '@skillrecordings/sdk/client'
import { type ModelMessage, generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { getApp } from '../services/app-registry'

/**
 * Support agent system prompt
 */
export const SUPPORT_AGENT_PROMPT = `You are a skilled support agent for Skill Recordings technical education products (Total TypeScript, Pro Tailwind, etc.).

## Your Role
- Help customers resolve issues quickly and accurately
- Look up customer purchase history and conversation context before responding
- Search the knowledge base for product-specific solutions
- Provide clear, helpful answers with empathy and professionalism

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

## Response Style
- Be personal, use first names
- Be concise, not verbose
- Don't apologize excessively
- Focus on resolution, not explanation

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
      // TODO(REMOVE-STUB): Implement via Upstash Vector hybrid search
      console.warn('[searchKnowledge] Using STUB - implement Upstash Vector')
      return { results: [], message: 'Knowledge search not yet implemented' }
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
}

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
}

/**
 * Run the support agent on a message
 *
 * Uses Claude Opus 4.5 via AI Gateway.
 * Model string format: 'anthropic/claude-opus-4-5'
 */
export async function runSupportAgent(input: AgentInput): Promise<AgentOutput> {
  const { message, conversationHistory = [], customerContext, appId } = input

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
  systemPrompt += `\nApp: ${appId}`

  // AI SDK v6: model as string for AI Gateway, stopWhen for multi-step
  const result = await generateText({
    model: 'anthropic/claude-opus-4-5',
    system: systemPrompt,
    messages,
    tools: agentTools,
    stopWhen: stepCountIs(5),
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

  // Check if any tool requires approval
  const requiresApproval = toolCalls.some(
    (tc) => tc.name === 'processRefund' || tc.name === 'transferPurchase'
  )

  return {
    response: result.text,
    toolCalls,
    requiresApproval,
    reasoning: undefined, // v6 reasoning access differs, will implement when needed
  }
}
