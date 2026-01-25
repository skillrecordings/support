/**
 * Real tool implementations for eval-pipeline CLI
 *
 * Unlike mock tools, these actually hit Docker MySQL and Qdrant
 * for production-like eval behavior.
 */

import {
  type OllamaClient,
  createOllamaClient,
} from '@skillrecordings/core/adapters/ollama'
import {
  type QdrantClient,
  createQdrantClient,
} from '@skillrecordings/core/adapters/qdrant'
import { tool } from 'ai'
import type { Pool } from 'mysql2/promise'
import { createPool } from 'mysql2/promise'
import { z } from 'zod'

let mysqlPool: Pool | null = null
let qdrantClient: QdrantClient | null = null
let ollamaClient: OllamaClient | null = null

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
  ollama?: {
    url: string
    model: string
  }
}

const DEFAULT_CONFIG: RealToolsConfig = {
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'eval_user',
    password: process.env.MYSQL_PASSWORD || 'eval_pass',
    database: process.env.MYSQL_DATABASE || 'support_eval',
  },
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    collection: process.env.QDRANT_COLLECTION || 'support_eval',
  },
  ollama: {
    url: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
  },
}

/**
 * Initialize connections to Docker services
 */
export async function initRealTools(
  config: RealToolsConfig = DEFAULT_CONFIG,
  verbose = false
): Promise<{ mysql: boolean; qdrant: boolean; ollama: boolean }> {
  const status = { mysql: false, qdrant: false, ollama: false }

  // MySQL
  if (config.mysql) {
    try {
      mysqlPool = createPool({
        ...config.mysql,
        waitForConnections: true,
        connectionLimit: 5,
      })
      const conn = await mysqlPool.getConnection()
      await conn.ping()
      conn.release()
      status.mysql = true
      if (verbose) console.log('  ✅ MySQL connected')
    } catch (error) {
      if (verbose)
        console.log(
          `  ❌ MySQL: ${error instanceof Error ? error.message : 'failed'}`
        )
    }
  }

  // Qdrant
  if (config.qdrant) {
    try {
      qdrantClient = createQdrantClient()
      const info = await qdrantClient.getCollectionInfo()
      status.qdrant = info.status !== 'not_found'
      if (verbose)
        console.log(`  ✅ Qdrant connected (${info.pointsCount} points)`)
    } catch (error) {
      if (verbose)
        console.log(
          `  ❌ Qdrant: ${error instanceof Error ? error.message : 'failed'}`
        )
    }
  }

  // Ollama (for embeddings)
  if (config.ollama) {
    try {
      ollamaClient = createOllamaClient()
      const healthy = await ollamaClient.healthCheck()
      if (healthy) {
        const available = await ollamaClient.isModelAvailable()
        if (available) {
          status.ollama = true
          if (verbose) console.log('  ✅ Ollama connected')
        } else {
          if (verbose) console.log('  ⚠️ Ollama healthy but model not available')
        }
      }
    } catch (error) {
      if (verbose)
        console.log(
          `  ❌ Ollama: ${error instanceof Error ? error.message : 'failed'}`
        )
    }
  }

  return status
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
  ollamaClient = null
}

/**
 * Get embedding for text using Ollama
 */
async function embed(text: string): Promise<number[]> {
  if (!ollamaClient) {
    throw new Error('Ollama client not initialized')
  }
  return ollamaClient.embed(text)
}

/**
 * Create real tools that query Docker services
 */
export function createRealTools(scenario: {
  appId?: string
  customerEmail?: string
}) {
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
          // Look up customer in conversations table
          const [convRows] = (await mysqlPool.query(
            `SELECT DISTINCT customer_email, customer_name 
             FROM SUPPORT_conversations 
             WHERE customer_email = ? AND (app_id = ? OR app_id IS NULL)
             LIMIT 1`,
            [email, queryAppId]
          )) as any[]

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
          console.error('lookupUser error:', error)
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
        if (!qdrantClient || !ollamaClient) {
          return { similarTickets: [], knowledge: [], goodResponses: [] }
        }

        try {
          const queryVector = await embed(query)

          // Search with app filter
          const results = await qdrantClient.search(queryVector, 5, {
            should: [
              { key: 'app', match: { value: queryAppId } },
              { key: 'app', match: { value: 'general' } },
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
              .filter(
                (r) =>
                  r.payload?.type === 'knowledge' ||
                  r.payload?.type === 'general' ||
                  r.payload?.type === 'faq'
              )
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
          console.error('searchKnowledge error:', error)
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
        if (!qdrantClient || !ollamaClient) {
          return { results: [] }
        }

        try {
          const queryVector = await embed(query)
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
        } catch {
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

/**
 * Check if real tools are available
 */
export function isRealToolsAvailable(): boolean {
  return mysqlPool !== null && qdrantClient !== null
}
