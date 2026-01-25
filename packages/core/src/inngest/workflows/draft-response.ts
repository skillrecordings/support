/**
 * Draft Response Workflow
 *
 * Generates a draft response using the gathered context.
 * Listens for context.gathered events and emits draft.created.
 *
 * Part of the eval pipeline refactor - replacing monolithic runSupportAgent
 * with composable, testable steps.
 */

import {
  initializeAxiom,
  traceWorkflowStep,
} from '../../observability/axiom'
import { draft } from '../../pipeline/steps/draft'
import type {
  ClassifyOutput,
  DraftInput,
  GatherOutput,
  MessageCategory,
} from '../../pipeline/types'
import { inngest } from '../client'
import { SUPPORT_CONTEXT_GATHERED, SUPPORT_DRAFT_CREATED } from '../events'

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

    const workflowStartTime = Date.now()
    initializeAxiom()

    console.log('[draft-workflow] ========== STARTED ==========')
    console.log('[draft-workflow] conversationId:', conversationId)
    console.log('[draft-workflow] messageId:', messageId)
    console.log('[draft-workflow] appId:', appId)
    console.log('[draft-workflow] category:', classification.category)
    console.log('[draft-workflow] hasCustomer:', !!context.customer)
    console.log('[draft-workflow] knowledgeCount:', context.knowledge?.length ?? 0)
    console.log('[draft-workflow] memoryCount:', context.memories?.length ?? 0)

    // Generate draft response
    const draftResult = await step.run('draft-response', async () => {
      const stepStartTime = Date.now()

      // Map event data to DraftInput structure
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
              id: context.customer.email,
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
        history: [],
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

      const draftInput: DraftInput = {
        message: {
          subject: '',
          body: '',
          from: context.customer?.email,
          conversationId,
          appId,
        },
        classification: classifyOutput,
        context: gatherOutput,
      }

      const result = await draft(draftInput)
      const durationMs = Date.now() - stepStartTime

      // Trace draft creation to Axiom with high cardinality

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
        },
      })

      console.log('[draft-workflow] draft generated:', {
        draftLength: result.draft.length,
        toolsUsed: result.toolsUsed,
        durationMs,
      })

      return result
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

    const totalDurationMs = Date.now() - workflowStartTime
    console.log('[draft-workflow] ========== COMPLETED ==========')
    console.log('[draft-workflow] totalDurationMs:', totalDurationMs)
    console.log('[draft-workflow] draftLength:', draftResult.draft.length)

    return {
      conversationId,
      messageId,
      draft: draftResult,
    }
  }
)
