import { randomUUID } from 'node:crypto'
import { fetchMemory, queryMemories, upsertMemory } from './client'
import { calculateConfidence } from './decay'
import { MemoryService } from './memory'
import type {
  CorrectionInput,
  FindSimilarOptions,
  StoreSupportMemoryInput,
  SupportMemory,
  SupportMemoryMetadata,
  SupportSearchResult,
} from './support-schemas'
import { VotingService } from './voting'

/**
 * Collection prefix for support memories
 */
const SUPPORT_COLLECTION_PREFIX = 'support'

/**
 * Global collection for cross-app patterns
 */
const GLOBAL_COLLECTION = `${SUPPORT_COLLECTION_PREFIX}:global`

/**
 * Get collection name for app
 */
function getCollection(appSlug?: string): string {
  if (!appSlug) return GLOBAL_COLLECTION
  return `${SUPPORT_COLLECTION_PREFIX}:${appSlug}`
}

/**
 * Format situation and decision into searchable content
 */
function formatContent(situation: string, decision: string): string {
  return `SITUATION: ${situation.trim()}\n\nDECISION: ${decision.trim()}`
}

/**
 * Parse content back to situation and decision
 */
function parseContent(content: string): {
  situation: string
  decision: string
} {
  const situationMatch = content.match(/SITUATION:\s*(.+?)(?=\n\nDECISION:|$)/s)
  const decisionMatch = content.match(/DECISION:\s*(.+)/s)

  return {
    situation: situationMatch?.[1]?.trim() ?? content,
    decision: decisionMatch?.[1]?.trim() ?? '',
  }
}

/**
 * Support Memory Service
 *
 * High-level operations for storing and retrieving support decision memories
 * with semantic search, time decay, and outcome tracking.
 */
