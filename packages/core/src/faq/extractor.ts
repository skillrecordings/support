/**
 * FAQ Extraction Pipeline
 *
 * Extracts FAQ candidates from clustered conversations.
 * Scores, deduplicates, and outputs candidates for human review.
 *
 * Phase 1.3 of the FAQ Mining pipeline.
 *
 * @module faq/extractor
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type FilterResult,
  type FilterStats,
  createFilterStats,
  formatFilterStats,
  shouldFilter,
  updateFilterStats,
} from './filters'
import { saveCandidatesToQueue } from './review'
import type {
  ConversationAssignment,
  DataSource,
  FaqCandidate,
  ProductionCluster,
  ProductionClusteringResult,
} from './types'

/**
 * Golden response for matching
 */
export interface GoldenResponse {
  id: string
  text: string
  template: string
  reuse_count: number
  avg_thread_length: number
  quality_score: number
  topic: string
}

/**
 * Scoring factors for a candidate
 */
export interface CandidateScore {
  /** Overall confidence score (0-1) */
  confidenceScore: number
  factors: {
    /** Normalized cluster size (bigger = more common question) */
    clusterSize: number
    /** Normalized thread length (shorter = cleaner resolution) */
    threadLength: number
    /** Whether answer matches a golden response template */
    goldenMatch: number
    /** Response quality (length, structure, helpfulness) */
    responseQuality: number
  }
}

/**
 * Extracted FAQ candidate with scoring
 */
export interface ExtractedCandidate extends FaqCandidate {
  /** Scoring breakdown */
  score: CandidateScore
  /** Golden response ID if matched */
  goldenResponseMatch?: string
  /** Alternate question phrasings from similar conversations */
  alternatePhrasings: string[]
  /** Source conversation IDs */
  sourceConversations: string[]
}

/**
 * Extraction statistics
 */
export interface ExtractionStats {
  /** Total candidates extracted */
  totalCandidates: number
  /** Candidates by app */
  byApp: Record<string, number>
  /** Average confidence score */
  avgConfidence: number
  /** Percentage matching golden responses */
  goldenMatchRate: number
  /** Number of candidates with confidence > 0.7 */
  highConfidenceCount: number
  /** Number deduplicated */
  deduplicatedCount: number
  /** Clusters processed */
  clustersProcessed: number
  /** Noise conversations skipped (from Phase 0 clustering) */
  noiseSkipped: number
  /** Filter statistics (from preprocessing filters) */
  filterStats?: FilterStats
}

/**
 * Options for extraction
 */
export interface ExtractionOptions {
  /** Path to clustering result file */
  clusteringPath: string
  /** Path to golden responses file */
  goldenPath?: string
  /** Data source for fetching conversations */
  source: DataSource
  /** Output directory for artifacts */
  outputPath?: string
  /** Version tag (e.g., 'v1') */
  version?: string
  /** Minimum cluster size to process (default: 3) */
  minClusterSize?: number
  /** Number of representative conversations per cluster (default: 5) */
  topN?: number
  /** Similarity threshold for deduplication (default: 0.85) */
  dedupThreshold?: number
  /** Whether to push to Redis review queue */
  pushToRedis?: boolean
  /** App ID for Redis queue (required if pushToRedis is true) */
  appId?: string
  /** Dry run - don't write artifacts or push to Redis */
  dryRun?: boolean
  /** Apply preprocessing filters to remove noise (default: true) */
  applyFilters?: boolean
}

/**
 * Extraction result
 */
export interface ExtractionResult {
  /** Extracted candidates */
  candidates: ExtractedCandidate[]
  /** Statistics */
  stats: ExtractionStats
  /** Version */
  version: string
  /** When extraction was run */
  extractedAt: string
}

// =============================================================================
// Scoring Functions
// =============================================================================

/**
 * Score weights for candidate ranking
 *
 * Adjusted to favor high-volume clusters (proven common questions)
 * over golden match (which is a bonus, not requirement).
 */
const SCORE_WEIGHTS = {
  clusterSize: 0.4, // Bigger clusters = more common questions (primary signal)
  threadLength: 0.2, // Shorter threads = cleaner resolution
  goldenMatch: 0.2, // Golden response match = bonus for proven quality
  responseQuality: 0.2, // Well-structured response
} as const

/**
 * Calculate normalized cluster size score.
 * Uses log scale since cluster sizes vary widely.
 */
