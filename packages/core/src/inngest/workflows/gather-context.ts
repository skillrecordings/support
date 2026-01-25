/**
 * Gather Context Workflow
 *
 * Collects all context needed for drafting a response:
 * - Customer data from app integration (MySQL)
 * - Knowledge from vector search
 * - Relevant memories
 * - Conversation history
 *
 * Triggered by: support/inbound.routed (only when route.action === 'respond')
 * Emits: support/context.gathered
 */

import { MemoryService } from '@skillrecordings/memory/memory'
import { IntegrationClient } from '@skillrecordings/sdk/client'
import { type FrontMessage, createFrontClient } from '../../front/client'
import { type GatherTools, gather } from '../../pipeline/steps/gather'
import type { KnowledgeItem, MemoryItem } from '../../pipeline/types'
import { getApp } from '../../services/app-registry'
import { inngest } from '../client'
import { SUPPORT_CONTEXT_GATHERED, SUPPORT_ROUTED } from '../events'

/**
 * Wire up gather tools with real service implementations.
 */
async function createGatherTools(appId: string): Promise<GatherTools> {
  const app = await getApp(appId)

  return {
    /**
     * Lookup user and purchases via app integration endpoint.
     */
    lookupUser: app
      ? async (email: string, appId: string) => {
          const client = new IntegrationClient({
            baseUrl: app.integration_base_url,
            webhookSecret: app.webhook_secret,
          })

          try {
            const user = await client.lookupUser(email)
            if (!user) {
              return { user: null, purchases: [] }
            }

            const purchases = await client.getPurchases(user.id)
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
                // SDK returns Date, pipeline types expect string
                purchasedAt:
                  p.purchasedAt instanceof Date
                    ? p.purchasedAt.toISOString()
                    : String(p.purchasedAt),
                amount: p.amount,
                status: p.status as 'active' | 'refunded' | 'transferred',
              })),
            }
          } catch (error) {
            console.error('[gather] lookupUser error:', error)
            return { user: null, purchases: [] }
          }
        }
      : undefined,

    /**
     * Search knowledge base (not yet implemented - returns empty).
     * TODO: Integrate with Qdrant/Upstash when available.
     */
    searchKnowledge: async (
      _query: string,
      _appId: string
    ): Promise<KnowledgeItem[]> => {
      // Knowledge search not yet implemented
      // Return empty array - gather() handles this gracefully
      return []
    },

    /**
     * Get conversation history from Front API.
     */
    getHistory: async (conversationId: string) => {
      const frontToken = process.env.FRONT_API_TOKEN
      if (!frontToken) {
        console.warn('[gather] FRONT_API_TOKEN not set, skipping history')
        return []
      }

      try {
        const front = createFrontClient(frontToken)
        const messages = await front.getConversationMessages(conversationId)

        return messages.map((msg: FrontMessage) => ({
          direction: msg.is_inbound ? ('in' as const) : ('out' as const),
          body: msg.body || '',
          timestamp: msg.created_at,
          author: msg.author?.email,
        }))
      } catch (error) {
        console.error('[gather] getHistory error:', error)
        return []
      }
    },

    /**
     * Search memories via MemoryService.
     */
    searchMemory: async (query: string): Promise<MemoryItem[]> => {
      try {
        const results = await MemoryService.find(query, {
          collection: 'support',
          limit: 5,
          threshold: 0.4,
          app_slug: appId,
        })

        return results.map((r) => ({
          id: r.memory.id,
          content: r.memory.content,
          tags: r.memory.metadata.tags || [],
          relevance: r.score,
        }))
      } catch (error) {
        console.error('[gather] searchMemory error:', error)
        return []
      }
    },
  }
}

/**
 * Gather context workflow.
 *
 * Listens to routed messages where the action is 'respond' and
 * gathers all context needed for the draft step.
 */
export const gatherWorkflow = inngest.createFunction(
  {
    id: 'support-gather',
    name: 'Gather Context for Response',
    retries: 2,
  },
  {
    event: SUPPORT_ROUTED,
    // Only trigger when route action is 'respond'
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

    console.log('[gather-workflow] Starting context gather', {
      conversationId,
      messageId,
      appId,
      category: classification.category,
    })

    // Gather context from various sources
    const context = await step.run('gather-context', async () => {
      const tools = await createGatherTools(appId)

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

      console.log('[gather-workflow] Context gathered', {
        hasUser: !!result.user,
        purchaseCount: result.purchases.length,
        knowledgeCount: result.knowledge.length,
        historyCount: result.history.length,
        memoryCount: result.priorMemory.length,
        errorCount: result.gatherErrors.length,
      })

      return result
    })

    // Emit context gathered event
    await step.sendEvent('emit-context-gathered', {
      name: SUPPORT_CONTEXT_GATHERED,
      data: {
        conversationId,
        messageId,
        appId,
        classification: {
          category: classification.category,
          confidence: classification.confidence,
        },
        route: {
          action: route.action,
          reason: route.reason,
        },
        context: {
          customer: context.user
            ? {
                email: context.user.email,
                purchases: context.purchases,
              }
            : null,
          knowledge: context.knowledge,
          memories: context.priorMemory,
        },
      },
    })

    console.log('[gather-workflow] Emitted context.gathered event', {
      conversationId,
      messageId,
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
