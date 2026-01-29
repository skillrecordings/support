/**
 * FAQ Candidate Miner
 *
 * Mines resolved Front conversations for FAQ candidates.
 * Part of the KB + RL feedback loop - learns from successful support interactions.
 *
 * @module faq/miner
 */

import {
  ActionsTable,
  AppsTable,
  ConversationsTable,
  and,
  database,
  desc,
  eq,
  gte,
  or,
} from '@skillrecordings/database'
import {
  type Conversation,
  type Message,
  createFrontClient,
  paginate,
} from '@skillrecordings/front-sdk'
import { getApp, getAppByInboxId } from '../services/app-registry'
import { getOutcomeHistory } from '../trust/repository'
import {
  clusterBySimilarity,
  generateCandidatesFromClusters,
} from './clusterer'
import type { MineOptions, MineResult, ResolvedConversation } from './types'
import { FAQ_THRESHOLDS } from './types'

/**
 * Parse duration string (e.g., '30d', '90d') to Date.
 */
function parseSince(since: string): Date {
  const match = since.match(/^(\d+)([dhm])$/)
  if (!match) {
    throw new Error(
      `Invalid since format: ${since}. Use format like '30d', '7d', '24h'`
    )
  }

  const valueStr = match[1]
  const unit = match[2]
  if (!valueStr || !unit) {
    throw new Error(`Invalid since format: ${since}`)
  }

  const value = parseInt(valueStr, 10)

  const now = new Date()
  switch (unit) {
    case 'd':
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000)
    case 'h':
      return new Date(now.getTime() - value * 60 * 60 * 1000)
    case 'm':
      return new Date(now.getTime() - value * 60 * 1000)
    default:
      throw new Error(`Unknown time unit: ${unit}`)
  }
}

/**
 * Extract the customer's question from conversation messages.
 * Returns the first inbound message text.
 */
function extractQuestion(messages: Message[]): string {
  // Sort by timestamp ascending
  const sorted = [...messages].sort((a, b) => a.created_at - b.created_at)

  // Find first inbound message
  const firstInbound = sorted.find((m) => m.is_inbound)
  if (!firstInbound) {
    return ''
  }

  // Prefer text, fall back to stripped HTML
  return (
    firstInbound.text ??
    firstInbound.body
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ??
    ''
  )
}

/**
 * Extract the agent's answer from conversation messages.
 * Returns the last outbound message before resolution.
 */
function extractAnswer(messages: Message[]): string {
  // Sort by timestamp descending
  const sorted = [...messages].sort((a, b) => b.created_at - a.created_at)

  // Find last outbound message
  const lastOutbound = sorted.find((m) => !m.is_inbound)
  if (!lastOutbound) {
    return ''
  }

  return (
    lastOutbound.text ??
    lastOutbound.body
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ??
    ''
  )
}

/**
 * Check if the response was sent unchanged from the agent draft.
 * Uses the RL outcome history to determine if draft was accepted as-is.
 */
async function checkIfUnchanged(
  conversationId: string,
  appId: string
): Promise<{ wasUnchanged: boolean; similarity?: number }> {
  // Look up the action for this conversation
  // Support both old 'draft-response' and new 'send-draft' action types
  const actions = await database
    .select()
    .from(ActionsTable)
    .where(
      and(
        eq(ActionsTable.conversation_id, conversationId),
        or(
          eq(ActionsTable.type, 'send-draft'),
          eq(ActionsTable.type, 'draft-response')
        )
      )
    )
    .orderBy(desc(ActionsTable.created_at))
    .limit(1)

  const action = actions[0]
  if (!action) {
    // No draft action - manual response
    return { wasUnchanged: false }
  }

  const category = action.category ?? 'unknown'

  // Get outcome history for this category
  const outcomes = await getOutcomeHistory(appId, category, 10)

  // Find outcome close to this action's timestamp
  const actionTime = action.created_at?.getTime() ?? 0
  const relevantOutcome = outcomes.find((o) => {
    const timeDiff = Math.abs(o.recordedAt.getTime() - actionTime)
    return timeDiff < 5 * 60 * 1000 // Within 5 minutes
  })

  if (relevantOutcome) {
    return {
      wasUnchanged: relevantOutcome.outcome === 'unchanged',
      similarity: relevantOutcome.similarity,
    }
  }

  // No outcome found - assume edited
  return { wasUnchanged: false }
}

/**
 * Mine resolved conversations from Front.
 *
 * @param options - Mining options
 * @returns Array of resolved conversations ready for clustering
 *
 * @example
 * ```ts
 * const convos = await mineConversations({
 *   appId: 'total-typescript',
 *   since: '30d',
 *   limit: 500,
 * })
 * ```
 */