function scoreClusterSize(size: number, maxSize: number): number {
  if (maxSize <= 1) return 0
  // Log scale normalization
  const logSize = Math.log10(size + 1)
  const logMax = Math.log10(maxSize + 1)
  return Math.min(1, logSize / logMax)
}

/**
 * Calculate thread length score.
 * Shorter threads (2-4 messages) score higher.
 */
function scoreThreadLength(messageCount: number): number {
  // Ideal: 2-3 messages (question + answer, maybe one clarification)
  // Penalty for very long threads (>6 messages)
  if (messageCount <= 2) return 1.0
  if (messageCount <= 3) return 0.9
  if (messageCount <= 4) return 0.7
  if (messageCount <= 6) return 0.5
  return 0.3
}

/**
 * Calculate golden response match score.
 * Uses simple string similarity (could be upgraded to embeddings).
 */
function scoreGoldenMatch(
  answer: string,
  goldenResponses: GoldenResponse[]
): { score: number; matchId?: string } {
  if (!goldenResponses.length) return { score: 0 }

  // Normalize for comparison
  const normalizedAnswer = answer.toLowerCase().trim()

  let bestScore = 0
  let bestMatchId: string | undefined

  for (const golden of goldenResponses) {
    const normalizedTemplate = golden.template.toLowerCase().trim()

    // Check for exact or near-exact match
    if (
      normalizedAnswer.includes(normalizedTemplate) ||
      normalizedTemplate.includes(normalizedAnswer)
    ) {
      // High score for template matches
      const score = 0.9 + golden.quality_score * 0.1
      if (score > bestScore) {
        bestScore = score
        bestMatchId = golden.id
      }
      continue
    }

    // Check for partial overlap using Jaccard-like similarity
    const answerWords = new Set(normalizedAnswer.split(/\s+/))
    const templateWords = new Set(normalizedTemplate.split(/\s+/))
    const intersection = [...answerWords].filter((w) =>
      templateWords.has(w)
    ).length
    const union = new Set([...answerWords, ...templateWords]).size

    const jaccard = intersection / union
    if (jaccard > 0.5) {
      const score = jaccard * golden.quality_score
      if (score > bestScore) {
        bestScore = score
        bestMatchId = golden.id
      }
    }
  }

  return { score: bestScore, matchId: bestMatchId }
}

/**
 * Calculate response quality score.
 * Factors: length, structure, helpfulness indicators.
 */
function scoreResponseQuality(answer: string): number {
  let score = 0

  // Length: prefer moderate length (50-500 chars)
  const length = answer.length
  if (length >= 50 && length <= 500) {
    score += 0.3
  } else if (length > 500 && length <= 1000) {
    score += 0.25
  } else if (length > 20) {
    score += 0.15
  }

  // Structure: has greeting or closing
  if (/^(hi|hello|hey|thank|thanks)/i.test(answer)) score += 0.1
  if (/(best|regards|cheers|thanks|happy coding)/i.test(answer)) score += 0.1

  // Helpfulness indicators
  if (/you can|you'll be able to|this will|we've/i.test(answer)) score += 0.15
  if (/link|http|https|email|support/i.test(answer)) score += 0.1

  // Penalty for very short responses
  if (length < 50) score -= 0.2

  // Penalty for responses that seem incomplete
  if (/\?$/.test(answer.trim())) score -= 0.1

  // Normalize to 0-1
  return Math.max(0, Math.min(1, score))
}

/**
 * Calculate overall candidate score.
 */
function calculateScore(
  clusterSize: number,
  maxClusterSize: number,
  threadLength: number,
  answer: string,
  goldenResponses: GoldenResponse[]
): CandidateScore {
  const clusterSizeScore = scoreClusterSize(clusterSize, maxClusterSize)
  const threadLengthScore = scoreThreadLength(threadLength)
  const goldenResult = scoreGoldenMatch(answer, goldenResponses)
  const qualityScore = scoreResponseQuality(answer)

  const factors = {
    clusterSize: clusterSizeScore,
    threadLength: threadLengthScore,
    goldenMatch: goldenResult.score,
    responseQuality: qualityScore,
  }

  // Weighted sum
  const confidenceScore =
    factors.clusterSize * SCORE_WEIGHTS.clusterSize +
    factors.threadLength * SCORE_WEIGHTS.threadLength +
    factors.goldenMatch * SCORE_WEIGHTS.goldenMatch +
    factors.responseQuality * SCORE_WEIGHTS.responseQuality

  return {
    confidenceScore: Math.min(1, confidenceScore),
    factors,
  }
}

