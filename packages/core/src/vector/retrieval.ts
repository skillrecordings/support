import { queryVectors } from './client'
import { redactPII } from './redact'
import type { VectorDocument, VectorQueryResult } from './types'

/**
 * Options for building agent context from vector search
 */
export interface BuildAgentContextOptions {
  /** App ID to filter results */
  appId: string
  /** Search query text */
  query: string
  /** Optional conversation history for context */
  conversationHistory?: string[]
  /** Customer email to redact from query */
  customerEmail?: string
  /** Maximum number of results to return (default: 20) */
  limit?: number
}

/**
 * Agent context retrieved from vector search
 */
export interface AgentContext {
  /** Similar past conversations */
  similarTickets: VectorDocument[]
  /** Relevant knowledge base articles */
  knowledge: VectorDocument[]
  /** Good response templates */
  goodResponses: VectorDocument[]
}

/**
 * Build agent context by querying vector store for relevant documents.
 *
 * Performs hybrid search with:
 * - PII redaction before querying
 * - Filtering by appId
 * - Separation by document type (conversation | knowledge | response)
 *
 * @param options - Query options including appId, query text, and optional filters
 * @returns AgentContext with categorized results
 *
 * @example
 * ```ts
 * const context = await buildAgentContext({
 *   appId: 'totaltypescript',
 *   query: 'Customer wants refund for course',
 *   customerEmail: '[EMAIL]',
 *   limit: 10
 * })
 *
 * console.log(context.similarTickets.length) // Past refund tickets
 * console.log(context.knowledge.length)      // Refund policy docs
 * console.log(context.goodResponses.length)  // Canned responses
 * ```
 */
export async function buildAgentContext(
  options: BuildAgentContextOptions
): Promise<AgentContext> {
  const { appId, query, customerEmail, limit = 20 } = options

  // Extract known names from customer email for redaction
  const knownNames: string[] = []
  if (customerEmail) {
    const emailPrefix = customerEmail.split('@')[0]
    if (emailPrefix) {
      knownNames.push(emailPrefix)
    }
  }

  // Redact PII from query before searching
  const redactedQuery = redactPII(query, knownNames)

  // Query vectors with hybrid search
  const results = await queryVectors({
    data: redactedQuery,
    topK: limit,
    includeMetadata: true,
    includeData: true,
    filter: `appId = "${appId}"`,
  })

  // Convert VectorQueryResult to VectorDocument and separate by type
  const similarTickets: VectorDocument[] = []
  const knowledge: VectorDocument[] = []
  const goodResponses: VectorDocument[] = []

  for (const result of results) {
    // Skip results without metadata or data
    if (!result.metadata || !result.data) {
      continue
    }

    const doc: VectorDocument = {
      id: result.id,
      data: result.data,
      metadata: result.metadata,
    }

    switch (result.metadata.type) {
      case 'conversation':
        similarTickets.push(doc)
        break
      case 'knowledge':
        knowledge.push(doc)
        break
      case 'response':
        goodResponses.push(doc)
        break
    }
  }

  return {
    similarTickets,
    knowledge,
    goodResponses,
  }
}
