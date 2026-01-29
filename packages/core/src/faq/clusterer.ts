/**
 * FAQ Conversation Clusterer
 *
 * Clusters resolved conversations by semantic similarity using embeddings.
 * Uses simple cosine threshold clustering (not HDBSCAN - starting simple).
 *
 * Uses local embeddings and similarity computation to avoid eventual consistency
 * issues with persistent vector indexes.
 *
 * @module faq/clusterer
 */

import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import type {
  ClusterOptions,
  ConversationCluster,
  FaqCandidate,
  ResolvedConversation,
} from './types'
import { FAQ_THRESHOLDS } from './types'

/**
 * OpenAI client for embeddings (lazy initialized)
 */
let _openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI()
  }
  return _openai
}

/**
 * Get embeddings for a batch of texts using OpenAI.
 * Uses text-embedding-3-small for cost efficiency.
 */
async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const openai = getOpenAI()
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  })

  // Sort by index to ensure order matches input
  const sorted = response.data.sort((a, b) => a.index - b.index)
  return sorted.map((item) => item.embedding)
}

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
 * Uses local embedding computation and similarity matching to avoid
 * eventual consistency issues with persistent vector indexes.
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

  interface TempCluster {
    id: string
    conversations: ResolvedConversation[]
    centroidText: string
    centroidEmbedding: number[]
  }

  const clusters: TempCluster[] = []

  // Pre-compute all embeddings in batches for efficiency
  console.log(
    `   Computing embeddings for ${conversations.length} questions...`
  )
  const questionTexts = conversations.map((c) => c.question.slice(0, 1000))

  // Batch embeddings in chunks of 100 to avoid API limits
  const BATCH_SIZE = 100
  const allEmbeddings: number[][] = []

  for (let i = 0; i < questionTexts.length; i += BATCH_SIZE) {
    const batch = questionTexts.slice(i, i + BATCH_SIZE)
    const batchEmbeddings = await getEmbeddings(batch)
    allEmbeddings.push(...batchEmbeddings)

    if (questionTexts.length > BATCH_SIZE) {
      console.log(
        `   Embedded ${Math.min(i + BATCH_SIZE, questionTexts.length)}/${questionTexts.length}...`
      )
    }
  }

  // Process conversations one by one
  let processed = 0
  for (let idx = 0; idx < conversations.length; idx++) {
    const convo = conversations[idx]!
    const questionEmbedding = allEmbeddings[idx]!
    const questionText = questionTexts[idx]!
    processed++

    if (clusters.length === 0) {
      // First conversation starts first cluster
      const clusterId = randomUUID()
      clusters.push({
        id: clusterId,
        conversations: [convo],
        centroidText: questionText,
        centroidEmbedding: questionEmbedding,
      })
      console.log(
        `   [${processed}/${conversations.length}] Created first cluster ${clusterId.slice(0, 8)}`
      )
      continue
    }

    // Find most similar existing cluster using local similarity computation
    let bestCluster: TempCluster | null = null
    let bestScore = 0

    for (const cluster of clusters) {
      const similarity = cosineSimilarity(
        questionEmbedding,
        cluster.centroidEmbedding
      )
      if (similarity > bestScore) {
        bestScore = similarity
        bestCluster = cluster
      }
    }

    if (bestCluster && bestScore >= threshold) {
      // Add to existing cluster
      bestCluster.conversations.push(convo)
      console.log(
        `   [${processed}/${conversations.length}] Added to cluster ${bestCluster.id.slice(0, 8)} (score: ${bestScore.toFixed(3)})`
      )
    } else {
      // Create new cluster
      const newCluster: TempCluster = {
        id: randomUUID(),
        conversations: [convo],
        centroidText: questionText,
        centroidEmbedding: questionEmbedding,
      }
      clusters.push(newCluster)
      console.log(
        `   [${processed}/${conversations.length}] New cluster ${newCluster.id.slice(0, 8)} (best: ${bestScore.toFixed(3)} < ${threshold})`
      )
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
