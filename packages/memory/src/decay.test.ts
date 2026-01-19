import { describe, expect, it } from 'vitest'
import {
  DECAY_HALF_LIFE_DAYS,
  calculateConfidence,
  calculateDecay,
} from './decay'
import type { Memory } from './schemas'

describe('calculateDecay', () => {
  it('should return 1.0 for brand new memory (0 days old)', () => {
    const now = new Date()
    const decay = calculateDecay(now)
    expect(decay).toBeCloseTo(1.0, 5)
  })

  it('should return 0.5 for memory at half-life (30 days)', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const decay = calculateDecay(thirtyDaysAgo)
    expect(decay).toBeCloseTo(0.5, 5)
  })

  it('should return 0.25 for memory at double half-life (60 days)', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const decay = calculateDecay(sixtyDaysAgo)
    expect(decay).toBeCloseTo(0.25, 5)
  })

  it('should return 0.125 for memory at triple half-life (90 days)', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const decay = calculateDecay(ninetyDaysAgo)
    expect(decay).toBeCloseTo(0.125, 5)
  })

  it('should use lastValidatedAt when provided, resetting the clock', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // With validation, age is only 30 days
    const decayWithValidation = calculateDecay(sixtyDaysAgo, thirtyDaysAgo)
    expect(decayWithValidation).toBeCloseTo(0.5, 5)

    // Without validation, age is 60 days
    const decayWithoutValidation = calculateDecay(sixtyDaysAgo)
    expect(decayWithoutValidation).toBeCloseTo(0.25, 5)
  })

  it('should handle fractional days correctly', () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
    const decay = calculateDecay(fifteenDaysAgo)
    // 15 days = 0.5 half-lives, so decay = 2^(-0.5) = ~0.707
    expect(decay).toBeCloseTo(0.7071, 4)
  })

  it('should export DECAY_HALF_LIFE_DAYS constant', () => {
    expect(DECAY_HALF_LIFE_DAYS).toBe(30)
  })
})

