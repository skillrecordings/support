/**
 * FAQ Conversation Clusterer
 *
 * Clusters resolved conversations by semantic similarity using embeddings.
 * Uses simple cosine threshold clustering (not HDBSCAN - starting simple).
 *
 * @module faq/clusterer
 */

import { randomUUID } from 'node:crypto'
import { queryVectors, upsertVector } from '../vector/client'
import type {
  ClusterOptions,
  ConversationCluster,
  FaqCandidate,
  ResolvedConversation,
} from './types'
import { FAQ_THRESHOLDS } from './types'

/**
 * Temporary namespace for clustering embeddings.
 * These are transient and not stored long-term.
 */
const CLUSTER_NAMESPACE = 'faq-cluster-temp'

/**
 * Calculate cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0
    const bVal = b[i] ?? 0
    dotProduct += aVal * bVal
    normA += aVal * aVal
    normB += bVal * bVal
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
}

/**
 * Simple greedy clustering by semantic similarity.
 *
 * Algorithm:
 * 1. Start with first conversation as first cluster centroid
 * 2. For each subsequent conversation:
 *    - Find most similar existing cluster
 *    - If similarity >= threshold, add to cluster
 *    - Otherwise, create new cluster
 * 3. Filter clusters by minimum size
 *
 * @param conversations - Conversations to cluster
 * @param options - Clustering options
 * @returns Array of conversation clusters
 */
export async function clusterBySimilarity(
  conversations: ResolvedConversation[],
  options: ClusterOptions = {}
): Promise<ConversationCluster[]> {
  const {
    threshold = FAQ_THRESHOLDS.DEFAULT_CLUSTER_THRESHOLD,
    minClusterSize = FAQ_THRESHOLDS.DEFAULT_MIN_CLUSTER_SIZE,
  } = options

  if (conversations.length === 0) {
    return []
  }

  // Use vector index to get embeddings and find similarities
  // Each conversation question gets embedded and we use the index for similarity search

  interface TempCluster {
    id: string
    conversations: ResolvedConversation[]
    centroidText: string // The first question becomes the centroid
  }

  const clusters: TempCluster[] = []

  // Process conversations one by one
  let processed = 0
  for (const convo of conversations) {
    processed++
    const questionText = convo.question.slice(0, 1000) // Truncate for embedding

    if (clusters.length === 0) {
      // First conversation starts first cluster
      const clusterId = randomUUID()
      clusters.push({
        id: clusterId,
        conversations: [convo],
        centroidText: questionText,
      })
      // Store centroid in vector index
      try {
        const upsertResult = await upsertVector({
          id: `cluster-${clusterId}`,
          data: questionText,
          metadata: {
            type: 'knowledge',
            clusterId: clusterId,
            appId: convo.appId,
          },
        })
        console.log(`   [${processed}/${conversations.length}] Created first cluster ${clusterId.slice(0, 8)} (upsert: ${JSON.stringify(upsertResult)})`)
      } catch (error) {
        console.warn(`   Failed to upsert first cluster vector:`, error)
      }
      continue
    }

    // Find most similar existing cluster using vector search
    // Query all cluster centroids and find the best match
    let bestCluster: TempCluster | null = null
    let bestScore = 0

    try {
      // Query the top N clusters to find similar ones
      const results = await queryVectors({
        data: questionText,
        topK: Math.max(clusters.length, 10),
        includeMetadata: true,
      })

      if (processed <= 5) {
        console.log(`   DEBUG: Query returned ${results.length} results`)
        if (results.length > 0) {
          console.log(`   DEBUG: First result score=${results[0]?.score}, id=${results[0]?.id}, meta=${JSON.stringify(results[0]?.metadata)}`)
        }
      }

      // Find the best match among our current clusters
      for (const result of results) {
        // Check if this result belongs to one of our clusters
        const clusterId = result.metadata?.clusterId as string | undefined
        if (!clusterId) continue
        
        const matchingCluster = clusters.find(c => c.id === clusterId)
        if (matchingCluster && result.score > bestScore) {
          bestScore = result.score
          bestCluster = matchingCluster
        }
      }
    } catch (error) {
      console.warn(`   Query failed:`, error)
    }

    if (bestCluster && bestScore >= threshold) {
      // Add to existing cluster
      bestCluster.conversations.push(convo)
      console.log(`   [${processed}/${conversations.length}] Added to cluster ${bestCluster.id.slice(0, 8)} (score: ${bestScore.toFixed(3)})`)
    } else {
      // Create new cluster
      const newCluster: TempCluster = {
        id: randomUUID(),
        conversations: [convo],
        centroidText: questionText,
      }
      clusters.push(newCluster)
      console.log(`   [${processed}/${conversations.length}] New cluster ${newCluster.id.slice(0, 8)} (best: ${bestScore.toFixed(3)} < ${threshold})`)

      // Store centroid in vector index for future comparisons
      try {
        const upsertResult = await upsertVector({
          id: `cluster-${newCluster.id}`,
          data: questionText,
          metadata: {
            type: 'knowledge',
            clusterId: newCluster.id,
            appId: convo.appId,
          },
        })
        if (processed <= 5) {
          console.log(`   DEBUG: Upserted cluster-${newCluster.id.slice(0, 8)} result=${JSON.stringify(upsertResult)}`)
        }
      } catch (error) {
        console.warn(`   Failed to upsert cluster vector:`, error)
      }
    }
  }

  // Filter by minimum size and convert to final format
  const finalClusters: ConversationCluster[] = []

  for (const cluster of clusters) {
    if (cluster.conversations.length < minClusterSize) {
      continue
    }

    const convos = cluster.conversations

    // Calculate cluster metrics
    const unchangedCount = convos.filter((c) => c.wasUnchanged).length
    const unchangedRate = unchangedCount / convos.length

    const dates = convos.map((c) => c.resolvedAt)
    const mostRecent = new Date(Math.max(...dates.map((d) => d.getTime())))
    const oldest = new Date(Math.min(...dates.map((d) => d.getTime())))

    // Cohesion is approximate - based on the fact we only added items above threshold
    // A more accurate measure would require pairwise similarity computation
    const cohesion = threshold

    finalClusters.push({
      id: cluster.id,
      centroid: cluster.centroidText,
      conversations: convos,
      cohesion,
      unchangedRate,
      mostRecent,
      oldest,
    })
  }

  // Sort by cluster size (largest first)
  finalClusters.sort((a, b) => b.conversations.length - a.conversations.length)

  return finalClusters
}