export async function mineConversations(
  options: MineOptions
): Promise<ResolvedConversation[]> {
  const { appId, since, limit = 500, unchangedOnly = false } = options

  // Get app config
  const app = await getApp(appId)
  if (!app) {
    throw new Error(`App not found: ${appId}`)
  }

  const frontToken = process.env.FRONT_API_TOKEN
  if (!frontToken) {
    throw new Error('FRONT_API_TOKEN environment variable required')
  }

  const front = createFrontClient({ apiToken: frontToken })
  const sinceDate = parseSince(since)

  // Get resolved conversations from our database first (more efficient)
  const dbConversations = await database
    .select({
      conversation: ConversationsTable,
      app: AppsTable,
    })
    .from(ConversationsTable)
    .leftJoin(AppsTable, eq(ConversationsTable.app_id, AppsTable.id))
    .where(
      and(
        eq(ConversationsTable.app_id, app.id),
        eq(ConversationsTable.status, 'resolved'),
        gte(ConversationsTable.updated_at, sinceDate)
      )
    )
    .orderBy(desc(ConversationsTable.updated_at))
    .limit(limit)

  console.log(
    `Found ${dbConversations.length} resolved conversations in database`
  )

  const results: ResolvedConversation[] = []
  let processed = 0

  for (const row of dbConversations) {
    processed++
    if (processed % 50 === 0) {
      console.log(`Processing ${processed}/${dbConversations.length}...`)
    }

    const convId = row.conversation.front_conversation_id

    try {
      // Fetch full conversation from Front
      const [conversation, messageList] = await Promise.all([
        front.conversations.get(convId),
        front.conversations.listMessages(convId),
      ])

      const messages = (messageList as { _results: Message[] })._results ?? []

      // Extract Q&A
      const question = extractQuestion(messages)
      const answer = extractAnswer(messages)

      if (!question || !answer) {
        continue // Skip if we can't extract Q&A
      }

      // Check if draft was sent unchanged
      const { wasUnchanged, similarity } = await checkIfUnchanged(convId, appId)

      if (unchangedOnly && !wasUnchanged) {
        continue
      }

      // Extract tags
      const tags = conversation.tags?.map((t) => t.name ?? t.id) ?? []

      results.push({
        conversationId: convId,
        question,
        answer,
        subject: conversation.subject ?? '',
        resolvedAt: row.conversation.updated_at ?? new Date(),
        appId,
        wasUnchanged,
        draftSimilarity: similarity,
        tags,
        _raw: {
          conversation,
          messages,
        },
      })
    } catch (error) {
      // Skip conversations we can't fetch
      console.warn(`Failed to fetch conversation ${convId}:`, error)
      continue
    }
  }

  console.log(`Mined ${results.length} conversations with Q&A pairs`)
  return results
}

/**
 * Run full FAQ mining pipeline.
 *
 * 1. Mine resolved conversations
 * 2. Cluster by semantic similarity
 * 3. Generate FAQ candidates
 *
 * @param options - Mining options
 * @returns Full mining result with conversations, clusters, and candidates
 *
 * @example
 * ```ts
 * const result = await mineFaqCandidates({
 *   appId: 'total-typescript',
 *   since: '30d',
 * })
 *
 * console.log(`Generated ${result.candidates.length} FAQ candidates`)
 * for (const candidate of result.candidates) {
 *   if (candidate.confidence >= 0.85) {
 *     console.log(`High-confidence: ${candidate.question}`)
 *   }
 * }
 * ```
 */
export async function mineFaqCandidates(
  options: MineOptions
): Promise<MineResult> {
  console.log(`\n📚 Mining FAQ candidates for ${options.appId}...`)
  console.log(`   Since: ${options.since}`)
  console.log(`   Unchanged only: ${options.unchangedOnly ?? false}`)

  // Step 1: Mine conversations
  const conversations = await mineConversations(options)

  if (conversations.length === 0) {
    return {
      conversations: [],
      clusters: [],
      candidates: [],
      stats: {
        totalConversations: 0,
        resolvedConversations: 0,
        clusteredConversations: 0,
        clusterCount: 0,
        candidateCount: 0,
        averageClusterSize: 0,
        averageUnchangedRate: 0,
      },
    }
  }

  // Step 2: Cluster by similarity
  const clusterThreshold =
    options.clusterThreshold ?? FAQ_THRESHOLDS.DEFAULT_CLUSTER_THRESHOLD
  console.log(`\n🔗 Clustering with threshold ${clusterThreshold}...`)

  const clusters = await clusterBySimilarity(conversations, {
    threshold: clusterThreshold,
    minClusterSize: FAQ_THRESHOLDS.DEFAULT_MIN_CLUSTER_SIZE,
  })

  console.log(`   Formed ${clusters.length} clusters`)

  // Step 3: Generate candidates
  console.log(`\n✨ Generating FAQ candidates...`)
  const candidates = await generateCandidatesFromClusters(clusters)

  // Calculate stats
  const clusteredCount = clusters.reduce(
    (sum, c) => sum + c.conversations.length,
    0
  )
  const totalUnchangedRate =
    clusters.length > 0
      ? clusters.reduce((sum, c) => sum + c.unchangedRate, 0) / clusters.length
      : 0

  const stats = {
    totalConversations: conversations.length,
    resolvedConversations: conversations.length,
    clusteredConversations: clusteredCount,
    clusterCount: clusters.length,
    candidateCount: candidates.length,
    averageClusterSize:
      clusters.length > 0 ? clusteredCount / clusters.length : 0,
    averageUnchangedRate: totalUnchangedRate,
  }

  console.log(`\n📊 Mining complete:`)
  console.log(`   Conversations: ${stats.resolvedConversations}`)
  console.log(`   Clusters: ${stats.clusterCount}`)
  console.log(`   Candidates: ${stats.candidateCount}`)
  console.log(`   Avg cluster size: ${stats.averageClusterSize.toFixed(1)}`)
  console.log(
    `   Avg unchanged rate: ${(stats.averageUnchangedRate * 100).toFixed(1)}%`
  )

  return {
    conversations,
    clusters,
    candidates,
    stats,
  }
}
