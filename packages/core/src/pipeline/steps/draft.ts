/**
 * Step 4: DRAFT
 *
 * Generates response using gathered context.
 * Before LLM generation, checks for high-confidence template matches.
 *
 * Flow:
 * 1. Check for template match (>threshold confidence)
 * 2. If match: Use template with variable interpolation
 * 3. If no match: Query memory for relevant past decisions, then generate with LLM
 */

import { generateText } from 'ai'
import {
  type RelevantMemory,
  citeMemories,
  formatMemoriesForPrompt,
  queryMemoriesForStage,
} from '../../memory/query'
import { log, traceDraftCreation } from '../../observability/axiom'
import {
  type TemplateMatch,
  buildTemplateVariables,
  createTemplateUsageLog,
  interpolateTemplate,
  logTemplateUsage,
  matchTemplate,
} from '../../templates/match'
import type {
  DraftInput,
  DraftOutput,
  GatherOutput,
  MessageCategory,
} from '../types'
import { buildCategoryPrompt } from './draft-prompts'
import { formatContextForPrompt } from './gather'

// ============================================================================
// Draft prompts
// ============================================================================
// Category-specific prompts are now in ./draft-prompts.ts which builds them
// dynamically from gathered context (refund policy, invoice URLs, promotions,
// license info, etc.). See buildCategoryPrompt() for the implementation.
//
// The old hardcoded prompts (with "30 days", "totaltypescript.com/invoices")
// are replaced by dynamic versions that read from context with fallback defaults.
//
// The PROMPT_OVERRIDES map below allows runtime overrides via setPromptForCategory().
// When set, the override takes precedence over the dynamic prompt.

/** Runtime prompt overrides set via setPromptForCategory() */
const PROMPT_OVERRIDES: Partial<Record<MessageCategory, string>> = {}

// ============================================================================
// Main draft function
// ============================================================================

export interface DraftOptions {
  model?: string
  promptOverride?: string
  /** App ID for template matching (required for template lookup) */
  appId?: string
  /** Confidence threshold for template matching (default: 0.9) */
  templateThreshold?: number
  /** Skip template matching and always use LLM */
  skipTemplateMatch?: boolean
  /** Skip memory query (for testing or when memory service unavailable) */
  skipMemoryQuery?: boolean
  /** Pipeline run ID for memory citation tracking */
  runId?: string
  /** Conversation ID for correction tracking */
  conversationId?: string
  /**
   * Use agent mode with tools (runSupportAgent) instead of raw generateText.
   * When true, the agent can use tools like processRefund, transferPurchase, etc.
   * Tool calls that require approval will be captured in the output.
   */
  useAgentMode?: boolean
  /** Customer email for agent context */
  customerEmail?: string
  /** Customer name for agent context */
  customerName?: string
}

export interface DraftResult extends DraftOutput {
  /** Template used if matched, undefined if LLM generated */
  templateUsed?: TemplateMatch
  /** Memories that were cited in this draft */
  memoriesCited?: RelevantMemory[]
}

