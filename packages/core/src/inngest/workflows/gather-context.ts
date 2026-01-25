/**
 * Gather Context Workflow
 *
 * Collects all context needed for drafting a response:
 * - Customer data from app integration
 * - Knowledge from vector search
 * - Relevant memories
 * - Conversation history
 */

import { MemoryService } from '@skillrecordings/memory/memory'
import { IntegrationClient } from '@skillrecordings/sdk/client'
import { type FrontMessage, createFrontClient } from '../../front/client'
import {
  initializeAxiom,
  log,
  traceMemoryRetrieval,
  traceWorkflowStep,
} from '../../observability/axiom'
import {
  assertDataIntegrity,
  buildDataFlowCheck,
} from '../../pipeline/assert-data-integrity'
import { type GatherTools, gather } from '../../pipeline/steps/gather'
import type { KnowledgeItem, MemoryItem } from '../../pipeline/types'
import { getApp } from '../../services/app-registry'
import { inngest } from '../client'
import { SUPPORT_CONTEXT_GATHERED, SUPPORT_ROUTED } from '../events'

async function createGatherTools(appId: string): Promise<GatherTools> {
  const app = await getApp(appId)

  return {
    lookupUser: app
      ? async (email: string, appId: string) => {
          const client = new IntegrationClient({
            baseUrl: app.integration_base_url,
            webhookSecret: app.webhook_secret,
          })

          try {
            await log('debug', 'looking up user', {
              workflow: 'support-gather',
              tool: 'lookupUser',
              email,
              appId,
            })

            const user = await client.lookupUser(email)
            if (!user) {
              await log('debug', 'user not found', {
                workflow: 'support-gather',
                tool: 'lookupUser',
                email,
                appId,
              })
              return { user: null, purchases: [] }
            }

            const purchases = await client.getPurchases(user.id)

            await log('info', 'user lookup complete', {
              workflow: 'support-gather',
              tool: 'lookupUser',
              email,
              appId,
              userId: user.id,
              purchaseCount: purchases.length,
            })

            return {
              user: {
                id: user.id,
                email: user.email,
                name: user.name ?? undefined,
              },
              purchases: purchases.map((p) => ({
                id: p.id,
                productId: p.productId,
                productName: p.productName,
                purchasedAt:
                  p.purchasedAt instanceof Date
                    ? p.purchasedAt.toISOString()
                    : String(p.purchasedAt),
                amount: p.amount,
                status: p.status as 'active' | 'refunded' | 'transferred',
              })),
            }
          } catch (error) {
            await log('error', 'user lookup failed', {
              workflow: 'support-gather',
              tool: 'lookupUser',
              email,
              appId,
              error: error instanceof Error ? error.message : String(error),
            })
            return { user: null, purchases: [] }
          }
        }
      : undefined,

    searchKnowledge: async (
      query: string,
      appId: string
    ): Promise<KnowledgeItem[]> => {
      await log('debug', 'searching knowledge (not implemented)', {
        workflow: 'support-gather',
        tool: 'searchKnowledge',
        queryLength: query.length,
        appId,
      })
      return []
    },

    getHistory: async (conversationId: string) => {
      const frontToken = process.env.FRONT_API_TOKEN
      if (!frontToken) {
        await log('warn', 'FRONT_API_TOKEN not set, skipping history', {
          workflow: 'support-gather',
          tool: 'getHistory',
          conversationId,
        })
        return []
      }

      try {
        await log('debug', 'fetching conversation history', {
          workflow: 'support-gather',
          tool: 'getHistory',
          conversationId,
        })

        const front = createFrontClient(frontToken)
        const messages = await front.getConversationMessages(conversationId)

        await log('info', 'conversation history fetched', {
          workflow: 'support-gather',
          tool: 'getHistory',
          conversationId,
          messageCount: messages.length,
        })

        return messages.map((msg: FrontMessage) => ({
          direction: msg.is_inbound ? ('in' as const) : ('out' as const),
          body: msg.body || '',
          timestamp: msg.created_at,
          author: msg.author?.email,
        }))
      } catch (error) {
        await log('error', 'conversation history fetch failed', {
          workflow: 'support-gather',
          tool: 'getHistory',
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        })
        return []
      }
    },

    searchMemory: async (query: string): Promise<MemoryItem[]> => {
      try {
        await log('debug', 'searching memories', {
          workflow: 'support-gather',
          tool: 'searchMemory',
          queryLength: query.length,
          appId,
        })

        const results = await MemoryService.find(query, {
          collection: 'support',
          limit: 5,
          threshold: 0.4,
          app_slug: appId,
        })

        await log('info', 'memory search complete', {
          workflow: 'support-gather',
          tool: 'searchMemory',
          appId,
          memoriesFound: results.length,
          topScore: results[0]?.score ?? 0,
        })

        return results.map((r) => ({
          id: r.memory.id,
          content: r.memory.content,
          tags: (r.memory.metadata as { tags?: string[] }).tags || [],
          relevance: r.score,
        }))
      } catch (error) {
        await log('error', 'memory search failed', {
          workflow: 'support-gather',
          tool: 'searchMemory',
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
        return []
      }
    },
  }
}

export const gatherWorkflow = inngest.createFunction(
  {
    id: 'support-gather',
    name: 'Gather Context for Response',
    retries: 2,
  },
  {
    event: SUPPORT_ROUTED,
    if: 'event.data.route.action == "respond"',
  },
  async ({ event, step }) => {
    const {
      conversationId,
      messageId,
      appId,
      subject,
      body,
      senderEmail,
      classification,
      route,
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'gather workflow started', {
      workflow: 'support-gather',
      conversationId,
      messageId,
      appId,
      senderEmail,
      category: classification.category,
      ...buildDataFlowCheck('support-gather', 'receiving', {
        subject,
        body,
        category: classification.category,
        confidence: classification.confidence,
        signals: classification.signals,
      }),
    })

    // Assert critical data from upstream (route workflow)
    await assertDataIntegrity('gather-context/receive', {
      body,
      subject,
    })

    const context = await step.run('gather-context', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'creating gather tools', {
        workflow: 'support-gather',
        step: 'gather-context',
        appId,
      })

      const tools = await createGatherTools(appId)

      await log('debug', 'running gather step', {
        workflow: 'support-gather',
        step: 'gather-context',
        conversationId,
        hasUserLookup: !!tools.lookupUser,
      })

      const result = await gather(
        {
          message: {
            subject,
            body,
            from: senderEmail,
            conversationId,
            appId,
          },
          classification: {
            category: classification.category as import(
              '../../pipeline/types'
            ).MessageCategory,
            confidence: classification.confidence,
            signals: classification.signals as unknown as import(
              '../../pipeline/types'
            ).MessageSignals,
          },
          appId,
        },
        { tools, timeout: 10000 }
      )

      const durationMs = Date.now() - stepStartTime

      // Log email resolution decision
      if (result.emailResolution) {
        await log('debug', 'customer email determined', {
          workflow: 'support-gather',
          step: 'gather-context',
          conversationId,
          senderEmail: result.emailResolution.senderEmail,
          bodyExtractedEmail: result.emailResolution.bodyExtractedEmail,
          resolvedEmail: result.emailResolution.email,
          emailSource: result.emailResolution.source,
          usedFallback: result.emailResolution.source === 'body',
        })
      }

      await log('info', 'context gathered', {
        workflow: 'support-gather',
        step: 'gather-context',
        conversationId,
        appId,
        hasUser: !!result.user,
        purchaseCount: result.purchases.length,
        knowledgeCount: result.knowledge.length,
        historyCount: result.history.length,
        memoryCount: result.priorMemory.length,
        errorCount: result.gatherErrors.length,
        errors: result.gatherErrors,
        durationMs,
      })

      if (result.priorMemory.length > 0) {
        await traceMemoryRetrieval({
          conversationId,
          appId,
          queryLength: body?.length ?? 0,
          memoriesFound: result.priorMemory.length,
          topScore: result.priorMemory[0]?.relevance ?? 0,
          durationMs,
        })
      }

      await traceWorkflowStep({
        workflowName: 'support-gather',
        conversationId,
        appId,
        stepName: 'gather',
        durationMs,
        success: result.gatherErrors.length === 0,
        metadata: {
          hasUser: !!result.user,
          purchaseCount: result.purchases.length,
          knowledgeCount: result.knowledge.length,
          historyCount: result.history.length,
          memoryCount: result.priorMemory.length,
          errorCount: result.gatherErrors.length,
        },
      })

      return result
    })

    // Data flow check: log what we're emitting to draft-response
    await log('debug', 'emitting context gathered event', {
      workflow: 'support-gather',
      conversationId,
      messageId,
      ...buildDataFlowCheck('support-gather', 'emitting', {
        subject,
        body,
        history: context.history,
        purchases: context.purchases,
        category: classification.category,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        signals: classification.signals,
      }),
    })

    await step.sendEvent('emit-context-gathered', {
      name: SUPPORT_CONTEXT_GATHERED,
      data: {
        conversationId,
        messageId,
        appId,
        subject,
        body,
        senderEmail,
        classification: {
          category: classification.category,
          confidence: classification.confidence,
          signals: classification.signals,
          reasoning: classification.reasoning,
        },
        route: {
          action: route.action,
          reason: route.reason,
        },
        context: {
          customer: context.user
            ? { email: context.user.email, purchases: context.purchases }
            : null,
          knowledge: context.knowledge,
          memories: context.priorMemory,
          history: context.history.map((h) => ({
            body: h.body,
            from: h.author ?? (h.direction === 'in' ? senderEmail : 'agent'),
            date:
              typeof h.timestamp === 'number'
                ? String(h.timestamp)
                : String(h.timestamp ?? ''),
          })),
        },
      },
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'gather workflow completed', {
      workflow: 'support-gather',
      conversationId,
      messageId,
      appId,
      hasUser: !!context.user,
      purchaseCount: context.purchases.length,
      memoryCount: context.priorMemory.length,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-gather',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        hasUser: !!context.user,
        purchaseCount: context.purchases.length,
        knowledgeCount: context.knowledge.length,
        historyCount: context.history.length,
        memoryCount: context.priorMemory.length,
      },
    })

    return {
      conversationId,
      messageId,
      context: {
        hasUser: !!context.user,
        purchaseCount: context.purchases.length,
        knowledgeCount: context.knowledge.length,
        historyCount: context.history.length,
        memoryCount: context.priorMemory.length,
      },
    }
  }
)