// =============================================================================
// Deduplication
// =============================================================================

/**
 * Simple word-based similarity for deduplication.
 * For production, would use embeddings.
 */
function questionSimilarity(q1: string, q2: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)

  const words1 = new Set(normalize(q1))
  const words2 = new Set(normalize(q2))

  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = [...words1].filter((w) => words2.has(w)).length
  const union = new Set([...words1, ...words2]).size

  return intersection / union
}

/**
 * Deduplicate candidates by question similarity.
 * Merges similar questions, keeping the best answer.
 */
function deduplicateCandidates(
  candidates: ExtractedCandidate[],
  threshold: number
): { deduplicated: ExtractedCandidate[]; removedCount: number } {
  const result: ExtractedCandidate[] = []
  const merged = new Set<number>()

  // Sort by confidence (highest first)
  const sorted = [...candidates].sort(
    (a, b) => b.score.confidenceScore - a.score.confidenceScore
  )

  for (let i = 0; i < sorted.length; i++) {
    if (merged.has(i)) continue

    const candidate = sorted[i]!
    const similar: string[] = []

    // Find similar questions
    for (let j = i + 1; j < sorted.length; j++) {
      if (merged.has(j)) continue

      const other = sorted[j]!
      const similarity = questionSimilarity(candidate.question, other.question)

      if (similarity >= threshold) {
        merged.add(j)
        similar.push(other.question)
        // Merge source conversations
        candidate.sourceConversations.push(...other.sourceConversations)
        // Add cluster size
        candidate.clusterSize += other.clusterSize
      }
    }

    // Add alternate phrasings
    if (similar.length > 0) {
      candidate.alternatePhrasings = [
        ...candidate.alternatePhrasings,
        ...similar.slice(0, 5), // Keep top 5 alternate phrasings
      ]
    }

    result.push(candidate)
  }

  return {
    deduplicated: result,
    removedCount: merged.size,
  }
}

// =============================================================================
// Main Extraction
// =============================================================================

/**
 * Read clustering result from file.
 */
function readClusteringResult(path: string): ProductionClusteringResult {
  const content = readFileSync(path, 'utf-8')
  return JSON.parse(content)
}

/**
 * Read golden responses from file.
 */
function readGoldenResponses(path: string): GoldenResponse[] {
  try {
    const content = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(content)
    return parsed.responses || parsed
  } catch {
    return []
  }
}

/**
 * Generate unique candidate ID.
 */