export const SupportMemoryService = {
  /**
   * Store a new support memory
   *
   * @param input - Situation, decision, and metadata
   * @returns The created support memory
   */
  async store(input: StoreSupportMemoryInput): Promise<SupportMemory> {
    const now = new Date().toISOString()
    const collection = getCollection(input.app_slug)

    const content = formatContent(input.situation, input.decision)

    const memory: SupportMemory = {
      id: randomUUID(),
      content,
      metadata: {
        collection,
        source: 'agent',
        app_slug: input.app_slug,
        tags: input.tags ?? [],
        confidence: 1,
        created_at: now,
        votes: {
          upvotes: 0,
          downvotes: 0,
          citations: 0,
          success_rate: 0,
        },
        stage: input.stage,
        outcome: input.outcome ?? 'success',
        correction: input.correction,
        category: input.category,
        conversation_id: input.conversation_id,
      },
    }

    await upsertMemory(memory)
    return memory
  },

  /**
   * Find similar support memories by semantic search
   *
   * @param query - Search query (situation description)
   * @param options - Filters and limits
   * @returns Array of matching memories with decay-adjusted scores
   */
  async findSimilar(
    query: string,
    options: FindSimilarOptions = {}
  ): Promise<SupportSearchResult[]> {
    const {
      app_slug,
      stage,
      outcome,
      category,
      limit = 10,
      threshold = 0.5,
      include_stale = false,
    } = options

    const collection = getCollection(app_slug)

    // Build metadata filter
    const filters: string[] = []
    if (stage) filters.push(`stage = "${stage}"`)
    if (outcome) filters.push(`outcome = "${outcome}"`)
    if (category) filters.push(`category = "${category}"`)
    const filter = filters.length > 0 ? filters.join(' AND ') : undefined

    // Query vector index
    const queryResults = await queryMemories({
      query,
      collection,
      topK: limit * 2, // Over-fetch to account for confidence filtering
      filter,
    })

    // Fetch full memories and calculate scores
    const results: SupportSearchResult[] = []

    for (const result of queryResults) {
      const memory = await fetchMemory(result.id, collection)
      if (!memory) continue

      // Calculate confidence with decay
      const confidence = calculateConfidence(memory)

      // Filter low-confidence unless explicitly included
      if (!include_stale && confidence < 0.25) continue

      // Calculate age
      const createdAt = new Date(memory.metadata.created_at)
      const lastValidatedAt = memory.metadata.last_validated_at
        ? new Date(memory.metadata.last_validated_at)
        : undefined
      const referenceDate = lastValidatedAt || createdAt
      const ageDays =
        (Date.now() - referenceDate.getTime()) / (24 * 60 * 60 * 1000)
      const decayFactor = Math.pow(0.5, ageDays / 30)

      // Final score combines similarity with confidence
      const finalScore = result.score * confidence

      if (finalScore < threshold) continue

      results.push({
        memory: memory as SupportMemory,
        score: finalScore,
        raw_score: result.score,
        age_days: ageDays,
        decay_factor: decayFactor,
      })
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  },

  /**
   * Get a support memory by ID
   *
   * @param id - Memory ID
   * @param appSlug - App slug (for collection lookup)
   * @returns Memory or null if not found
   */
  async get(id: string, appSlug?: string): Promise<SupportMemory | null> {
    const collection = getCollection(appSlug)
    const memory = await fetchMemory(id, collection)
    return memory as SupportMemory | null
  },

  /**
   * Record a correction for a memory
   *
   * Sets outcome to 'corrected' and stores what should have happened.
   * Also records a downvote for the memory.
   *
   * @param id - Memory ID
   * @param appSlug - App slug
   * @param correction - What should have happened
   */
  async correct(
    id: string,
    appSlug: string | undefined,
    correction: CorrectionInput
  ): Promise<void> {
    const collection = getCollection(appSlug)
    const memory = await fetchMemory(id, collection)

    if (!memory) {
      throw new Error('Memory not found')
    }

    // Update metadata with correction
    const metadata = memory.metadata as SupportMemoryMetadata
    metadata.outcome = 'corrected'
    metadata.correction = correction.correction
    if (correction.category) {
      metadata.category = correction.category
    }

    await upsertMemory(memory)

    // Record downvote
    await VotingService.vote(id, collection, 'downvote')
  },

  /**
   * Record success outcome for a memory
   *
   * Confirms the decision was correct and records an upvote.
   *
   * @param id - Memory ID
   * @param appSlug - App slug
   */
  async recordSuccess(id: string, appSlug?: string): Promise<void> {
    const collection = getCollection(appSlug)
    const memory = await fetchMemory(id, collection)

    if (!memory) {
      throw new Error('Memory not found')
    }

    const metadata = memory.metadata as SupportMemoryMetadata
    metadata.outcome = 'success'

    await upsertMemory(memory)

    // Record upvote
    await VotingService.vote(id, collection, 'upvote')
  },

  /**
   * Record failure outcome for a memory (without correction details)
   *
   * @param id - Memory ID
   * @param appSlug - App slug
   */
  async recordFailure(id: string, appSlug?: string): Promise<void> {
    const collection = getCollection(appSlug)
    const memory = await fetchMemory(id, collection)

    if (!memory) {
      throw new Error('Memory not found')
    }

    const metadata = memory.metadata as SupportMemoryMetadata
    metadata.outcome = 'failed'

    await upsertMemory(memory)

    // Record downvote
    await VotingService.vote(id, collection, 'downvote')
  },

  /**
   * Validate a memory (reset decay clock)
   *
   * Call when human confirms memory is still accurate.
   *
   * @param id - Memory ID
   * @param appSlug - App slug
   */
  async validate(id: string, appSlug?: string): Promise<void> {
    const collection = getCollection(appSlug)
    await MemoryService.validate(id, collection)
  },

  /**
   * Delete a memory
   *
   * @param id - Memory ID
   * @param appSlug - App slug
   */
  async delete(id: string, appSlug?: string): Promise<void> {
    const collection = getCollection(appSlug)
    await MemoryService.delete(id, collection)
  },

  /**
   * Cite memories (record they were used in a decision)
   *
   * Call when memories are retrieved and used to inform a decision.
   *
   * @param memoryIds - Memory IDs that were cited
   * @param runId - Run/trace ID for tracking
   * @param appSlug - App slug
   */
  async cite(
    memoryIds: string[],
    runId: string,
    appSlug?: string
  ): Promise<void> {
    const collection = getCollection(appSlug)
    await VotingService.cite(memoryIds, runId, collection)
  },

  /**
   * Record outcome for cited memories
   *
   * Call after human review to track whether cited memories led to success.
   *
   * @param memoryIds - Memory IDs that were cited
   * @param runId - Run/trace ID
   * @param outcome - 'success' or 'failure'
   * @param appSlug - App slug
   */
  async recordCitationOutcome(
    memoryIds: string[],
    runId: string,
    outcome: 'success' | 'failure',
    appSlug?: string
  ): Promise<void> {
    const collection = getCollection(appSlug)
    await VotingService.recordOutcome(memoryIds, runId, outcome, collection)
  },

  /**
   * Parse stored content back to situation and decision
   *
   * @param content - Stored content string
   * @returns Parsed situation and decision
   */
  parseContent,

  /**
   * Format situation and decision into content string
   *
   * @param situation - Situation description
   * @param decision - Decision made
   * @returns Formatted content
   */
  formatContent,

  /**
   * Get collection name for app
   *
   * @param appSlug - App slug
   * @returns Collection name
   */
  getCollection,
}
