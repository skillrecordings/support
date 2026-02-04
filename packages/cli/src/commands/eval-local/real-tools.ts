/**
 * Real tool implementations that query Docker services
 *
 * Unlike the mock tools, these actually hit MySQL and Qdrant
 * for production-like eval behavior.
 */

import {
  type QdrantClient,
  createQdrantClient,
} from '@skillrecordings/core/adapters/qdrant'
import { tool } from 'ai'
import { type Pool, createPool } from 'mysql2/promise'
import { z } from 'zod'
import { type OutputFormatter } from '../../core/output'

let mysqlPool: Pool | null = null
let qdrantClient: QdrantClient | null = null

export interface RealToolsConfig {
  mysql?: {
    host: string
    port: number
    user: string
    password: string
    database: string
  }
  qdrant?: {
    url: string
    collection: string
  }
  embedFn?: (text: string) => Promise<number[]>
}

const DEFAULT_CONFIG: RealToolsConfig = {
  mysql: {
    host: 'localhost',
    port: 3306,
    user: 'eval_user',
    password: 'eval_pass',
    database: 'support_eval',
  },
  qdrant: {
    url: 'http://localhost:6333',
    collection: 'support_knowledge',
  },
}

/**
 * Initialize connections to Docker services
 */
export async function initRealTools(
  config: RealToolsConfig = DEFAULT_CONFIG
): Promise<void> {
  if (config.mysql) {
    mysqlPool = createPool({
      ...config.mysql,
      waitForConnections: true,
      connectionLimit: 5,
    })
    // Test connection
    const conn = await mysqlPool.getConnection()
    await conn.ping()
    conn.release()
  }

  if (config.qdrant) {
    qdrantClient = createQdrantClient()
  }
}

/**
 * Clean up connections
 */
export async function cleanupRealTools(): Promise<void> {
  if (mysqlPool) {
    await mysqlPool.end()
    mysqlPool = null
  }
  qdrantClient = null
}

/**
 * Create real tools that query Docker services
 */
