/**
 * Draft Response Workflow
 *
 * Generates a draft response using the gathered context.
 * Uses LLM to create response based on classification and context.
 */

import { createFrontClient } from '@skillrecordings/front-sdk'
import { generateText } from 'ai'
import { marked } from 'marked'
import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import {
  assertDataIntegrity,
  buildDataFlowCheck,
} from '../../pipeline/assert-data-integrity'
import { draft } from '../../pipeline/steps/draft'
import { BASE_DRAFT_PROMPT } from '../../pipeline/steps/draft-prompts'
import type {
  ClassifyOutput,
  DraftInput,
  GatherOutput,
  MessageCategory,
} from '../../pipeline/types'
import { inngest } from '../client'
import { SUPPORT_CONTEXT_GATHERED, SUPPORT_DRAFT_CREATED } from '../events'

// ============================================================================
// Draft Regeneration with Feedback
// ============================================================================

/**
 * Input for regenerating a draft with human feedback
 */
export interface RegenerateDraftInput {
  /** Current draft content to be edited */
  currentDraft: string
  /** Human feedback/instruction (e.g., "make it shorter", "change X to Y") */
  feedback: string
  /** Original customer context for preservation */
  context: {
    /** Customer's original message subject */
    subject: string
    /** Customer's original message body */
    body: string
    /** Customer's email */
    customerEmail: string
    /** Gathered context from pipeline */
    gatherOutput?: GatherOutput
  }
  /** Front conversation ID for updating the draft */
  conversationId: string
  /** App identifier */
  appId: string
  /** Optional: channel ID for creating new draft */
  channelId?: string
}

/**
 * Output from draft regeneration
 */
export interface RegenerateDraftOutput {
  /** The newly generated draft content */
  newDraft: string
  /** Whether the Front draft was successfully updated */
  frontUpdated: boolean
  /** ID of the new/updated draft in Front */
  draftId?: string
  /** Whether a confirmation comment was added */
  commentAdded: boolean
  /** Duration of the regeneration in ms */
  durationMs: number
}

/**
 * Dependencies that can be injected for testing
 */
export interface RegenerateDraftDeps {
  generateText: typeof generateText
  createFrontClient: typeof createFrontClient
  markdownToHtml: (text: string) => string
}

const defaultDeps: RegenerateDraftDeps = {
  generateText,
  createFrontClient,
  markdownToHtml: (text: string) => marked.parse(text) as string,
}

/**
 * Regenerate a draft incorporating human feedback.
 *
 * This function is called when a teammate comments with an edit instruction
 * (e.g., "make it shorter", "change X to Y", "add a note about the refund policy").
 *
 * Flow:
 * 1. Takes existing draft + edit feedback
 * 2. Preserves original customer context
 * 3. Generates new draft with feedback as system instruction
 * 4. Updates draft in Front (deletes old, creates new)
 * 5. Adds confirmation comment to thread
 *
 * @example
 * ```typescript
 * const result = await regenerateDraftWithFeedback({
 *   currentDraft: "Hello, thanks for reaching out...",
 *   feedback: "make it shorter and more direct",
 *   context: {
 *     subject: "Refund request",
 *     body: "I'd like a refund please",
 *     customerEmail: "customer@example.com",
 *   },
 *   conversationId: "cnv_123",
 *   appId: "total-typescript",
 * })
 * ```
 */
