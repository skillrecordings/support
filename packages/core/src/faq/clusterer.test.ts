/**
 * Tests for FAQ Clusterer
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationCluster,
  FaqCandidate,
  ResolvedConversation,
} from './types'
import { FAQ_THRESHOLDS } from './types'

// Mock the vector client
vi.mock('../vector/client', () => ({
  queryVectors: vi.fn().mockResolvedValue([]),
  upsertVector: vi.fn().mockResolvedValue(undefined),
}))

describe('FAQ Clusterer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('clusterBySimilarity', () => {
    it('should return empty array for empty input', async () => {
      const { clusterBySimilarity } = await import('./clusterer')

      const result = await clusterBySimilarity([])
      expect(result).toHaveLength(0)
    })

    // This test requires OPENAI_API_KEY for computing embeddings
    it.skipIf(!process.env.OPENAI_API_KEY)(
      'should respect minClusterSize option',
      async () => {
        const { clusterBySimilarity } = await import('./clusterer')

        const conversations: ResolvedConversation[] = [
          createMockConversation('conv1', 'Question 1', 'Answer 1'),
          createMockConversation('conv2', 'Question 2', 'Answer 2'),
        ]

        // With minClusterSize of 5, no clusters should be returned
        const result = await clusterBySimilarity(conversations, {
          minClusterSize: 5,
        })
        expect(result).toHaveLength(0)
      }
    )
  })

  describe('generateCandidatesFromClusters', () => {
    it('should generate candidates from clusters', async () => {
      const { generateCandidatesFromClusters } = await import('./clusterer')

      const clusters: ConversationCluster[] = [
        {
          id: 'cluster1',
          centroid: 'How do I get a refund?',
          conversations: [
            createMockConversation(
              'conv1',
              'How do I get a refund?',
              'Request here.',
              true
            ),
            createMockConversation('conv2', 'Refund please', 'Done.', true),
            createMockConversation(
              'conv3',
              'I need a refund',
              'Processed.',
              false
            ),
          ],
          cohesion: 0.85,
          unchangedRate: 0.67,
          mostRecent: new Date(),
          oldest: new Date(Date.now() - 86400000),
        },
      ]

      const candidates = await generateCandidatesFromClusters(clusters)

      expect(candidates).toHaveLength(1)

      const candidate = candidates[0]
      expect(candidate).toBeDefined()
      expect(candidate?.question).toBe('How do I get a refund?')
      expect(candidate?.clusterSize).toBe(3)
      expect(candidate?.unchangedRate).toBeCloseTo(0.67)
      expect(candidate?.status).toBe('pending')
    })

    it('should prioritize unchanged responses for answer selection', async () => {
      const { generateCandidatesFromClusters } = await import('./clusterer')

      const unchangedAnswer = 'This is the unchanged answer'
      const editedAnswer = 'This was edited'

      const clusters: ConversationCluster[] = [
        {
          id: 'cluster1',
          centroid: 'Test question',
          conversations: [
            createMockConversation('conv1', 'Test', editedAnswer, false),
            createMockConversation('conv2', 'Test', unchangedAnswer, true),
          ],
          cohesion: 0.8,
          unchangedRate: 0.5,
          mostRecent: new Date(),
          oldest: new Date(Date.now() - 86400000),
        },
      ]

      const candidates = await generateCandidatesFromClusters(clusters)

      expect(candidates).toHaveLength(1)
      expect(candidates[0]?.answer).toBe(unchangedAnswer)
    })

    it('should calculate confidence score correctly', async () => {
      const { generateCandidatesFromClusters } = await import('./clusterer')

      const clusters: ConversationCluster[] = [
        {
          id: 'cluster1',
          centroid: 'High confidence question',
          conversations: Array(10)
            .fill(null)
            .map((_, i) =>
              createMockConversation(`conv${i}`, 'Question', 'Answer', true)
            ),
          cohesion: 0.9,
          unchangedRate: 1.0, // 100% unchanged
          mostRecent: new Date(),
          oldest: new Date(),
        },
      ]

      const candidates = await generateCandidatesFromClusters(clusters)

      expect(candidates).toHaveLength(1)
      // High cluster size (10), 100% unchanged, good cohesion = high confidence
      expect(candidates[0]?.confidence).toBeGreaterThan(0.7)
    })
  })

  describe('filterAutoSurfaceCandidates', () => {
    it('should filter candidates meeting thresholds', async () => {
      const { filterAutoSurfaceCandidates } = await import('./clusterer')

      const candidates: FaqCandidate[] = [
        createMockCandidate('c1', 3, 0.9), // Too small cluster
        createMockCandidate('c2', 5, 0.7), // Low unchanged rate
        createMockCandidate('c3', 5, 0.85), // Meets threshold!
        createMockCandidate('c4', 10, 0.95), // Exceeds threshold!
      ]

      const filtered = filterAutoSurfaceCandidates(candidates)

      expect(filtered).toHaveLength(2)
      expect(filtered.map((c) => c.id)).toContain('c3')
      expect(filtered.map((c) => c.id)).toContain('c4')
    })
  })

  describe('FAQ_THRESHOLDS', () => {
    it('should have correct default values', () => {
      expect(FAQ_THRESHOLDS.MIN_CLUSTER_SIZE).toBe(5)
      expect(FAQ_THRESHOLDS.MIN_UNCHANGED_RATE).toBe(0.8)
      expect(FAQ_THRESHOLDS.HIGH_CONFIDENCE).toBe(0.85)
      expect(FAQ_THRESHOLDS.DEFAULT_CLUSTER_THRESHOLD).toBe(0.75)
    })
  })
})

function createMockConversation(
  id: string,
  question: string,
  answer: string,
  wasUnchanged = false
): ResolvedConversation {
  return {
    conversationId: id,
    question,
    answer,
    subject: `Subject: ${question}`,
    resolvedAt: new Date(),
    appId: 'test-app',
    wasUnchanged,
    draftSimilarity: wasUnchanged ? 0.98 : 0.5,
    tags: [],
    _raw: {
      conversation: {} as any,
      messages: [],
    },
  }
}

function createMockCandidate(
  id: string,
  clusterSize: number,
  unchangedRate: number
): FaqCandidate {
  return {
    id,
    question: 'Test question',
    answer: 'Test answer',
    clusterId: `cluster-${id}`,
    clusterSize,
    unchangedRate,
    confidence: 0.8,
    tags: [],
    subjectPatterns: [],
    sourceConversationIds: [],
    generatedAt: new Date(),
    status: 'pending',
  }
}