export function createRealTools(
  scenario: { appId?: string; customerEmail?: string },
  embedFn?: (text: string) => Promise<number[]>,
  output?: OutputFormatter
) {
  const appId = scenario.appId || 'total-typescript'
  const customerEmail = scenario.customerEmail || '[EMAIL]'

  return {
    lookupUser: tool({
      description: 'Look up user by email in the product database',
      inputSchema: z.object({
        email: z.string().describe('Customer email address'),
        appId: z.string().describe('App/product identifier'),
      }),
      execute: async ({ email, appId: queryAppId }) => {
        if (!mysqlPool) {
          return { found: false, error: 'MySQL not connected' }
        }

        try {
          // Look up customer in conversations table (we store customer emails there)
          const [convRows] = (await mysqlPool.query(
            `SELECT DISTINCT customer_email, customer_name 
             FROM SUPPORT_conversations 
             WHERE customer_email = ? AND (app_id = ? OR app_id IS NULL)
             LIMIT 1`,
            [email, queryAppId]
          )) as any[]

          // For eval purposes, also check if there's fixture data
          // In real system this would call the integration client
          if (convRows.length > 0) {
            return {
              found: true,
              user: {
                id: `user_${email.split('@')[0]}`,
                email: convRows[0].customer_email,
                name: convRows[0].customer_name || 'Customer',
              },
              purchases: [
                {
                  id: `purch_${Date.now()}`,
                  product:
                    queryAppId === 'ai-hero'
                      ? 'AI Hero Workshop'
                      : 'Total TypeScript',
                  date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                    .toISOString()
                    .split('T')[0],
                  status: 'active',
                },
              ],
            }
          }

          return {
            found: false,
            user: null,
            purchases: [],
          }
        } catch (error) {
          output?.error(
            `lookupUser error: ${error instanceof Error ? error.message : String(error)}`
          )
          return { found: false, error: String(error) }
        }
      },
    }),

    searchKnowledge: tool({
      description: 'Search the knowledge base for relevant information',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        appId: z.string().describe('App/product identifier'),
      }),
      execute: async ({ query, appId: queryAppId }) => {
        if (!qdrantClient || !embedFn) {
          return { similarTickets: [], knowledge: [], goodResponses: [] }
        }

        try {
          const queryVector = await embedFn(query)

          // Search the knowledge collection using our custom client
          const results = await qdrantClient.search(queryVector, 5, {
            should: [
              { key: 'app_id', match: { value: queryAppId } },
              { key: 'app_id', match: { value: 'general' } },
            ],
          })

          return {
            similarTickets: results
              .filter((r) => r.payload?.type === 'ticket')
              .map((r) => ({
                data: r.payload?.content as string,
                score: r.score,
              })),
            knowledge: results
              .filter((r) => r.payload?.type === 'knowledge')
              .map((r) => ({
                data: r.payload?.content as string,
                score: r.score,
              })),
            goodResponses: results
              .filter((r) => r.payload?.type === 'response')
              .map((r) => ({
                data: r.payload?.content as string,
                score: r.score,
              })),
          }
        } catch (error) {
          output?.error(
            `searchKnowledge error: ${error instanceof Error ? error.message : String(error)}`
          )
          return { similarTickets: [], knowledge: [], goodResponses: [] }
        }
      },
    }),

    searchProductContent: tool({
      description: 'Search product content (courses, tutorials, etc)',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
      }),
      execute: async ({ query }) => {
        if (!qdrantClient || !embedFn) {
          return { results: [] }
        }

        try {
          const queryVector = await embedFn(query)

          // Use our custom Qdrant client - note: this searches the default collection
          // In practice, product content might be in a separate collection
          const results = await qdrantClient.search(queryVector, 3)

          return {
            results: results
              .filter((r) => r.payload?.type === 'content')
              .map((r) => ({
                title: r.payload?.title as string,
                type: (r.payload?.content_type as string) || 'course',
                url: r.payload?.url as string,
              })),
          }
        } catch (error) {
          // Collection might not exist
          return { results: [] }
        }
      },
    }),

    draftResponse: tool({
      description: 'Draft a response to send to the customer',
      inputSchema: z.object({
        body: z.string().describe('The response body to draft'),
      }),
      execute: async ({ body }) => {
        return { drafted: true, body }
      },
    }),

    escalateToHuman: tool({
      description: 'Escalate the conversation to human support',
      inputSchema: z.object({
        reason: z.string().describe('Reason for escalation'),
        urgency: z.enum(['low', 'medium', 'high']).describe('Urgency level'),
      }),
      execute: async ({ reason, urgency }) => {
        return { escalated: true, reason, urgency }
      },
    }),

    assignToInstructor: tool({
      description:
        'Assign conversation to instructor for personal correspondence',
      inputSchema: z.object({
        conversationId: z.string(),
        reason: z.string(),
      }),
      execute: async ({ conversationId, reason }) => ({
        status: 'pending_approval',
        conversationId,
        reason,
        message: 'Instructor assignment submitted for approval',
      }),
    }),

    processRefund: tool({
      description: 'Process a refund for a purchase',
      inputSchema: z.object({
        purchaseId: z.string(),
        appId: z.string(),
        reason: z.string(),
      }),
      execute: async ({ purchaseId, reason }) => ({
        status: 'pending_approval',
        purchaseId,
        reason,
        message: 'Refund submitted for approval',
      }),
    }),

    transferPurchase: tool({
      description: 'Transfer purchase to another email',
      inputSchema: z.object({
        purchaseId: z.string(),
        appId: z.string(),
        fromUserId: z.string(),
        toEmail: z.string(),
        reason: z.string(),
      }),
      execute: async () => ({
        status: 'pending_approval',
        message: 'Transfer submitted for approval',
      }),
    }),

    getPaymentHistory: tool({
      description: 'Get payment history from Stripe',
      inputSchema: z.object({
        customerEmail: z.string(),
        limit: z.number().optional(),
      }),
      execute: async ({ customerEmail: email }) => {
        // In real system, this would call Stripe
        // For eval, return synthetic data based on whether user exists
        if (!mysqlPool) {
          return { charges: [] }
        }

        try {
          const [rows] = (await mysqlPool.query(
            `SELECT 1 FROM SUPPORT_conversations WHERE customer_email = ? LIMIT 1`,
            [email]
          )) as any[]

          if (rows.length > 0) {
            return {
              charges: [
                {
                  id: `ch_eval_${Date.now()}`,
                  amount: 24900,
                  status: 'succeeded',
                  created: Date.now() - 7 * 24 * 60 * 60 * 1000,
                },
              ],
            }
          }

          return { charges: [] }
        } catch {
          return { charges: [] }
        }
      },
    }),

    check_product_availability: tool({
      description: 'Check if product is available or sold out',
      inputSchema: z.object({
        productId: z.string().optional(),
        appId: z.string(),
      }),
      execute: async () => ({
        soldOut: false,
        quantityRemaining: -1,
        enrollmentOpen: true,
      }),
    }),

    memory_search: tool({
      description: 'Search semantic memory',
      inputSchema: z.object({ query: z.string() }),
      execute: async () => ({ results: [], total: 0 }),
    }),

    memory_store: tool({
      description: 'Store learning in memory',
      inputSchema: z.object({
        content: z.string(),
        tags: z.array(z.string()).optional(),
      }),
      execute: async () => ({ stored: true, id: 'mem_eval_1' }),
    }),

    memory_vote: tool({
      description: 'Vote on memory usefulness',
      inputSchema: z.object({
        memoryId: z.string(),
        vote: z.enum(['up', 'down']),
      }),
      execute: async () => ({ success: true }),
    }),

    memory_cite: tool({
      description: 'Cite a memory as used',
      inputSchema: z.object({ memoryId: z.string() }),
      execute: async () => ({ cited: true }),
    }),

    getSubscriptionStatus: tool({
      description: 'Get subscription status',
      inputSchema: z.object({
        customerId: z.string(),
        stripeAccountId: z.string(),
      }),
      execute: async () => ({ subscription: null }),
    }),

    lookupCharge: tool({
      description: 'Look up specific charge',
      inputSchema: z.object({ chargeId: z.string() }),
      execute: async ({ chargeId }) => ({
        charge: {
          id: chargeId,
          amount: 24900,
          status: 'succeeded',
          refunded: false,
        },
      }),
    }),

    verifyRefund: tool({
      description: 'Verify refund status',
      inputSchema: z.object({ refundId: z.string() }),
      execute: async ({ refundId }) => ({
        refund: {
          id: refundId,
          status: 'succeeded',
          amount: 24900,
        },
      }),
    }),
  }
}
