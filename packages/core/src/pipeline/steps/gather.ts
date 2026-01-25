/**
 * Step 3: GATHER
 *
 * Collects all context needed for drafting.
 * Only runs if route action = 'respond'.
 */

import type {
  ConversationMessage,
  GatherError,
  GatherInput,
  GatherOutput,
  KnowledgeItem,
  MemoryItem,
  Purchase,
  User,
} from '../types'

// ============================================================================
// Tool interfaces (to be wired to real implementations)
// ============================================================================

export interface GatherTools {
  lookupUser?: (
    email: string,
    appId: string
  ) => Promise<{
    user: User | null
    purchases: Purchase[]
  }>
  searchKnowledge?: (query: string, appId: string) => Promise<KnowledgeItem[]>
  getHistory?: (conversationId: string) => Promise<ConversationMessage[]>
  searchMemory?: (query: string) => Promise<MemoryItem[]>
}

// ============================================================================
// Email extraction
// ============================================================================

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

export function extractEmail(text: string): string | null {
  const matches = text.match(EMAIL_REGEX)
  if (!matches) return null

  // Filter out common non-customer emails
  const filtered = matches.filter((email) => {
    const lower = email.toLowerCase()
    return (
      !lower.includes('noreply') &&
      !lower.includes('no-reply') &&
      !lower.includes('mailer-daemon') &&
      !lower.includes('postmaster') &&
      !lower.includes('@totaltypescript.com') &&
      !lower.includes('@aihero.dev') &&
      !lower.includes('@egghead.io')
    )
  })

  return filtered[0] || null
}

// ============================================================================
// Main gather function
// ============================================================================

export interface GatherOptions {
  tools?: GatherTools
  timeout?: number
}

export async function gather(
  input: GatherInput,
  options: GatherOptions = {}
): Promise<GatherOutput> {
  const { tools = {}, timeout = 5000 } = options
  const { message, classification, appId } = input

  const result: GatherOutput = {
    user: null,
    purchases: [],
    knowledge: [],
    history: [],
    priorMemory: [],
    gatherErrors: [],
  }

  // Extract customer email from message
  const customerEmail = extractEmail(`${message.subject} ${message.body}`)

  // Run all gather operations in parallel with timeout
  const gatherPromises: Promise<void>[] = []

  // Lookup user
  if (tools.lookupUser && customerEmail) {
    gatherPromises.push(
      withTimeout(
        (async () => {
          try {
            const userResult = await tools.lookupUser!(customerEmail, appId)
            result.user = userResult.user
            result.purchases = userResult.purchases
          } catch (error) {
            result.gatherErrors.push({
              step: 'user',
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        })(),
        timeout,
        'user lookup'
      ).catch((err) => {
        result.gatherErrors.push({ step: 'user', error: err.message })
      })
    )
  }

  // Search knowledge
  if (tools.searchKnowledge) {
    const query = `${message.subject} ${message.body}`.slice(0, 500)
    gatherPromises.push(
      withTimeout(
        (async () => {
          try {
            result.knowledge = await tools.searchKnowledge!(query, appId)
          } catch (error) {
            result.gatherErrors.push({
              step: 'knowledge',
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        })(),
        timeout,
        'knowledge search'
      ).catch((err) => {
        result.gatherErrors.push({ step: 'knowledge', error: err.message })
      })
    )
  }

  // Get conversation history
  if (tools.getHistory && message.conversationId) {
    gatherPromises.push(
      withTimeout(
        (async () => {
          try {
            result.history = await tools.getHistory!(message.conversationId!)
          } catch (error) {
            result.gatherErrors.push({
              step: 'history',
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        })(),
        timeout,
        'history fetch'
      ).catch((err) => {
        result.gatherErrors.push({ step: 'history', error: err.message })
      })
    )
  }

  // Search memory
  if (tools.searchMemory) {
    const query = `${classification.category} ${message.subject}`.slice(0, 200)
    gatherPromises.push(
      withTimeout(
        (async () => {
          try {
            result.priorMemory = await tools.searchMemory!(query)
          } catch (error) {
            result.gatherErrors.push({
              step: 'memory',
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        })(),
        timeout,
        'memory search'
      ).catch((err) => {
        result.gatherErrors.push({ step: 'memory', error: err.message })
      })
    )
  }

  // Wait for all to complete
  await Promise.all(gatherPromises)

  return result
}

// ============================================================================
// Helpers
// ============================================================================

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  name: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeoutPromise])
}

/**
 * Format gather output for injection into draft prompt
 * Sanitizes any errors - they become "not found" not "API error"
 */
export function formatContextForPrompt(context: GatherOutput): string {
  const sections: string[] = []

  // User info
  if (context.user) {
    sections.push(`## Customer
- Email: ${context.user.email}
- Name: ${context.user.name || 'Unknown'}`)
  } else {
    sections.push(`## Customer
- No account found for this email`)
  }

  // Purchases
  if (context.purchases.length > 0) {
    const purchaseList = context.purchases
      .map((p) => `- ${p.productName} (${p.purchasedAt}) - ${p.status}`)
      .join('\n')
    sections.push(`## Purchases
${purchaseList}`)
  } else {
    sections.push(`## Purchases
- No purchases found`)
  }

  // Knowledge (if any)
  if (context.knowledge.length > 0) {
    const knowledgeList = context.knowledge
      .slice(0, 3) // Limit to top 3
      .map((k) => `- [${k.type}] ${k.content.slice(0, 200)}...`)
      .join('\n')
    sections.push(`## Relevant Knowledge
${knowledgeList}`)
  }

  // History (if any)
  if (context.history.length > 0) {
    const historyList = context.history
      .slice(-5) // Last 5 messages
      .map(
        (h) =>
          `- [${h.direction === 'in' ? 'Customer' : 'Support'}] ${h.body.slice(0, 100)}...`
      )
      .join('\n')
    sections.push(`## Recent History
${historyList}`)
  }

  // Note: gatherErrors are NEVER included - that's the whole point

  return sections.join('\n\n')
}
