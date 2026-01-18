/**
 * Langfuse LLM observability for tracing agent runs and classifier calls
 *
 * Tracks model usage, input/output, tokens, latency, and cost estimates
 * Links traces to conversationId + appId for filtering and analysis
 */

import { Langfuse } from 'langfuse'
import type { ClassifierResult } from '../router/classifier'

let langfuseClient: Langfuse | null = null

/**
 * Initialize Langfuse client (call once at app startup)
 */
export function initializeLangfuse(): void {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY

  if (!publicKey || !secretKey) {
    console.warn(
      '[Langfuse] LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set, LLM observability disabled'
    )
    return
  }

  langfuseClient = new Langfuse({
    publicKey,
    secretKey,
  })
}

/**
 * Token usage from AI SDK
 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * Agent run result (subset of AI SDK's generateText response)
 */
export interface AgentRunResult {
  text: string
  usage?: TokenUsage
  finishReason:
    | 'stop'
    | 'length'
    | 'content-filter'
    | 'tool-calls'
    | 'error'
    | 'other'
    | 'unknown'
}

/**
 * Conversation context for tracing
 */
export interface ConversationContext {
  conversationId: string
  appId: string
  userEmail?: string
  messages?: Array<{ role: string; content: string }>
}

/**
 * Trace an agent run with Langfuse
 */
export async function traceAgentRun(
  agentRun: AgentRunResult,
  context: ConversationContext
): Promise<{ traceId: string; generationId: string }> {
  if (!langfuseClient) {
    // Silently skip if not initialized (e.g., in dev without keys)
    return { traceId: '', generationId: '' }
  }

  try {
    const trace = langfuseClient.trace({
      name: 'support-agent',
      metadata: {
        conversationId: context.conversationId,
        appId: context.appId,
        ...(context.userEmail && { userEmail: context.userEmail }),
      },
    })

    const model = 'claude-sonnet-4-[PHONE]' // Default model
    const usage = agentRun.usage || {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }

    // Estimate cost (Sonnet 4: $3/MTok input, $15/MTok output as of 2025-01)
    const inputCost = (usage.promptTokens / 1_000_000) * 3
    const outputCost = (usage.completionTokens / 1_000_000) * 15
    const estimatedCostUsd = inputCost + outputCost

    const generation = trace.generation({
      name: 'agent-reasoning',
      model,
      input: context.messages || [],
      output: agentRun.text,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
      metadata: {
        estimatedCostUsd,
        finishReason: agentRun.finishReason,
      },
    })

    return {
      traceId: trace.id,
      generationId: generation.id,
    }
  } catch (error) {
    // Don't throw - observability failures shouldn't crash the app
    console.error('[Langfuse] Failed to trace agent run:', error)
    return { traceId: '', generationId: '' }
  }
}

/**
 * Trace a classification with Langfuse
 */
export async function traceClassification(
  input: string,
  output: ClassifierResult,
  usage: TokenUsage
): Promise<string> {
  if (!langfuseClient) {
    // Silently skip if not initialized
    return ''
  }

  try {
    const trace = langfuseClient.trace({
      name: 'classifier',
      metadata: {
        category: output.category,
        confidence: output.confidence,
      },
    })

    // Classifier uses Haiku 4.5 ($0.80/MTok input, $4/MTok output as of 2025-01)
    const inputCost = (usage.promptTokens / 1_000_000) * 0.8
    const outputCost = (usage.completionTokens / 1_000_000) * 4
    const estimatedCostUsd = inputCost + outputCost

    trace.generation({
      name: 'classify-message',
      model: 'anthropic/claude-haiku-4-5',
      input,
      output: {
        category: output.category,
        confidence: output.confidence,
        reasoning: output.reasoning,
      },
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
      metadata: {
        estimatedCostUsd,
      },
    })

    return trace.id
  } catch (error) {
    // Don't throw - observability failures shouldn't crash the app
    console.error('[Langfuse] Failed to trace classification:', error)
    return ''
  }
}
