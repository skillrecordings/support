import type { Memory } from './schemas'

/**
 * Half-life for memory decay in days
 */
export const DECAY_HALF_LIFE_DAYS = 30

/**
 * Calculate exponential decay based on memory age
 *
 * Uses 30-day half-life: decay = 0.5^(age_days / 30)
 *
 * @param createdAt - When the memory was created
 * @param lastValidatedAt - Optional validation timestamp that resets the decay clock
 * @returns Decay factor between 0 and 1 (1 = brand new, 0.5 = half-life, etc.)
 */
export function calculateDecay(
  createdAt: Date,
  lastValidatedAt?: Date
): number {
  const referenceDate = lastValidatedAt || createdAt
  const ageDays = (Date.now() - referenceDate.getTime()) / (24 * 60 * 60 * 1000)
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS)
}

/**
 * Calculate confidence score for a memory
 *
 * Combines time-based decay with reputation score from votes and citations.
 * Formula: decay * reputation
 *
 * Reputation calculation:
 * - Vote score: (upvotes - downvotes) / total_votes (30% weight)
 * - Citation score: success_rate when citations > 0, else 0.5 neutral (70% weight)
 * - Reputation weight: scales from 0 to 1 based on total interactions (capped at 10)
 *
 * @param memory - Memory record with metadata and votes
 * @returns Confidence score between 0 and 1
 */
export function calculateConfidence(memory: Memory): number {
  const decay = calculateDecay(
    new Date(memory.metadata.created_at),
    memory.metadata.last_validated_at
      ? new Date(memory.metadata.last_validated_at)
      : undefined
  )

  const votes = memory.metadata.votes

  // Reputation score based on outcomes
  const totalVotes = votes.upvotes + votes.downvotes
  const voteScore =
    totalVotes > 0 ? (votes.upvotes - votes.downvotes) / totalVotes : 0

  // Citation success matters most
  const citationScore = votes.citations > 0 ? votes.success_rate : 0.5 // Neutral for uncited

  // Combine: decay * weighted(votes, citations)
  const reputationWeight = Math.min(totalVotes + votes.citations, 10) / 10
  const reputation =
    (voteScore * 0.3 + citationScore * 0.7) * reputationWeight +
    (1 - reputationWeight) * 0.5

  return decay * reputation
}
