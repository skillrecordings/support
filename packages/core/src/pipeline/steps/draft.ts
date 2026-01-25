/**
 * Step 4: DRAFT
 *
 * Generates response using gathered context.
 * Before LLM generation, checks for high-confidence template matches.
 *
 * Flow:
 * 1. Check for template match (>threshold confidence)
 * 2. If match: Use template with variable interpolation
 * 3. If no match: Generate fresh response with LLM
 */

import { generateText } from 'ai'
import {
  type TemplateMatch,
  buildTemplateVariables,
  createTemplateUsageLog,
  interpolateTemplate,
  logTemplateUsage,
  matchTemplate,
} from '../../templates/match'
import type { DraftInput, DraftOutput, MessageCategory } from '../types'
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
}

export interface DraftResult extends DraftOutput {
  /** Template used if matched, undefined if LLM generated */
  templateUsed?: TemplateMatch
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
  } = options
  const { message, classification, context } = input

  const startTime = Date.now()

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

        return {
          draft: interpolatedContent,
          reasoning: `Template match: "${matchResult.match.name}" (confidence: ${matchResult.match.confidence.toFixed(3)})`,
          toolsUsed: ['template_match'],
          durationMs: Date.now() - startTime,
          templateUsed: matchResult.match,
        }
      }

      // Log that we're falling back to LLM
      logTemplateUsage(
        createTemplateUsageLog(appId, classification.category, null)
      )
    } catch (error) {
      // Template matching failed, fall back to LLM silently
      console.warn('[draft] Template matching failed, using LLM:', error)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: No template match, generate with LLM
  // ─────────────────────────────────────────────────────────────────────────

  // Build prompt
  const categoryPrompt =
    CATEGORY_PROMPTS[classification.category] || BASE_DRAFT_PROMPT
  const systemPrompt = promptOverride || categoryPrompt

  // Format context
  const contextSection = formatContextForPrompt(context)

  // Build user message
  const userMessage = `${contextSection}

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

  return {
    draft: result.text.trim(),
    reasoning: undefined,
    toolsUsed: [],
    durationMs: Date.now() - startTime,
    templateUsed: undefined,
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
