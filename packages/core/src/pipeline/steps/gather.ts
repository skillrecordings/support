/**
 * Step 3: GATHER
 *
 * Collects all context needed for drafting.
 * Only runs if route action = 'respond'.
 *
 * Memory Integration:
 * - Queries past memories to learn what info was missed before
 * - Prioritizes gathering based on past corrections
 * - Stores outcomes when important info is later found to be missing
 */

import { SupportMemoryService } from '@skillrecordings/memory/support-memory'
import {
  type RelevantMemory,
  formatMemoriesCompact,
  queryMemoriesForStage,
} from '../../memory/query'
import { log } from '../../observability/axiom'
import type {
  ConversationMessage,
  GatherError,
  GatherInput,
  GatherOutput,
  KnowledgeItem,
  MemoryItem,
  MessageCategory,
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
// Gather Priority Types (from memory corrections)
// ============================================================================

/**
 * Priority hints extracted from past memory corrections.
 * These tell us what info was missed in similar situations.
 */
export interface GatherPriorities {
  /** Data sources that should definitely be checked */
  mustGather: GatherPriorityItem[]
  /** Additional context that may be helpful */
  mayGather: GatherPriorityItem[]
  /** Relevant memories that informed these priorities */
  sourceMemories: RelevantMemory[]
}

export interface GatherPriorityItem {
  /** What to gather (e.g., "refund_history", "previous_purchases") */
  dataType: string
  /** Why this is important (from correction) */
  reason: string
  /** Confidence based on memory score */
  confidence: number
}

/**
 * Input for storing a gather correction
 */
export interface StoreGatherCorrectionInput {
  /** App identifier */
  appId: string
  /** Category of the support request */
  category: MessageCategory
  /** Summary of the issue */
  summary: string
  /** What was actually gathered */
  gathered: string[]
  /** What should have also been gathered */
  missingInfo: string
  /** Optional conversation ID for tracing */
  conversationId?: string
}

// ============================================================================
// Memory Query Functions
// ============================================================================

/**
 * Query memories relevant to the gather stage to learn what info
 * was missed in similar situations before.
 */
export async function queryGatherMemories(options: {
  appId: string
  category: string
  summary: string
  limit?: number
}): Promise<RelevantMemory[]> {
  const { appId, category, summary, limit = 5 } = options

  try {
    const memories = await queryMemoriesForStage({
      appId,
      stage: 'gather',
      situation: `Category: ${category}\nInitial issue: ${summary}`,
      category,
      limit,
    })
    return memories
  } catch (error) {
    // Don't fail gather if memory query fails
    console.warn('[gather] Memory query failed:', error)
    return []
  }
}

/**
 * Extract gather priorities from past corrections.
 *
 * Analyzes memory corrections to determine what data sources
 * should be prioritized when gathering context for similar issues.
 *
 * @example
 * // If past correction says "Should have also gathered: refund history"
 * // This will return { mustGather: [{ dataType: 'refund_history', ... }] }
 */
export function extractGatherPriorities(
  memories: RelevantMemory[]
): GatherPriorities {
  const mustGather: GatherPriorityItem[] = []
  const mayGather: GatherPriorityItem[] = []

  // Known data types that can be extracted from corrections
  const dataTypePatterns: Record<string, RegExp[]> = {
    refund_history: [/refund\s*history/i, /previous\s*refunds?/i],
    purchase_history: [
      /purchase\s*history/i,
      /previous\s*purchases?/i,
      /all\s*purchases/i,
    ],
    payment_method: [/payment\s*method/i, /card\s*details/i, /billing\s*info/i],
    conversation_history: [/conversation\s*history/i, /previous\s*tickets?/i],
    account_status: [/account\s*status/i, /subscription\s*status/i],
    product_access: [/product\s*access/i, /course\s*access/i, /license/i],
    user_preferences: [/user\s*preferences?/i, /settings/i],
    support_history: [
      /support\s*history/i,
      /previous\s*issues?/i,
      /past\s*tickets?/i,
    ],
    team_membership: [/team\s*membership/i, /organization/i, /team\s*license/i],
  }

  for (const memory of memories) {
    // Only learn from corrected memories
    if (memory.outcome !== 'corrected' || !memory.correction) {
      continue
    }

    const correction = memory.correction.toLowerCase()

    // Try to extract specific data types mentioned in correction
    for (const [dataType, patterns] of Object.entries(dataTypePatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(correction)) {
          const item: GatherPriorityItem = {
            dataType,
            reason: memory.correction,
            confidence: memory.score,
          }

          // High-confidence corrections are must-gather
          if (memory.score >= 0.7) {
            // Avoid duplicates
            if (!mustGather.some((p) => p.dataType === dataType)) {
              mustGather.push(item)
            }
          } else {
            if (!mayGather.some((p) => p.dataType === dataType)) {
              mayGather.push(item)
            }
          }
          break
        }
      }
    }

    // If no specific pattern matched but it's a high-confidence correction,
    // add a generic priority item
    if (memory.score >= 0.7 && memory.correction) {
      const genericMatch = correction.match(
        /should have (?:also )?gathered[:\s]+(.+?)(?:\.|$)/i
      )
      if (genericMatch && genericMatch[1]) {
        const dataType = genericMatch[1]
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
        if (!mustGather.some((p) => p.dataType === dataType)) {
          mustGather.push({
            dataType,
            reason: memory.correction,
            confidence: memory.score,
          })
        }
      }
    }
  }

  return {
    mustGather,
    mayGather,
    sourceMemories: memories.filter((m) => m.outcome === 'corrected'),
  }
}

