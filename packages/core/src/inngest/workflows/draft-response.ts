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
import {
  assertDataIntegrity,
  buildDataFlowCheck,
} from '../../pipeline/assert-data-integrity'
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
    const {
      conversationId,
      messageId,
      appId,
      classification,
      route,
      context,
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
