/**
 * Draft Response Workflow
 *
 * Generates a draft response using the gathered context.
 * Uses LLM to create response based on classification and context.
 */

import {
  initializeAxiom,
  log,
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
    retries: 1,
  },
  { event: SUPPORT_CONTEXT_GATHERED },
  async ({ event, step }) => {
    const { conversationId, messageId, appId, classification, route, context } =
      event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'draft workflow started', {
      workflow: 'support-draft',
      conversationId,
      messageId,
      appId,
      category: classification.category,
      hasCustomer: !!context.customer,
      knowledgeCount: context.knowledge?.length ?? 0,
      memoryCount: context.memories?.length ?? 0,
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

    await log('debug', 'emitting draft created event', {
      workflow: 'support-draft',
      conversationId,
      messageId,
      draftLength: draftResult.draft.length,
    })

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

    await log('info', 'draft workflow completed', {
      workflow: 'support-draft',
      conversationId,
      messageId,
      appId,
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
