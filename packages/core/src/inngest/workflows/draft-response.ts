/**
 * Draft Response Workflow
 *
 * Generates a draft response using the gathered context.
 * Listens for context.gathered events and emits draft.created.
 *
 * Part of the eval pipeline refactor - replacing monolithic runSupportAgent
 * with composable, testable steps.
 */

import { draft } from '../../pipeline/steps/draft'
import type {
  ClassifyOutput,
  DraftInput,
  GatherOutput,
  MessageCategory,
} from '../../pipeline/types'
import { inngest } from '../client'
import { SUPPORT_CONTEXT_GATHERED, SUPPORT_DRAFT_CREATED } from '../events'

/**
 * Draft Response Workflow
 *
 * Takes gathered context and generates a draft response using the LLM.
 * Uses limited retries since LLM calls are expensive.
 */
export const draftWorkflow = inngest.createFunction(
  {
    id: 'support-draft',
    name: 'Draft Response',
    retries: 1, // LLM calls are expensive, limit retries
  },
  { event: SUPPORT_CONTEXT_GATHERED },
  async ({ event, step }) => {
    const { conversationId, messageId, appId, classification, route, context } =
      event.data

    // Generate draft response
    const draftResult = await step.run('draft-response', async () => {
      // Map event data to DraftInput structure
      // The event uses simplified types; we need to adapt to pipeline types
      const classifyOutput: ClassifyOutput = {
        category: classification.category as MessageCategory,
        confidence: classification.confidence,
        signals: {
          hasEmailInBody: false,
          hasPurchaseDate: false,
          hasErrorMessage: false,
          isReply: false,
          mentionsInstructor: false,
          hasAngrySentiment: false,
          isAutomated: false,
          isVendorOutreach: false,
          hasLegalThreat: false,
          hasOutsidePolicyTimeframe: false,
          isPersonalToInstructor: false,
          isPresalesFaq: false,
          isPresalesTeam: false,
        },
        reasoning: undefined,
      }

      // Map context from event to GatherOutput
      const gatherOutput: GatherOutput = {
        user: context.customer
          ? {
              id: context.customer.email, // Use email as ID fallback
              email: context.customer.email,
              name: undefined,
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
        history: [], // Not available in context.gathered event
        priorMemory: (context.memories ?? []).map((m: unknown) => {
          const mem = m as Record<string, unknown>
          return {
            id: String(mem.id ?? ''),
            content: String(mem.content ?? ''),
            tags: (mem.tags as string[]) ?? [],
            relevance: (mem.relevance as number) ?? 0,
          }
        }),
        gatherErrors: [],
      }

      // We need message info for DraftInput - reconstruct from available data
      // Note: The context.gathered event should ideally include the original message
      const draftInput: DraftInput = {
        message: {
          subject: '', // Not available in current event structure
          body: '', // Not available in current event structure
          from: context.customer?.email,
          conversationId,
          appId,
        },
        classification: classifyOutput,
        context: gatherOutput,
      }

      return draft(draftInput)
    })

    // Emit draft created event
    await step.sendEvent('emit-draft-created', {
      name: SUPPORT_DRAFT_CREATED,
      data: {
        conversationId,
        messageId,
        appId,
        draft: {
          content: draftResult.draft,
          toolsUsed: draftResult.toolsUsed,
        },
        context,
      },
    })

    return {
      conversationId,
      messageId,
      draft: draftResult,
    }
  }
)