/**
 * Store a correction when the gather step missed important info
 * that a human later needed.
 */
export async function storeGatherCorrection(
  input: StoreGatherCorrectionInput
): Promise<void> {
  const { appId, category, summary, gathered, missingInfo, conversationId } =
    input

  try {
    await SupportMemoryService.store({
      app_slug: appId,
      situation: `Category: ${category}\nIssue: ${summary}`,
      decision: `Gathered: ${gathered.join(', ')}`,
      stage: 'gather',
      outcome: 'corrected',
      correction: `Should have also gathered: ${missingInfo}`,
      category,
      conversation_id: conversationId,
      tags: ['correction', 'gather_miss', category],
    })
  } catch (error) {
    console.error('[gather] Failed to store correction:', error)
  }
}

/**
 * Store success outcome when gather provided all needed context
 */
export async function storeGatherSuccess(input: {
  appId: string
  category: MessageCategory
  summary: string
  gathered: string[]
  conversationId?: string
}): Promise<void> {
  const { appId, category, summary, gathered, conversationId } = input

  try {
    await SupportMemoryService.store({
      app_slug: appId,
      situation: `Category: ${category}\nIssue: ${summary}`,
      decision: `Gathered: ${gathered.join(', ')}`,
      stage: 'gather',
      outcome: 'success',
      category,
      conversation_id: conversationId,
      tags: ['success', 'gather', category],
    })
  } catch (error) {
    console.warn('[gather] Failed to store success:', error)
  }
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

/**
 * Determine customer email using senderEmail as PRIMARY source,
 * with body text extraction as FALLBACK.
 *
 * Returns the email to use and the source it came from.
 */
export function determineCustomerEmail(
  senderEmail: string | undefined,
  bodyText: string
): { email: string | null; source: 'sender' | 'body' | 'none' } {
  // PRIMARY: Use sender email if available and valid
  if (senderEmail && senderEmail.trim()) {
    return { email: senderEmail.trim(), source: 'sender' }
  }

  // FALLBACK: Extract from body text (customer might mention a different email)
  const bodyEmail = extractEmail(bodyText)
  if (bodyEmail) {
    return { email: bodyEmail, source: 'body' }
  }

  return { email: null, source: 'none' }
}

// ============================================================================
// Main gather function
// ============================================================================

export interface GatherOptions {
  tools?: GatherTools
  timeout?: number
  /** Skip memory lookup (for testing or when memory service unavailable) */
  skipMemory?: boolean
}

export interface EmailResolution {
  email: string | null
  source: 'sender' | 'body' | 'none'
  senderEmail?: string
  bodyExtractedEmail?: string | null
}

/** Extended gather output with memory context */
export interface GatherResultWithMemory extends GatherOutput {
  emailResolution?: EmailResolution
  /** Priorities extracted from past corrections */
  gatherPriorities?: GatherPriorities
  /** Memory context formatted for prompt injection */
  memoryContext?: string
  /** Which data sources were actually gathered */
  gatheredSources: string[]
}

export async function gather(
  input: GatherInput,
  options: GatherOptions = {}
): Promise<GatherResultWithMemory> {
  const { tools = {}, timeout = 5000, skipMemory = false } = options
  const { message, classification, appId } = input

  const startTime = Date.now()

  await log('debug', 'gather started', {
    workflow: 'pipeline',
    step: 'gather',
    appId,
    category: classification.category,
    messageLength: message.body.length,
    skipMemory,
  })

  const result: GatherResultWithMemory = {
    user: null,
    purchases: [],
    knowledge: [],
    history: [],
    priorMemory: [],
    gatherErrors: [],
    gatheredSources: [],
  }

  // ============================================================================
  // Step 1: Query memories for past corrections (learn what was missed before)
  // ============================================================================

  let gatherPriorities: GatherPriorities | undefined

  if (!skipMemory) {
    try {
      const summary = `${message.subject} ${message.body}`.slice(0, 300)
      const memories = await queryGatherMemories({
        appId,
        category: classification.category,
        summary,
        limit: 5,
      })

      if (memories.length > 0) {
        gatherPriorities = extractGatherPriorities(memories)
        result.gatherPriorities = gatherPriorities
        result.memoryContext = formatMemoriesCompact(memories)

        // Log if we have must-gather priorities from corrections
        if (gatherPriorities.mustGather.length > 0) {
          await log('debug', 'gather memory priorities found', {
            workflow: 'pipeline',
            step: 'gather',
            appId,
            mustGather: gatherPriorities.mustGather.map((p) => p.dataType),
            mayGather: gatherPriorities.mayGather.map((p) => p.dataType),
            memoriesFound: memories.length,
          })
        }
      }
    } catch (error) {
      // Memory lookup failure shouldn't block gathering
      await log('warn', 'gather memory lookup failed', {
        workflow: 'pipeline',
        step: 'gather',
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ============================================================================
  // Step 2: Determine customer email and prepare for data gathering
  // ============================================================================

  // Determine customer email - prioritize senderEmail, fallback to body extraction
  const bodyText = `${message.subject} ${message.body}`
  const bodyExtractedEmail = extractEmail(bodyText)
  const { email: customerEmail, source: emailSource } = determineCustomerEmail(
    message.from,
    bodyText
  )

  // Store resolution details for logging/debugging
  result.emailResolution = {
    email: customerEmail,
    source: emailSource,
    senderEmail: message.from,
    bodyExtractedEmail,
  }

  // ============================================================================
  // Step 3: Run all gather operations in parallel with timeout
  // ============================================================================

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

  // ============================================================================
  // Step 4: Track what was actually gathered (for outcome storage)
  // ============================================================================

  // Track successfully gathered data sources
  if (result.user) result.gatheredSources.push('user')
  if (result.purchases.length > 0) result.gatheredSources.push('purchases')
  if (result.knowledge.length > 0) result.gatheredSources.push('knowledge')
  if (result.history.length > 0) result.gatheredSources.push('history')
  if (result.priorMemory.length > 0) result.gatheredSources.push('memory')

  const durationMs = Date.now() - startTime

  await log('info', 'gather completed', {
    workflow: 'pipeline',
    step: 'gather',
    appId,
    category: classification.category,
    gatheredSources: result.gatheredSources,
    hasUser: !!result.user,
    purchaseCount: result.purchases.length,
    knowledgeCount: result.knowledge.length,
    historyCount: result.history.length,
    memoryCount: result.priorMemory.length,
    errorCount: result.gatherErrors.length,
    emailSource: result.emailResolution?.source,
    durationMs,
  })

  return result
}

/**
 * Record gather outcome after the full pipeline completes.
 *
 * Call this when:
 * - Human review reveals missing info (store correction)
 * - Response is sent successfully without edits (store success)
 *
 * @example
 * ```typescript
 * // When human needed info that wasn't gathered:
 * await recordGatherOutcome({
 *   appId,
 *   category: classification.category,
 *   summary: `${message.subject} ${message.body}`.slice(0, 300),
 *   gathered: gatherResult.gatheredSources,
 *   outcome: 'corrected',
 *   missingInfo: 'refund history - customer had 3 previous refunds',
 *   conversationId: message.conversationId,
 * })
 * ```
 */
export async function recordGatherOutcome(input: {
  appId: string
  category: MessageCategory
  summary: string
  gathered: string[]
  outcome: 'success' | 'corrected'
  missingInfo?: string
  conversationId?: string
}): Promise<void> {
  const {
    appId,
    category,
    summary,
    gathered,
    outcome,
    missingInfo,
    conversationId,
  } = input

  if (outcome === 'corrected' && missingInfo) {
    await storeGatherCorrection({
      appId,
      category,
      summary,
      gathered,
      missingInfo,
      conversationId,
    })
  } else if (outcome === 'success') {
    await storeGatherSuccess({
      appId,
      category,
      summary,
      gathered,
      conversationId,
    })
  }
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
 * Format gather output for injection into draft prompt.
 * Sanitizes any errors - they become "not found" not "API error".
 *
 * If gather priorities are present (from memory corrections),
 * adds a section highlighting what past corrections indicated.
 */
export function formatContextForPrompt(
  context: GatherOutput | GatherResultWithMemory
): string {
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

  // Add memory priorities if present (from past corrections)
  const extendedContext = context as GatherResultWithMemory
  if (
    extendedContext.gatherPriorities &&
    extendedContext.gatherPriorities.mustGather.length > 0
  ) {
    const priorityNotes = extendedContext.gatherPriorities.mustGather
      .map((p) => `- **${p.dataType}**: ${p.reason}`)
      .join('\n')
    sections.push(`## ⚠️ Past Corrections (check these)
${priorityNotes}`)
  }

  // Add memory context if present
  if (extendedContext.memoryContext) {
    sections.push(extendedContext.memoryContext)
  }

  return sections.join('\n\n')
}