describe('calculateConfidence', () => {
  const createMemory = (
    createdAt: Date,
    votes: {
      upvotes: number
      downvotes: number
      citations: number
      success_rate: number
    },
    lastValidatedAt?: Date
  ): Memory => ({
    id: 'test-memory-id',
    content: 'Test memory content',
    metadata: {
      collection: 'test',
      tags: [],
      source: 'agent' as const,
      confidence: 1,
      created_at: createdAt.toISOString(),
      last_validated_at: lastValidatedAt?.toISOString(),
      votes,
    },
  })

  it('should return decay * 0.5 for memory with no votes or citations (neutral)', () => {
    const now = new Date()
    const memory = createMemory(now, {
      upvotes: 0,
      downvotes: 0,
      citations: 0,
      success_rate: 0,
    })

    const confidence = calculateConfidence(memory)
    // decay = 1.0, reputation = 0.5 (neutral)
    expect(confidence).toBeCloseTo(0.5, 5)
  })

  it('should increase confidence with positive votes', () => {
    const now = new Date()
    const memory = createMemory(now, {
      upvotes: 5,
      downvotes: 0,
      citations: 0,
      success_rate: 0,
    })

    const confidence = calculateConfidence(memory)
    // decay = 1.0, voteScore = 1.0, reputationWeight = 5/10 = 0.5
    // reputation = (1.0 * 0.3 + 0.5 * 0.7) * 0.5 + 0.5 * 0.5 = 0.575
    expect(confidence).toBeGreaterThan(0.5)
    expect(confidence).toBeCloseTo(0.575, 3)
  })

  it('should decrease confidence with negative votes', () => {
    const now = new Date()
    const memory = createMemory(now, {
      upvotes: 0,
      downvotes: 5,
      citations: 0,
      success_rate: 0,
    })

    const confidence = calculateConfidence(memory)
    // voteScore = -1.0, reputationWeight = 5/10 = 0.5
    // reputation = (-1.0 * 0.3 + 0.5 * 0.7) * 0.5 + 0.5 * 0.5 = 0.275
    expect(confidence).toBeLessThan(0.5)
    expect(confidence).toBeCloseTo(0.275, 3)
  })

  it('should weight citations heavily (70% vs 30% for votes)', () => {
    const now = new Date()

    const highVotes = createMemory(now, {
      upvotes: 10,
      downvotes: 0,
      citations: 0,
      success_rate: 0,
    })

    const highCitations = createMemory(now, {
      upvotes: 0,
      downvotes: 0,
      citations: 10,
      success_rate: 1.0,
    })

    const confidenceVotes = calculateConfidence(highVotes)
    const confidenceCitations = calculateConfidence(highCitations)

    // Citations should have more impact than votes
    expect(confidenceCitations).toBeGreaterThan(confidenceVotes)
  })

  it('should handle mixed votes correctly', () => {
    const now = new Date()
    const memory = createMemory(now, {
      upvotes: 3,
      downvotes: 2,
      citations: 0,
      success_rate: 0,
    })

    const confidence = calculateConfidence(memory)
    // voteScore = (3-2)/(3+2) = 0.2
    // reputationWeight = 5/10 = 0.5
    // reputation = (0.2 * 0.3 + 0.5 * 0.7) * 0.5 + 0.5 * 0.5 = 0.455
    expect(confidence).toBeCloseTo(0.455, 3)
  })

  it('should cap reputation weight at 10 total interactions', () => {
    const now = new Date()

    const tenInteractions = createMemory(now, {
      upvotes: 10,
      downvotes: 0,
      citations: 0,
      success_rate: 0,
    })

    const twentyInteractions = createMemory(now, {
      upvotes: 20,
      downvotes: 0,
      citations: 0,
      success_rate: 0,
    })

    const conf10 = calculateConfidence(tenInteractions)
    const conf20 = calculateConfidence(twentyInteractions)

    // Both should have full reputation weight (1.0)
    expect(conf10).toBeCloseTo(conf20, 5)
  })

  it('should combine decay with reputation', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const memory = createMemory(thirtyDaysAgo, {
      upvotes: 10,
      downvotes: 0,
      citations: 10,
      success_rate: 1.0,
    })

    const confidence = calculateConfidence(memory)
    // decay = 0.5 (30 days)
    // reputationWeight = 1.0 (capped at 10)
    // voteScore = 1.0, citationScore = 1.0
    // reputation = (1.0 * 0.3 + 1.0 * 0.7) * 1.0 = 1.0
    // confidence = 0.5 * 1.0 = 0.5
    expect(confidence).toBeCloseTo(0.5, 5)
  })

  it('should use success_rate as citationScore when citations exist', () => {
    const now = new Date()

    const highSuccess = createMemory(now, {
      upvotes: 0,
      downvotes: 0,
      citations: 5,
      success_rate: 0.9,
    })

    const lowSuccess = createMemory(now, {
      upvotes: 0,
      downvotes: 0,
      citations: 5,
      success_rate: 0.2,
    })

    const confHigh = calculateConfidence(highSuccess)
    const confLow = calculateConfidence(lowSuccess)

    expect(confHigh).toBeGreaterThan(confLow)
  })

  it('should handle edge case: all downvotes, no citations', () => {
    const now = new Date()
    const memory = createMemory(now, {
      upvotes: 0,
      downvotes: 10,
      citations: 0,
      success_rate: 0,
    })

    const confidence = calculateConfidence(memory)
    // voteScore = -1.0, reputationWeight = 1.0
    // reputation = (-1.0 * 0.3 + 0.5 * 0.7) * 1.0 = 0.05
    expect(confidence).toBeLessThan(0.5)
    expect(confidence).toBeCloseTo(0.05, 2)
  })

  it('should handle edge case: high citations with low success rate', () => {
    const now = new Date()
    const memory = createMemory(now, {
      upvotes: 0,
      downvotes: 0,
      citations: 10,
      success_rate: 0.1,
    })

    const confidence = calculateConfidence(memory)
    // citationScore = 0.1, reputationWeight = 1.0
    // reputation = (0 * 0.3 + 0.1 * 0.7) * 1.0 = 0.07
    expect(confidence).toBeLessThan(0.5)
    expect(confidence).toBeCloseTo(0.07, 2)
  })

  it('should handle lastValidatedAt resetting decay clock', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const now = new Date()

    const memory = createMemory(
      sixtyDaysAgo,
      {
        upvotes: 10,
        downvotes: 0,
        citations: 10,
        success_rate: 1.0,
      },
      now
    )

    const confidence = calculateConfidence(memory)
    // decay = 1.0 (just validated), reputation = 1.0
    expect(confidence).toBeCloseTo(1.0, 5)
  })
})
