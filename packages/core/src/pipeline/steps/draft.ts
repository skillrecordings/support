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
import { formatContextForPrompt } from './gather'

// ============================================================================
// Draft prompts (per category, can be customized)
// ============================================================================

const BASE_DRAFT_PROMPT = `You are a support agent. Write a helpful response to the customer.

## Style Guide
- Be direct and concise
- No corporate speak
- No enthusiasm performance ("Great!", "Happy to help!")
- Get to the point immediately
- If you need info, just ask - no softening
- 2-3 short paragraphs max

## NEVER Use These Phrases
- "Great!" or exclamatory openers
- "I'd recommend" or "I'd suggest"
- "Let me know if you have any other questions"
- "I hope this helps"
- "Happy to help"
- "I understand" or "I hear you"
- "Thanks for reaching out"
- Em dashes (—)

## If You Don't Have Info
Don't make things up. If knowledge base has no answer:
- Ask a clarifying question
- Or say you'll look into it and follow up

Write your response now. Just the response text, nothing else.`

const CATEGORY_PROMPTS: Partial<Record<MessageCategory, string>> = {
  support_access: `${BASE_DRAFT_PROMPT}

## Access Issues
- First check if we found their purchase
- If no purchase found: ask which email they used to buy
- If purchase found: offer magic link or check their login method
- GitHub login issues: they may have multiple GitHub accounts`,

  support_refund: `${BASE_DRAFT_PROMPT}

## Refund Requests
- If within 30 days: process it, say it's done
- If 30-45 days: say you'll submit for approval
- If over 45 days: explain policy but offer to escalate
- Be matter-of-fact, not apologetic`,

  support_transfer: `${BASE_DRAFT_PROMPT}

## Transfer Requests
- Need: current email, new email, reason
- If we have all info: say you'll process it
- If missing info: ask for what's missing`,

  support_billing: `${BASE_DRAFT_PROMPT}

## Billing/Invoice
- Point them to the invoices page: https://www.totaltypescript.com/invoices
- Invoices are customizable - they can add company/tax info
- PDFs are editable if they need adjustments`,

  support_technical: `${BASE_DRAFT_PROMPT}

## Technical Questions
- Only reference content from the knowledge base
- Don't invent course modules or sections
- If no knowledge found: ask what specific topic they need help with
- Can point to Discord for code questions`,
}

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

        await log('info', 'draft completed (template match)', {
          workflow: 'pipeline',
          step: 'draft',
          appId,
          conversationId,
          category: classification.category,
          usedTemplate: true,
          templateName: matchResult.match.name,
          templateConfidence: matchResult.match.confidence,
          draftLength: interpolatedContent.length,
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
  // Step 3: Generate with LLM (with memory context if available)
  // ─────────────────────────────────────────────────────────────────────────

  // Build prompt
  const categoryPrompt =
    CATEGORY_PROMPTS[classification.category] || BASE_DRAFT_PROMPT
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

  // Generate
  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const toolsUsed = memories.length > 0 ? ['memory_query'] : []
  const durationMs = Date.now() - startTime

  await log('info', 'draft completed (LLM)', {
    workflow: 'pipeline',
    step: 'draft',
    appId,
    conversationId,
    category: classification.category,
    usedTemplate: false,
    usedMemory: memories.length > 0,
    memoriesCited: memories.length,
    draftLength: result.text.trim().length,
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

export function getPromptForCategory(category: MessageCategory): string {
  return CATEGORY_PROMPTS[category] || BASE_DRAFT_PROMPT
}

export function setPromptForCategory(
  category: MessageCategory,
  prompt: string
): void {
  CATEGORY_PROMPTS[category] = prompt
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