/**
 * Synthesize a canonical question from cluster conversations.
 * Uses the most common patterns/phrases.
 */
function synthesizeQuestion(cluster: ConversationCluster): string {
  const questions = cluster.conversations.map((c) => c.question)

  // For now, use the centroid (first question)
  // TODO: Use LLM to synthesize from multiple questions
  return cluster.centroid
}

/**
 * Select the best answer from cluster conversations.
 * Prioritizes unchanged drafts and recency.
 */
function selectBestAnswer(cluster: ConversationCluster): string {
  const convos = cluster.conversations

  // Prefer unchanged responses (agent draft accepted as-is)
  const unchanged = convos.filter((c) => c.wasUnchanged)
  if (unchanged.length > 0) {
    // Pick most recent unchanged
    unchanged.sort((a, b) => b.resolvedAt.getTime() - a.resolvedAt.getTime())
    const best = unchanged[0]
    if (best) return best.answer
  }

  // Fall back to most recent response
  const sorted = [...convos].sort(
    (a, b) => b.resolvedAt.getTime() - a.resolvedAt.getTime()
  )
  const first = sorted[0]
  return first?.answer ?? ''
}

/**
 * Extract common subject patterns from cluster.
 */
function extractSubjectPatterns(cluster: ConversationCluster): string[] {
  const subjects = cluster.conversations
    .map((c) => c.subject)
    .filter((s) => s.length > 0)

  // Get unique patterns (simplified - just unique subjects for now)
  const unique = [...new Set(subjects)]
  return unique.slice(0, 5) // Top 5
}