export async function draft(
  input: DraftInput,
  options: DraftOptions = {}
): Promise<DraftResult> {
  const {
    model = 'anthropic/claude-haiku-4-5',
    promptOverride,
    appId,
    templateThreshold = 0.9,
    skipTemplateMatch = false,
    skipMemoryQuery = false,
    runId,
    conversationId,
  } = options
  const { message, classification, context } = input

  const startTime = Date.now()

  await log('debug', 'draft started', {
    workflow: 'pipeline',
    step: 'draft',
    appId,
    conversationId,
    category: classification.category,
    messageLength: message.body.length,
    skipTemplateMatch,
    skipMemoryQuery,
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Try template matching first (if enabled)
  // ─────────────────────────────────────────────────────────────────────────
  if (!skipTemplateMatch && appId) {
    try {
      const query = `${message.subject} ${message.body}`.slice(0, 500)
      const matchResult = await matchTemplate({
        appId,
        category: classification.category,
        context,
        query,
        threshold: templateThreshold,
      })

      if (matchResult.match) {
        // Found high-confidence template match!
        const variables = buildTemplateVariables(context)
        const interpolatedContent = interpolateTemplate(
          matchResult.match.content,
          variables
        )

        // Log usage for analytics
        logTemplateUsage(
          createTemplateUsageLog(
            appId,
            classification.category,
            matchResult.match
          )
        )

        const durationMs = Date.now() - startTime

        // High-cardinality decision-point logging for template match
        await log('info', 'draft:decision', {
          workflow: 'pipeline',
          step: 'draft',
          appId,
          conversationId,
          // Decision outcome
          category: classification.category,
          decisionPath: 'template',
          // Template match details
          templateName: matchResult.match.name,
          templateConfidence: matchResult.match.confidence,
          templateThreshold,
          confidenceAboveThreshold:
            matchResult.match.confidence >= templateThreshold,
          // Draft result
          draftLength: interpolatedContent.length,
          variablesInterpolated: Object.keys(variables).length,
          // Decision inputs
          hasContext: !!context,
          hasUser: !!context.user,
          hasPurchases: context.purchases.length > 0,
          hasKnowledge: context.knowledge.length > 0,
          // Why this path
          usedTemplate: true,
          usedMemory: false,
          usedLLM: false,
          usedAgentMode: false,
          durationMs,
        })

        return {
          draft: interpolatedContent,
          reasoning: `Template match: "${matchResult.match.name}" (confidence: ${matchResult.match.confidence.toFixed(3)})`,
          toolsUsed: ['template_match'],
          durationMs,
          templateUsed: matchResult.match,
        }
      }

      // Log that we're falling back to LLM
      logTemplateUsage(
        createTemplateUsageLog(appId, classification.category, null)
      )
    } catch (error) {
      // Template matching failed, fall back to LLM silently
      await log('warn', 'draft template matching failed', {
        workflow: 'pipeline',
        step: 'draft',
        appId,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Query memory for relevant past decisions
  // ─────────────────────────────────────────────────────────────────────────
  let memories: RelevantMemory[] = []
  let memoryContext = ''

  if (!skipMemoryQuery && appId) {
    try {
      // Build situation context for memory query
      const situation = buildDraftSituation(
        classification.category,
        context,
        message
      )

      memories = await queryMemoriesForStage({
        appId,
        stage: 'draft',
        situation,
        category: classification.category,
        limit: 5,
        threshold: 0.6,
      })

      if (memories.length > 0) {
        memoryContext = formatMemoriesForPrompt(memories)

        await log('debug', 'draft memory query results', {
          workflow: 'pipeline',
          step: 'draft',
          appId,
          conversationId,
          memoriesFound: memories.length,
          topScore: memories[0]?.score ?? 0,
          memoryIds: memories.map((m) => m.id),
        })

        // Record citation for feedback tracking
        if (runId) {
          const memoryIds = memories.map((m) => m.id)
          await citeMemories(memoryIds, runId, appId).catch((err) => {
            log('warn', 'draft failed to record memory citations', {
              workflow: 'pipeline',
              step: 'draft',
              appId,
              error: err instanceof Error ? err.message : String(err),
            }).catch(() => {})
          })
        }
      }
    } catch (error) {
      // Memory query failed, continue without memory context
      await log('warn', 'draft memory query failed', {
        workflow: 'pipeline',
        step: 'draft',
        appId,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Generate with LLM or Agent (with memory context if available)
  // ─────────────────────────────────────────────────────────────────────────

  const { useAgentMode = false, customerEmail, customerName } = options

  // Build prompt — check runtime overrides first, then use dynamic
  // context-aware prompts that inject refund policy, invoice URLs,
  // promotions, license info, etc.
  const categoryPrompt =
    PROMPT_OVERRIDES[classification.category] ||
    buildCategoryPrompt(classification.category, context)
  const systemPrompt = promptOverride || categoryPrompt

  // Format context
  const contextSection = formatContextForPrompt(context)

  // Build user message with optional memory context
  const userMessage = `${contextSection}
${memoryContext ? `\n${memoryContext}\n` : ''}
## Customer Message
Subject: ${message.subject}

${message.body}

---
Write your response:`

  // ─────────────────────────────────────────────────────────────────────────
  // Agent mode: Use runSupportAgent with tools (for HITL approval flow)
  // ─────────────────────────────────────────────────────────────────────────
  if (useAgentMode && appId) {
    const { runSupportAgent } = await import('../../agent/config')

    await log('debug', 'draft using agent mode', {
      workflow: 'pipeline',
      step: 'draft',
      appId,
      conversationId,
      category: classification.category,
    })

    // Build customer context for the agent
    const customerContext: {
      email?: string
      name?: string
      purchases?: Array<{ id: string; product: string; date: string }>
    } = {}

    if (customerEmail || context.user?.email) {
      customerContext.email = customerEmail ?? context.user?.email
    }
    if (customerName || context.user?.name) {
      customerContext.name = customerName ?? context.user?.name
    }
    if (context.purchases.length > 0) {
      customerContext.purchases = context.purchases.map((p) => ({
        id: p.id,
        product: p.productName,
        date: p.purchasedAt,
      }))
    }

    // Run the support agent with tools
    const agentResult = await runSupportAgent({
      message: userMessage,
      conversationHistory: [],
      customerContext,
      appId,
      model: model as
        | 'anthropic/claude-haiku-4-5'
        | 'anthropic/claude-sonnet-4-5'
        | 'anthropic/claude-opus-4-5',
      priorKnowledge: memoryContext || undefined,
    })

    const toolsUsed = memories.length > 0 ? ['memory_query'] : []
    // Add tool names from agent result
    if (agentResult.toolCalls.length > 0) {
      toolsUsed.push(...agentResult.toolCalls.map((tc) => tc.name))
    }

    const durationMs = Date.now() - startTime

    // High-cardinality decision-point logging for agent mode
    await log('info', 'draft:decision', {
      workflow: 'pipeline',
      step: 'draft',
      appId,
      conversationId,
      // Decision outcome
      category: classification.category,
      decisionPath: 'agent',
      // Draft result
      draftLength: agentResult.response.trim().length,
      // Agent mode details
      toolCallCount: agentResult.toolCalls.length,
      toolsInvoked: agentResult.toolCalls.map((tc) => tc.name),
      requiresApproval: agentResult.requiresApproval,
      autoSent: agentResult.autoSent,
      hasReasoning: !!agentResult.reasoning,
      // Memory context
      usedMemory: memories.length > 0,
      memoriesCited: memories.length,
      citedMemoryIds: memories.map((m) => m.id),
      topMemoryScore: memories[0]?.score,
      // Decision inputs
      hasContext: !!context,
      hasUser: !!context.user,
      hasPurchases: context.purchases.length > 0,
      hasKnowledge: context.knowledge.length > 0,
      hasCustomerEmail: !!customerEmail,
      hasCustomerName: !!customerName,
      // Why this path
      usedTemplate: false,
      usedLLM: true,
      usedAgentMode: true,
      model,
      durationMs,
    })

    return {
      draft: agentResult.response.trim(),
      reasoning:
        agentResult.reasoning ??
        (memories.length > 0
          ? `Used ${memories.length} relevant memories for context`
          : undefined),
      toolsUsed,
      durationMs,
      templateUsed: undefined,
      memoriesCited: memories.length > 0 ? memories : undefined,
      // New fields for HITL approval
      toolCalls:
        agentResult.toolCalls.length > 0
          ? agentResult.toolCalls.map((tc) => ({
              name: tc.name,
              args: tc.args,
              result: tc.result,
            }))
          : undefined,
      requiresApproval: agentResult.requiresApproval,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Standard mode: Raw LLM generation (no tools)
  // ─────────────────────────────────────────────────────────────────────────

  // Generate
  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const toolsUsed = memories.length > 0 ? ['memory_query'] : []
  const durationMs = Date.now() - startTime

  // High-cardinality decision-point logging for LLM mode
  await log('info', 'draft:decision', {
    workflow: 'pipeline',
    step: 'draft',
    appId,
    conversationId,
    // Decision outcome
    category: classification.category,
    decisionPath: 'llm',
    // Draft result
    draftLength: result.text.trim().length,
    // Memory context
    usedMemory: memories.length > 0,
    memoriesCited: memories.length,
    citedMemoryIds: memories.map((m) => m.id),
    topMemoryScore: memories[0]?.score,
    // Decision inputs
    hasContext: !!context,
    hasUser: !!context.user,
    hasPurchases: context.purchases.length > 0,
    hasKnowledge: context.knowledge.length > 0,
    hasPromptOverride: !!promptOverride,
    // Why this path (not template, not agent)
    templateSkipped: skipTemplateMatch,
    templateNotMatched: !skipTemplateMatch,
    agentModeDisabled: !useAgentMode,
    usedTemplate: false,
    usedLLM: true,
    usedAgentMode: false,
    model,
    durationMs,
  })

  return {
    draft: result.text.trim(),
    reasoning:
      memories.length > 0
        ? `Used ${memories.length} relevant memories for context`
        : undefined,
    toolsUsed,
    durationMs,
    templateUsed: undefined,
    memoriesCited: memories.length > 0 ? memories : undefined,
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the prompt for a category. Returns any runtime override first,
 * then falls back to the dynamic context-aware prompt (with empty context
 * for the static fallback case).
 */
export function getPromptForCategory(category: MessageCategory): string {
  return (
    PROMPT_OVERRIDES[category] ||
    buildCategoryPrompt(category, {
      user: null,
      purchases: [],
      knowledge: [],
      history: [],
      priorMemory: [],
      priorConversations: [],
      gatherErrors: [],
    })
  )
}

/**
 * Override the prompt for a specific category at runtime.
 * Overrides take precedence over dynamic prompts.
 */
export function setPromptForCategory(
  category: MessageCategory,
  prompt: string
): void {
  PROMPT_OVERRIDES[category] = prompt
}

/**
 * Build a situation string for memory query from draft context.
 * This captures the key elements that make situations similar.
 */
function buildDraftSituation(
  category: MessageCategory,
  context: GatherOutput,
  message: { subject: string; body: string }
): string {
  const parts: string[] = []

  // Category is primary signal
  parts.push(`Category: ${category}`)

  // Customer context if available
  if (context.user?.email) {
    parts.push(`Customer: ${context.user.email}`)
  }

  // Purchase context
  if (context.purchases.length > 0) {
    const purchaseInfo = context.purchases
      .slice(0, 2)
      .map((p) => p.productName)
      .join(', ')
    parts.push(`Products: ${purchaseInfo}`)
  }

  // Message summary (truncated)
  const messagePreview = `${message.subject} ${message.body}`.slice(0, 200)
  parts.push(`Issue: ${messagePreview}`)

  return parts.join('\n')
}

// ============================================================================
// Draft Correction Storage
// ============================================================================

export interface StoreDraftCorrectionInput {
  /** App identifier */
  appId: string
  /** Original draft generated by the agent */
  originalDraft: string
  /** Final draft after human editing */
  finalDraft: string
  /** Category of the support request */
  category: MessageCategory
  /** Conversation ID for tracking */
  conversationId: string
  /** Brief context summary (from gather step) */
  contextSummary: string
  /** Run ID for linking to cited memories */
  runId?: string
  /** Memory IDs that were cited in the original draft */
  citedMemoryIds?: string[]
}

/**
 * Store a draft correction when a human edits an agent-generated draft.
 *
 * This creates a memory for future reference:
 * - Stores what was drafted vs what was actually sent
 * - Marks outcome as 'corrected' so future drafts can learn
 * - Updates cited memories' success rate (if tracking enabled)
 *
 * Call this from webhook/event handlers when:
 * - Agent drafts a response
 * - Human edits it before sending
 * - The edited version is meaningfully different
 *
 * @example
 * ```typescript
 * // When human edits and sends
 * if (isDifferent(agentDraft, finalMessage)) {
 *   await storeDraftCorrection({
 *     appId: 'total-typescript',
 *     originalDraft: agentDraft,
 *     finalDraft: finalMessage,
 *     category: 'support_refund',
 *     conversationId: '123',
 *     contextSummary: 'Customer requested refund after 60 days',
 *   })
 * }
 * ```
 */
export async function storeDraftCorrection(
  input: StoreDraftCorrectionInput
): Promise<void> {
  const { SupportMemoryService } = await import(
    '@skillrecordings/memory/support-memory'
  )

  const {
    appId,
    originalDraft,
    finalDraft,
    category,
    conversationId,
    contextSummary,
    runId,
    citedMemoryIds,
  } = input

  // Store the correction as a memory
  await SupportMemoryService.store({
    app_slug: appId,
    situation: `Category: ${category}\nContext: ${contextSummary}`,
    decision: `Draft: ${originalDraft}`,
    stage: 'draft',
    outcome: 'corrected',
    correction: `Edited to: ${finalDraft}`,
    category,
    conversation_id: conversationId,
  })

  // If we have cited memory IDs, record that those memories led to a correction
  if (runId && citedMemoryIds && citedMemoryIds.length > 0) {
    try {
      const { recordCitationOutcome } = await import('../../memory/query')
      await recordCitationOutcome(citedMemoryIds, runId, 'failure', appId)
    } catch (error) {
      console.warn(
        '[storeDraftCorrection] Failed to record citation outcomes:',
        error
      )
    }
  }
}

/**
 * Store a successful draft (human approved without edits).
 *
 * Call this when a human sends an agent-drafted response without changes.
 * This reinforces the memory and updates cited memories' success rate.
 *
 * @example
 * ```typescript
 * // When human sends without edits
 * if (!isDifferent(agentDraft, finalMessage)) {
 *   await storeDraftSuccess({
 *     appId: 'total-typescript',
 *     draft: agentDraft,
 *     category: 'support_access',
 *     conversationId: '123',
 *     contextSummary: 'Customer couldn't log in',
 *   })
 * }
 * ```
 */
export async function storeDraftSuccess(input: {
  appId: string
  draft: string
  category: MessageCategory
  conversationId: string
  contextSummary: string
  runId?: string
  citedMemoryIds?: string[]
}): Promise<void> {
  const { SupportMemoryService } = await import(
    '@skillrecordings/memory/support-memory'
  )

  const {
    appId,
    draft,
    category,
    conversationId,
    contextSummary,
    runId,
    citedMemoryIds,
  } = input

  // Store the successful decision
  await SupportMemoryService.store({
    app_slug: appId,
    situation: `Category: ${category}\nContext: ${contextSummary}`,
    decision: `Draft: ${draft}`,
    stage: 'draft',
    outcome: 'success',
    category,
    conversation_id: conversationId,
  })

  // Record success for cited memories
  if (runId && citedMemoryIds && citedMemoryIds.length > 0) {
    try {
      const { recordCitationOutcome } = await import('../../memory/query')
      await recordCitationOutcome(citedMemoryIds, runId, 'success', appId)
    } catch (error) {
      console.warn(
        '[storeDraftSuccess] Failed to record citation outcomes:',
        error
      )
    }
  }
}
