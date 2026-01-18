import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, tool, type CoreMessage } from 'ai'
import { z } from 'zod'
import { supportTools } from '../tools'

/**
 * AI Gateway-backed Anthropic provider
 *
 * Uses AI_GATEWAY_API_KEY env var for authentication.
 * Model format: anthropic/claude-opus-4-5 (no version suffix needed)
 */
const anthropic = createAnthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  // If using a custom gateway URL, set baseURL here:
  // baseURL: process.env.AI_GATEWAY_BASE_URL,
})

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
 */
export const agentTools = {
  lookupUser: tool({
    description: 'Look up a user by email to get their account details and purchase history',
    parameters: z.object({
      email: z.string().email().describe('Customer email address'),
      appId: z.string().describe('App identifier (e.g., total-typescript)'),
    }),
    execute: async ({ email, appId }) => {
      // TODO: Implement via app registry
      return { found: false, message: 'User lookup not yet implemented' }
    },
  }),

  searchKnowledge: tool({
    description: 'Search the knowledge base for product documentation and FAQs',
    parameters: z.object({
      query: z.string().describe('Search query'),
      appId: z.string().describe('App to search within'),
    }),
    execute: async ({ query, appId }) => {
      // TODO: Implement via Upstash Vector
      return { results: [], message: 'Knowledge search not yet implemented' }
    },
  }),

  draftResponse: tool({
    description: 'Draft a response to send to the customer',
    parameters: z.object({
      body: z.string().describe('Response body text'),
    }),
    execute: async ({ body }) => {
      return { drafted: true, body }
    },
  }),

  escalateToHuman: tool({
    description: 'Escalate this conversation to a human support agent',
    parameters: z.object({
      reason: z.string().describe('Why this needs human attention'),
      urgency: z.enum(['low', 'medium', 'high']).describe('How urgent is this'),
    }),
    execute: async ({ reason, urgency }) => {
      return { escalated: true, reason, urgency }
    },
  }),
}

export interface AgentInput {
  /** Current message from customer */
  message: string
  /** Conversation history */
  conversationHistory?: CoreMessage[]
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
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>
  /** Whether action requires approval */
  requiresApproval: boolean
  /** Reasoning for the response */
  reasoning?: string
}

/**
 * Run the support agent on a message
 *
 * Uses Claude Opus 4.5 via AI Gateway.
 */
export async function runSupportAgent(input: AgentInput): Promise<AgentOutput> {
  const { message, conversationHistory = [], customerContext, appId } = input

  // Build messages array
  const messages: CoreMessage[] = [
    ...conversationHistory,
    { role: 'user', content: message },
  ]

  // Add customer context to system prompt if available
  let systemPrompt = SUPPORT_AGENT_PROMPT
  if (customerContext) {
    systemPrompt += `\n\n## Current Customer Context\n`
    if (customerContext.email) systemPrompt += `Email: ${customerContext.email}\n`
    if (customerContext.name) systemPrompt += `Name: ${customerContext.name}\n`
    if (customerContext.purchases?.length) {
      systemPrompt += `Purchases:\n${customerContext.purchases.map(p => `- ${p.product} (${p.date})`).join('\n')}\n`
    }
  }
  systemPrompt += `\nApp: ${appId}`

  const result = await generateText({
    model: anthropic('claude-opus-4-5'),
    system: systemPrompt,
    messages,
    tools: agentTools,
    maxSteps: 5, // Allow up to 5 tool calls
  })

  // Extract tool calls
  const toolCalls = result.steps
    .flatMap(step => step.toolCalls || [])
    .map(tc => ({
      name: tc.toolName,
      args: tc.args as Record<string, unknown>,
      result: tc.toolResult,
    }))

  // Check if any tool requires approval
  const requiresApproval = toolCalls.some(tc =>
    tc.name === 'processRefund' || tc.name === 'transferPurchase'
  )

  return {
    response: result.text,
    toolCalls,
    requiresApproval,
    reasoning: result.reasoning?.text,
  }
}