/**
 * Extract common tags from cluster.
 */
function extractCommonTags(cluster: ConversationCluster): string[] {
  const tagCounts = new Map<string, number>()

  for (const convo of cluster.conversations) {
    for (const tag of convo.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
    }
  }

  // Sort by frequency and filter to those appearing in >50% of conversations
  const minCount = cluster.conversations.length * 0.5
  return Array.from(tagCounts.entries())
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
}

/**
 * Calculate confidence score for an FAQ candidate.
 *
 * Factors:
 * - Cluster size (more = higher confidence)
 * - Unchanged rate (higher = agent drafts are good)
 * - Cohesion (tighter cluster = clearer pattern)
 */
function calculateConfidence(cluster: ConversationCluster): number {
  const { conversations, unchangedRate, cohesion } = cluster

  const size = conversations.length

  // Size score: logarithmic scaling, max at 20+ conversations
  const sizeScore = Math.min(Math.log10(size + 1) / Math.log10(21), 1)

  // Unchanged rate directly contributes
  const unchangedScore = unchangedRate

  // Cohesion contributes
  const cohesionScore = cohesion

  // Weighted average
  const confidence =
    sizeScore * 0.3 + unchangedScore * 0.5 + cohesionScore * 0.2

  return Math.min(Math.max(confidence, 0), 1)
}

/**
 * Suggest a category based on tags and patterns.
 */
function suggestCategory(cluster: ConversationCluster): string | undefined {
  const tags = extractCommonTags(cluster)

  // Map common tags to categories
  const categoryMap: Record<string, string> = {
    refund: 'refund',
    'refund-request': 'refund',
    billing: 'billing',
    invoice: 'billing',
    payment: 'billing',
    access: 'access',
    login: 'access',
    password: 'access',
    license: 'license',
    seats: 'license',
    team: 'license',
    technical: 'technical',
    bug: 'technical',
    error: 'technical',
    content: 'content',
    video: 'content',
    course: 'content',
  }

  for (const tag of tags) {
    const lower = tag.toLowerCase()
    if (categoryMap[lower]) {
      return categoryMap[lower]
    }
  }

  return undefined
}

/**
 * Generate FAQ candidates from clusters.
 *
 * @param clusters - Conversation clusters
 * @returns Array of FAQ candidates
 */
export async function generateCandidatesFromClusters(
  clusters: ConversationCluster[]
): Promise<FaqCandidate[]> {
  const candidates: FaqCandidate[] = []

  for (const cluster of clusters) {
    const question = synthesizeQuestion(cluster)
    const answer = selectBestAnswer(cluster)
    const confidence = calculateConfidence(cluster)
    const tags = extractCommonTags(cluster)
    const subjectPatterns = extractSubjectPatterns(cluster)
    const suggestedCategory = suggestCategory(cluster)

    candidates.push({
      id: randomUUID(),
      question,
      answer,
      clusterId: cluster.id,
      clusterSize: cluster.conversations.length,
      unchangedRate: cluster.unchangedRate,
      confidence,
      tags,
      subjectPatterns,
      sourceConversationIds: cluster.conversations.map((c) => c.conversationId),
      generatedAt: new Date(),
      suggestedCategory,
      status: 'pending',
    })
  }

  // Sort by confidence (highest first)
  candidates.sort((a, b) => b.confidence - a.confidence)

  return candidates
}

/**
 * Filter candidates that meet auto-surface thresholds.
 *
 * @param candidates - All candidates
 * @returns Candidates that should be auto-surfaced for review
 */
export function filterAutoSurfaceCandidates(
  candidates: FaqCandidate[]
): FaqCandidate[] {
  return candidates.filter(
    (c) =>
      c.clusterSize >= FAQ_THRESHOLDS.MIN_CLUSTER_SIZE &&
      c.unchangedRate >= FAQ_THRESHOLDS.MIN_UNCHANGED_RATE
  )
}