export async function regenerateDraftWithFeedback(
  input: RegenerateDraftInput,
  options: {
    model?: string
    frontApiToken?: string
    skipFrontUpdate?: boolean
    /** Dependency injection for testing */
    deps?: Partial<RegenerateDraftDeps>
  } = {}
): Promise<RegenerateDraftOutput> {
  const { currentDraft, feedback, context, conversationId, appId, channelId } =
    input
  const {
    model = 'anthropic/claude-haiku-4-5',
    frontApiToken = process.env.FRONT_API_KEY,
    skipFrontUpdate = false,
    deps = {},
  } = options

  // Merge with defaults
  const {
    generateText: genText,
    createFrontClient: createFront,
    markdownToHtml,
  } = {
    ...defaultDeps,
    ...deps,
  }

  const startTime = Date.now()

  await log('info', 'regenerate draft started', {
    workflow: 'draft-regeneration',
    conversationId,
    appId,
    feedbackLength: feedback.length,
    currentDraftLength: currentDraft.length,
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Build the regeneration prompt with feedback
  // ─────────────────────────────────────────────────────────────────────────
  const systemPrompt = `${BASE_DRAFT_PROMPT}

## Your Task
You have already written a draft response. A teammate has provided feedback to improve it.
Apply the feedback while preserving the original intent and context.

## Current Draft
${currentDraft}

## Teammate Feedback
${feedback}

## Instructions
- Apply the feedback to improve the draft
- Keep the core message and relevant information
- Maintain the same style guidelines (direct, concise, no corporate speak)
- Output ONLY the new draft text, nothing else`

  // Build context section from original customer message
  let contextSection = `## Original Customer Message
Subject: ${context.subject}

${context.body}`

  // Add gathered context if available
  if (context.gatherOutput) {
    const go = context.gatherOutput
    if (go.user?.email) {
      contextSection += `\n\n## Customer: ${go.user.email}`
    }
    if (go.purchases.length > 0) {
      const purchaseInfo = go.purchases
        .map((p) => `- ${p.productName} (${p.purchasedAt})`)
        .join('\n')
      contextSection += `\n\n## Purchases\n${purchaseInfo}`
    }
    if (go.history.length > 0) {
      const historyInfo = go.history
        .slice(-3) // Last 3 messages for context
        .map((h) => `[${h.direction}] ${h.body.slice(0, 200)}...`)
        .join('\n')
      contextSection += `\n\n## Recent Thread History\n${historyInfo}`
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Generate new draft with LLM
  // ─────────────────────────────────────────────────────────────────────────
  const result = await genText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: contextSection }],
  })

  const newDraft = result.text.trim()

  await log('info', 'regenerate draft LLM complete', {
    workflow: 'draft-regeneration',
    conversationId,
    newDraftLength: newDraft.length,
    model,
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Update draft in Front (if not skipped)
  // ─────────────────────────────────────────────────────────────────────────
  let frontUpdated = false
  let draftId: string | undefined
  let commentAdded = false

  if (!skipFrontUpdate && frontApiToken) {
    try {
      const front = createFront({ apiToken: frontApiToken })

      // List existing drafts on the conversation
      const existingDrafts = await front.drafts.list(conversationId)

      // Delete existing drafts (we'll replace with the new one)
      for (const existingDraft of existingDrafts._results) {
        try {
          await front.drafts.delete(existingDraft.id)
          await log('debug', 'deleted existing draft', {
            workflow: 'draft-regeneration',
            conversationId,
            draftId: existingDraft.id,
          })
        } catch (err) {
          await log('warn', 'failed to delete existing draft', {
            workflow: 'draft-regeneration',
            conversationId,
            draftId: existingDraft.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      // Get channel ID for creating new draft
      let targetChannelId = channelId
      if (!targetChannelId) {
        // Try to get channel from conversation's inbox
        const inboxesResponse = await front.raw.get<{
          _results: Array<{ id: string }>
        }>(`/conversations/${conversationId}/inboxes`)

        if (inboxesResponse._results[0]?.id) {
          const channelsResponse = await front.raw.get<{
            _results: Array<{ id: string }>
          }>(`/inboxes/${inboxesResponse._results[0].id}/channels`)

          targetChannelId = channelsResponse._results[0]?.id
        }
      }

      if (targetChannelId) {
        // Convert markdown to HTML for email drafts
        const htmlBody = markdownToHtml(newDraft)

        // Create new draft
        const newDraftResponse = await front.drafts.createReply(
          conversationId,
          {
            body: htmlBody,
            channel_id: targetChannelId,
            mode: 'shared',
          }
        )

        draftId = newDraftResponse.id
        frontUpdated = true

        await log('info', 'created new draft in Front', {
          workflow: 'draft-regeneration',
          conversationId,
          draftId,
        })
      } else {
        await log('warn', 'no channel found for draft creation', {
          workflow: 'draft-regeneration',
          conversationId,
        })
      }

      // Add confirmation comment
      try {
        await front.conversations.addComment(
          conversationId,
          `🔄 Draft regenerated with feedback: "${feedback.slice(0, 100)}${feedback.length > 100 ? '...' : ''}"`
        )
        commentAdded = true

        await log('debug', 'added confirmation comment', {
          workflow: 'draft-regeneration',
          conversationId,
        })
      } catch (err) {
        await log('warn', 'failed to add confirmation comment', {
          workflow: 'draft-regeneration',
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } catch (err) {
      await log('error', 'failed to update Front', {
        workflow: 'draft-regeneration',
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const durationMs = Date.now() - startTime

  await log('info', 'regenerate draft completed', {
    workflow: 'draft-regeneration',
    conversationId,
    appId,
    newDraftLength: newDraft.length,
    frontUpdated,
    commentAdded,
    durationMs,
  })

  return {
    newDraft,
    frontUpdated,
    draftId,
    commentAdded,
    durationMs,
  }
}

export const draftWorkflow = inngest.createFunction(
  {
    id: 'support-draft',
    name: 'Draft Response',
    retries: 1,
  },
  { event: SUPPORT_CONTEXT_GATHERED },
  async ({ event, step }) => {
    const {
      conversationId,
      messageId,
      appId,
      classification,
      route,
      context,
      inboxId,
      traceId,
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    // Data flow check: log what we received from gather-context
    await log('info', 'draft workflow started', {
      workflow: 'support-draft',
      conversationId,
      messageId,
      appId,
      traceId,
      category: classification.category,
      hasCustomer: !!context.customer,
      knowledgeCount: context.knowledge?.length ?? 0,
      memoryCount: context.memories?.length ?? 0,
      ...buildDataFlowCheck('support-draft', 'receiving', {
        subject: event.data.subject,
        body: event.data.body,
        history: context.history,
        purchases: context.customer?.purchases,
        category: classification.category,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        signals: classification.signals,
      }),
    })

    // Assert critical data before calling LLM
    await assertDataIntegrity('draft-response/receive', {
      body: event.data.body,
    })

    const draftResult = await step.run('draft-response', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'preparing draft input', {
        workflow: 'support-draft',
        step: 'draft-response',
        conversationId,
        category: classification.category,
        purchaseCount: context.customer?.purchases?.length ?? 0,
      })

      const classifyOutput: ClassifyOutput = {
        category: classification.category as MessageCategory,
        confidence: classification.confidence,
        signals: {
          hasEmailInBody: classification.signals?.hasEmailInBody ?? false,
          hasPurchaseDate: classification.signals?.hasPurchaseDate ?? false,
          hasErrorMessage: classification.signals?.hasErrorMessage ?? false,
          isReply: classification.signals?.isReply ?? false,
          mentionsInstructor:
            classification.signals?.mentionsInstructor ?? false,
          hasAngrySentiment: classification.signals?.hasAngrySentiment ?? false,
          isAutomated: classification.signals?.isAutomated ?? false,
          isVendorOutreach: classification.signals?.isVendorOutreach ?? false,
          hasLegalThreat: classification.signals?.hasLegalThreat ?? false,
          hasOutsidePolicyTimeframe:
            classification.signals?.hasOutsidePolicyTimeframe ?? false,
          isPersonalToInstructor:
            classification.signals?.isPersonalToInstructor ?? false,
          isPresalesFaq: classification.signals?.isPresalesFaq ?? false,
          isPresalesTeam: classification.signals?.isPresalesTeam ?? false,
        },
        reasoning: classification.reasoning,
      }

      const gatherOutput: GatherOutput = {
        user: context.customer
          ? {
              id: (context.customer as Record<string, unknown>).id
                ? String((context.customer as Record<string, unknown>).id)
                : context.customer.email,
              email: context.customer.email,
              name: (context.customer as Record<string, unknown>).name
                ? String((context.customer as Record<string, unknown>).name)
                : undefined,
            }
          : null,
        purchases: (context.customer?.purchases ?? []).map((p: unknown) => {
          const purchase = p as Record<string, unknown>
          return {
            id: String(purchase.id ?? ''),
            productId: String(purchase.productId ?? ''),
            productName: String(purchase.productName ?? ''),
            purchasedAt: String(purchase.purchasedAt ?? ''),
            amount: purchase.amount as number | undefined,
            status:
              (purchase.status as 'active' | 'refunded' | 'transferred') ??
              'active',
          }
        }),
        knowledge: (context.knowledge ?? []).map((k: unknown) => {
          const item = k as Record<string, unknown>
          return {
            id: String(item.id ?? ''),
            type:
              (item.type as
                | 'faq'
                | 'article'
                | 'similar_ticket'
                | 'good_response') ?? 'article',
            content: String(item.content ?? ''),
            relevance: (item.relevance as number) ?? 0,
            source: item.source as string | undefined,
          }
        }),
        history: (context.history ?? []).map((h: unknown) => {
          const entry = h as Record<string, unknown>
          const dateVal = entry.date ?? entry.timestamp ?? 0
          // Use preserved direction from gather-context; fall back to
          // email comparison only for history items that predate this fix.
          const dir =
            entry.direction === 'in' || entry.direction === 'out'
              ? entry.direction
              : entry.from === event.data.senderEmail
                ? 'in'
                : 'out'
          return {
            direction: dir as 'in' | 'out',
            body: String(entry.body ?? ''),
            timestamp:
              typeof dateVal === 'number'
                ? dateVal
                : new Date(String(dateVal)).getTime(),
            author: entry.from as string | undefined,
          }
        }),
        priorMemory: (context.memories ?? []).map((m: unknown) => {
          const mem = m as Record<string, unknown>
          return {
            id: String(mem.id ?? ''),
            content: String(mem.content ?? ''),
            tags: (mem.tags as string[]) ?? [],
            relevance: (mem.relevance as number) ?? 0,
          }
        }),
        priorConversations: (
          ((context as Record<string, unknown>).priorConversations as
            | unknown[]
            | undefined) ?? []
        ).map((c: unknown) => {
          const conv = c as Record<string, unknown>
          return {
            conversationId: String(conv.conversationId ?? ''),
            subject: String(conv.subject ?? ''),
            status: String(conv.status ?? ''),
            lastMessageAt: String(conv.lastMessageAt ?? ''),
            messageCount: (conv.messageCount as number) ?? 0,
            tags: (conv.tags as string[]) ?? [],
          }
        }),
        gatherErrors: [],
      }

      const draftInput: DraftInput = {
        message: {
          subject: event.data.subject ?? '',
          body: event.data.body ?? '',
          from: event.data.senderEmail ?? context.customer?.email,
          conversationId,
          appId,
        },
        classification: classifyOutput,
        context: gatherOutput,
      }

      await log('debug', 'calling LLM for draft', {
        workflow: 'support-draft',
        step: 'draft-response',
        conversationId,
        model: 'claude-haiku-4-5',
      })

      const result = await draft(draftInput)
      const durationMs = Date.now() - stepStartTime

      await log('info', 'draft generated', {
        workflow: 'support-draft',
        step: 'draft-response',
        conversationId,
        appId,
        draftLength: result.draft.length,
        toolsUsed: result.toolsUsed,
        draftPreview: result.draft.slice(0, 200),
        durationMs,
      })

      await traceWorkflowStep({
        workflowName: 'support-draft',
        conversationId,
        appId,
        stepName: 'draft',
        durationMs,
        success: true,
        metadata: {
          draftLength: result.draft.length,
          toolsUsed: result.toolsUsed,
          modelUsed: 'claude-haiku-4-5',
          hasKnowledge: (context.knowledge?.length ?? 0) > 0,
          hasMemory: (context.memories?.length ?? 0) > 0,
          hasCustomer: !!context.customer,
          category: classification.category,
        },
      })

      return result
    })

    // Data flow check: log what we're emitting to validate-draft
    await log('debug', 'emitting draft created event', {
      workflow: 'support-draft',
      conversationId,
      messageId,
      draftLength: draftResult.draft.length,
      ...buildDataFlowCheck('support-draft', 'emitting', {
        subject: event.data.subject,
        body: event.data.body,
        category: classification.category,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        draftContent: draftResult.draft,
        signals: classification.signals,
      }),
    })

    await step.sendEvent('emit-draft-created', {
      name: SUPPORT_DRAFT_CREATED,
      data: {
        conversationId,
        messageId,
        appId,
        subject: event.data.subject ?? '',
        body: event.data.body ?? '',
        senderEmail: event.data.senderEmail ?? '',
        classification: {
          category: classification.category,
          confidence: classification.confidence,
          signals: classification.signals ?? {},
          reasoning: classification.reasoning,
        },
        draft: {
          content: draftResult.draft,
          toolsUsed: draftResult.toolsUsed,
        },
        context,
        inboxId,
        traceId,
      },
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'draft workflow completed', {
      workflow: 'support-draft',
      conversationId,
      messageId,
      appId,
      traceId,
      draftLength: draftResult.draft.length,
      toolsUsed: draftResult.toolsUsed,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-draft',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: { draftLength: draftResult.draft.length },
    })

    return { conversationId, messageId, draft: draftResult }
  }
)