function generateCandidateId(): string {
  return `faq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Extract Q&A pair from conversation messages.
 */
interface ExtractedQA {
  question: string
  answer: string
  threadLength: number
  senderEmail?: string
}

/**
 * Result from Q&A extraction with filter status.
 */
interface ExtractedQAResult {
  qa: ExtractedQA | null
  filterResult?: FilterResult
}

async function extractQAFromConversation(
  conversationId: string,
  source: DataSource,
  applyFilters = true
): Promise<ExtractedQAResult> {
  try {
    const messages = await source.getMessages(conversationId)
    if (messages.length === 0) return { qa: null }

    // Sort by timestamp ascending
    const sorted = [...messages].sort((a, b) => a.created_at - b.created_at)

    // Find first inbound (customer) message
    const firstInbound = sorted.find((m) => m.is_inbound)
    if (!firstInbound) return { qa: null }

    // Find last outbound (agent) message
    const lastOutbound = [...sorted].reverse().find((m) => !m.is_inbound)
    if (!lastOutbound) return { qa: null }

    const question =
      firstInbound.text ||
      firstInbound.body
        ?.replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() ||
      ''

    const answer =
      lastOutbound.text ||
      lastOutbound.body
        ?.replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() ||
      ''

    // Filter out very short or empty Q&A
    if (question.length < 20 || answer.length < 20) return { qa: null }

    // Get sender email from first inbound message author
    const senderEmail = firstInbound.author?.email

    // Apply preprocessing filters if enabled
    if (applyFilters) {
      const filterResult = shouldFilter(question, senderEmail)
      if (filterResult.filtered) {
        return {
          qa: null,
          filterResult,
        }
      }
    }

    return {
      qa: {
        question,
        answer,
        threadLength: messages.length,
        senderEmail,
      },
    }
  } catch {
    return { qa: null }
  }
}

/**
 * Result from cluster extraction including filter statistics.
 */
interface ClusterExtractionResult {
  candidate: ExtractedCandidate | null
  filterStats: FilterStats
}

/**
 * Extract candidates from a single cluster.
 */
async function extractFromCluster(
  cluster: ProductionCluster,
  assignments: Record<string, ConversationAssignment>,
  source: DataSource,
  goldenResponses: GoldenResponse[],
  maxClusterSize: number,
  topN: number,
  applyFilters: boolean
): Promise<ClusterExtractionResult> {
  const filterStats = createFilterStats()

  // Get representative conversations (closest to centroid)
  const clusterConvIds = Object.entries(assignments)
    .filter(([_, a]) => a.clusterId === cluster.id)
    .sort(
      (a, b) => (a[1].distanceToCentroid ?? 1) - (b[1].distanceToCentroid ?? 1)
    )
    .slice(0, topN)
    .map(([id]) => id)

  if (clusterConvIds.length === 0) {
    return { candidate: null, filterStats }
  }

  // Extract Q&A pairs from representative conversations
  const qaResults: Array<ExtractedQA & { conversationId: string }> = []

  for (const convId of clusterConvIds) {
    const result = await extractQAFromConversation(convId, source, applyFilters)

    // Track filter stats
    if (result.filterResult) {
      updateFilterStats(filterStats, result.filterResult)
    } else if (result.qa) {
      updateFilterStats(filterStats, { filtered: false })
    }

    if (result.qa) {
      qaResults.push({ ...result.qa, conversationId: convId })
    }
  }

  if (qaResults.length === 0) {
    return { candidate: null, filterStats }
  }

  // Use the best Q&A (shortest thread, longest answer)
  qaResults.sort((a, b) => {
    // Prefer shorter threads
    if (a.threadLength !== b.threadLength) {
      return a.threadLength - b.threadLength
    }
    // Then prefer longer answers
    return b.answer.length - a.answer.length
  })

  const best = qaResults[0]!

  // Calculate score
  const score = calculateScore(
    cluster.size,
    maxClusterSize,
    best.threadLength,
    best.answer,
    goldenResponses
  )

  // Check for golden match
  const goldenResult = scoreGoldenMatch(best.answer, goldenResponses)

  // Collect alternate phrasings from other Q&As
  const alternatePhrasings = qaResults
    .slice(1)
    .map((qa) => qa.question)
    .filter((q) => q !== best.question)
    .slice(0, 3)

  const candidate: ExtractedCandidate = {
    id: generateCandidateId(),
    question: best.question,
    answer: best.answer,
    clusterId: cluster.id.toString(),
    clusterSize: cluster.size,
    unchangedRate: 0, // Not tracked in current pipeline
    confidence: score.confidenceScore,
    tags: cluster.topTags,
    subjectPatterns: [cluster.label],
    sourceConversationIds: qaResults.map((qa) => qa.conversationId),
    generatedAt: new Date(),
    suggestedCategory: cluster.label,
    status: 'pending',
    score,
    goldenResponseMatch: goldenResult.matchId,
    alternatePhrasings,
    sourceConversations: qaResults.map((qa) => qa.conversationId),
  }

  return { candidate, filterStats }
}

/**
 * Main extraction function.
 *
 * Extracts FAQ candidates from clustered conversations.
 *
 * @param options - Extraction options
 * @returns Extraction result with candidates and stats
 *
 * @example
 * ```ts
 * const source = await createDuckDBSource({ dbPath: '...' })
 * const result = await extractFaqCandidates({
 *   clusteringPath: 'artifacts/phase-1/clustering/v1/clustering-result.json',
 *   goldenPath: 'artifacts/phase-0/golden/latest/responses.json',
 *   source,
 *   outputPath: 'artifacts/phase-1/extraction',
 *   version: 'v1',
 * })
 * console.log(`Extracted ${result.candidates.length} candidates`)
 * ```
 */
export async function extractFaqCandidates(
  options: ExtractionOptions
): Promise<ExtractionResult> {
  const {
    clusteringPath,
    goldenPath,
    source,
    outputPath,
    version = 'v1',
    minClusterSize = 3,
    topN = 5,
    dedupThreshold = 0.85,
    pushToRedis = false,
    appId,
    dryRun = false,
    applyFilters = true,
  } = options

  console.log('🔬 FAQ Extraction Pipeline')
  console.log('='.repeat(60))
  console.log(`   Clustering: ${clusteringPath}`)
  console.log(`   Golden responses: ${goldenPath ?? 'none'}`)
  console.log(`   Min cluster size: ${minClusterSize}`)
  console.log(`   Top N per cluster: ${topN}`)
  console.log(`   Dedup threshold: ${dedupThreshold}`)
  console.log(`   Push to Redis: ${pushToRedis}`)
  console.log(`   Apply filters: ${applyFilters}`)
  console.log(`   Dry run: ${dryRun}`)
  console.log('')

  // Read clustering result
  console.log('📊 Loading clustering result...')
  const clustering = readClusteringResult(clusteringPath)
  console.log(
    `   ${clustering.clusters.length} clusters, ${clustering.stats.totalConversations} conversations`
  )

  // Read golden responses
  const goldenResponses = goldenPath ? readGoldenResponses(goldenPath) : []
  console.log(`   ${goldenResponses.length} golden responses loaded`)

  // Filter clusters by size
  const eligibleClusters = clustering.clusters.filter(
    (c) => c.size >= minClusterSize
  )
  console.log(
    `   ${eligibleClusters.length} clusters meet size threshold (≥${minClusterSize})`
  )

  // Find max cluster size for normalization
  const maxClusterSize = Math.max(...clustering.clusters.map((c) => c.size))

  // Aggregate filter statistics
  const aggregateFilterStats = createFilterStats()

  // Extract candidates from each cluster
  console.log('\n📝 Extracting candidates...')
  const candidates: ExtractedCandidate[] = []
  let processed = 0

  for (const cluster of eligibleClusters) {
    processed++
    if (processed % 10 === 0) {
      console.log(
        `   Processing cluster ${processed}/${eligibleClusters.length}...`
      )
    }

    const result = await extractFromCluster(
      cluster,
      clustering.assignments,
      source,
      goldenResponses,
      maxClusterSize,
      topN,
      applyFilters
    )

    // Aggregate filter stats
    aggregateFilterStats.total += result.filterStats.total
    aggregateFilterStats.filtered += result.filterStats.filtered
    aggregateFilterStats.passed += result.filterStats.passed
    for (const [reason, count] of Object.entries(result.filterStats.byReason)) {
      aggregateFilterStats.byReason[reason] =
        (aggregateFilterStats.byReason[reason] ?? 0) + count
    }

    if (result.candidate) {
      candidates.push(result.candidate)
    }
  }

  console.log(`   Extracted ${candidates.length} raw candidates`)

  // Log filter statistics if filters were applied
  if (applyFilters && aggregateFilterStats.total > 0) {
    console.log('\n🔍 Filter Statistics:')
    console.log(formatFilterStats(aggregateFilterStats))
  }

  // Deduplicate
  console.log('\n🔄 Deduplicating candidates...')
  const { deduplicated, removedCount } = deduplicateCandidates(
    candidates,
    dedupThreshold
  )
  console.log(
    `   Removed ${removedCount} duplicates, ${deduplicated.length} unique candidates`
  )

  // Sort by confidence
  deduplicated.sort((a, b) => b.score.confidenceScore - a.score.confidenceScore)

  // Calculate stats
  const goldenMatches = deduplicated.filter((c) => c.goldenResponseMatch).length
  const highConfidence = deduplicated.filter(
    (c) => c.score.confidenceScore >= 0.7
  ).length
  const avgConfidence =
    deduplicated.length > 0
      ? deduplicated.reduce((sum, c) => sum + c.score.confidenceScore, 0) /
        deduplicated.length
      : 0

  const stats: ExtractionStats = {
    totalCandidates: deduplicated.length,
    byApp: { [appId ?? 'all']: deduplicated.length },
    avgConfidence,
    goldenMatchRate:
      deduplicated.length > 0 ? goldenMatches / deduplicated.length : 0,
    highConfidenceCount: highConfidence,
    deduplicatedCount: removedCount,
    clustersProcessed: eligibleClusters.length,
    noiseSkipped: clustering.stats.noiseConversations,
    filterStats: applyFilters ? aggregateFilterStats : undefined,
  }

  const result: ExtractionResult = {
    candidates: deduplicated,
    stats,
    version,
    extractedAt: new Date().toISOString(),
  }

  // Output
  if (!dryRun) {
    // Write artifacts
    if (outputPath) {
      writeExtractionArtifacts(result, outputPath)
    }

    // Push to Redis
    if (pushToRedis && appId) {
      console.log('\n📤 Pushing to Redis review queue...')
      const saved = await saveCandidatesToQueue(deduplicated, appId)
      console.log(`   Saved ${saved} candidates to queue`)
    }
  } else {
    console.log('\n🧪 Dry run - no artifacts written')
  }

  // Display summary
  displayExtractionSummary(result)

  return result
}

/**
 * Write extraction artifacts to disk.
 */
export function writeExtractionArtifacts(
  result: ExtractionResult,
  outputPath: string
): void {
  const versionPath = join(outputPath, result.version)

  // Create output directory
  if (!existsSync(versionPath)) {
    mkdirSync(versionPath, { recursive: true })
  }

  // Write full result
  const resultPath = join(versionPath, 'extraction-result.json')
  writeFileSync(resultPath, JSON.stringify(result, null, 2))
  console.log(`✅ Written: ${resultPath}`)

  // Write candidates separately
  const candidatesPath = join(versionPath, 'candidates.json')
  const candidatesData = {
    version: result.version,
    extractedAt: result.extractedAt,
    count: result.candidates.length,
    candidates: result.candidates.map((c) => ({
      id: c.id,
      question: c.question,
      answer: c.answer,
      alternatePhrasings: c.alternatePhrasings,
      clusterSize: c.clusterSize,
      confidence: c.confidence,
      goldenResponseMatch: c.goldenResponseMatch,
      suggestedCategory: c.suggestedCategory,
      tags: c.tags,
      sourceConversations: c.sourceConversations.slice(0, 5),
    })),
  }
  writeFileSync(candidatesPath, JSON.stringify(candidatesData, null, 2))
  console.log(`✅ Written: ${candidatesPath}`)

  // Write stats
  const statsPath = join(versionPath, 'stats.json')
  writeFileSync(
    statsPath,
    JSON.stringify(
      {
        version: result.version,
        extractedAt: result.extractedAt,
        ...result.stats,
      },
      null,
      2
    )
  )
  console.log(`✅ Written: ${statsPath}`)

  // Update latest symlink (via copy)
  const latestPath = join(outputPath, 'latest')
  if (existsSync(latestPath)) {
    const { rmSync } = require('fs')
    rmSync(latestPath, { recursive: true, force: true })
  }
  mkdirSync(latestPath, { recursive: true })

  for (const file of [
    'extraction-result.json',
    'candidates.json',
    'stats.json',
  ]) {
    const src = join(versionPath, file)
    const dst = join(latestPath, file)
    if (existsSync(src)) {
      writeFileSync(dst, readFileSync(src))
    }
  }
  console.log(`✅ Updated: ${latestPath}`)
}

/**
 * Display extraction summary to console.
 */
export function displayExtractionSummary(result: ExtractionResult): void {
  console.log('\n📊 Extraction Summary')
  console.log('='.repeat(60))
  console.log(`   Version: ${result.version}`)
  console.log(`   Extracted: ${result.extractedAt}`)
  console.log('')
  console.log('📈 Statistics:')
  console.log(`   Total candidates:        ${result.stats.totalCandidates}`)
  console.log(`   High confidence (≥0.7):  ${result.stats.highConfidenceCount}`)
  console.log(
    `   Average confidence:      ${(result.stats.avgConfidence * 100).toFixed(1)}%`
  )
  console.log(
    `   Golden match rate:       ${(result.stats.goldenMatchRate * 100).toFixed(1)}%`
  )
  console.log(`   Deduplicated:            ${result.stats.deduplicatedCount}`)
  console.log(`   Clusters processed:      ${result.stats.clustersProcessed}`)
  console.log(`   Noise skipped:           ${result.stats.noiseSkipped}`)

  // Show filter stats if available
  if (result.stats.filterStats && result.stats.filterStats.total > 0) {
    console.log('')
    console.log(formatFilterStats(result.stats.filterStats))
  }

  if (result.candidates.length > 0) {
    console.log('\n🏆 Top 10 Candidates:')
    console.log('-'.repeat(60))

    for (const [i, candidate] of result.candidates.slice(0, 10).entries()) {
      const confPct = (candidate.confidence * 100).toFixed(0)
      const golden = candidate.goldenResponseMatch ? ' 🌟' : ''
      console.log(
        `\n${i + 1}. [${confPct}%]${golden} ${candidate.suggestedCategory}`
      )
      console.log(
        `   Q: ${candidate.question.slice(0, 100)}${candidate.question.length > 100 ? '...' : ''}`
      )
      console.log(
        `   A: ${candidate.answer.slice(0, 100)}${candidate.answer.length > 100 ? '...' : ''}`
      )
      console.log(
        `   Size: ${candidate.clusterSize} | Sources: ${candidate.sourceConversations.length}`
      )
    }
  }

  console.log('')
}
