/**
 * Trust score feedback loop tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordOutcome } from './feedback'
import * as repository from './repository'
import * as score from './score'

// Mock dependencies
vi.mock('./repository')
vi.mock('./score')

describe('recordOutcome', () => {
  const mockDb = {} as any
  const appId = 'total-typescript'
  const category = 'refund-simple'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update existing trust score on success', async () => {
    // Arrange
    const existingScore = {
      appId,
      category,
      trustScore: 0.8,
      sampleCount: 100,
      lastUpdatedAt: new Date(),
      decayHalfLifeDays: 30,
    }

    const updatedScore = {
      trustScore: 0.82,
      sampleCount: 101,
    }

    vi.mocked(repository.getTrustScore).mockResolvedValue(existingScore)
    vi.mocked(score.updateTrustScore).mockReturnValue(updatedScore)
    vi.mocked(repository.upsertTrustScore).mockResolvedValue()

    // Act
    await recordOutcome(mockDb, appId, category, true)

    // Assert
    expect(repository.getTrustScore).toHaveBeenCalledWith(
      mockDb,
      appId,
      category
    )
    expect(score.updateTrustScore).toHaveBeenCalledWith(0.8, 100, true)
    expect(repository.upsertTrustScore).toHaveBeenCalledWith(
      mockDb,
      appId,
      category,
      updatedScore
    )
  })

  it('should update existing trust score on failure', async () => {
    // Arrange
    const existingScore = {
      appId,
      category,
      trustScore: 0.8,
      sampleCount: 100,
      lastUpdatedAt: new Date(),
      decayHalfLifeDays: 30,
    }

    const updatedScore = {
      trustScore: 0.78,
      sampleCount: 101,
    }

    vi.mocked(repository.getTrustScore).mockResolvedValue(existingScore)
    vi.mocked(score.updateTrustScore).mockReturnValue(updatedScore)
    vi.mocked(repository.upsertTrustScore).mockResolvedValue()

    // Act
    await recordOutcome(mockDb, appId, category, false)

    // Assert
    expect(repository.getTrustScore).toHaveBeenCalledWith(
      mockDb,
      appId,
      category
    )
    expect(score.updateTrustScore).toHaveBeenCalledWith(0.8, 100, false)
    expect(repository.upsertTrustScore).toHaveBeenCalledWith(
      mockDb,
      appId,
      category,
      updatedScore
    )
  })

  it('should initialize trust score if none exists', async () => {
    // Arrange
    vi.mocked(repository.getTrustScore).mockResolvedValue(null)

    const initialScore = {
      trustScore: 1.0, // First success gives 1.0
      sampleCount: 1,
    }

    vi.mocked(score.updateTrustScore).mockReturnValue(initialScore)
    vi.mocked(repository.upsertTrustScore).mockResolvedValue()

    // Act
    await recordOutcome(mockDb, appId, category, true)

    // Assert
    expect(repository.getTrustScore).toHaveBeenCalledWith(
      mockDb,
      appId,
      category
    )
    expect(score.updateTrustScore).toHaveBeenCalledWith(0.5, 0, true)
    expect(repository.upsertTrustScore).toHaveBeenCalledWith(
      mockDb,
      appId,
      category,
      initialScore
    )
  })

  it('should handle score drift over approval sequences', async () => {
    // Arrange - simulate gradual score increase
    const scores = [
      { trustScore: 0.5, sampleCount: 0 },
      { trustScore: 0.75, sampleCount: 1 },
      { trustScore: 0.833, sampleCount: 2 },
      { trustScore: 0.875, sampleCount: 3 },
    ]

    vi.mocked(repository.getTrustScore)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        appId,
        category,
        trustScore: scores[1]!.trustScore,
        sampleCount: scores[1]!.sampleCount,
        lastUpdatedAt: new Date(),
        decayHalfLifeDays: 30,
      })
      .mockResolvedValueOnce({
        appId,
        category,
        trustScore: scores[2]!.trustScore,
        sampleCount: scores[2]!.sampleCount,
        lastUpdatedAt: new Date(),
        decayHalfLifeDays: 30,
      })

    vi.mocked(score.updateTrustScore)
      .mockReturnValueOnce(scores[1]!)
      .mockReturnValueOnce(scores[2]!)
      .mockReturnValueOnce(scores[3]!)

    vi.mocked(repository.upsertTrustScore).mockResolvedValue()

    // Act - three successful approvals
    await recordOutcome(mockDb, appId, category, true)
    await recordOutcome(mockDb, appId, category, true)
    await recordOutcome(mockDb, appId, category, true)

    // Assert - score should increase with each success
    expect(score.updateTrustScore).toHaveBeenNthCalledWith(1, 0.5, 0, true)
    expect(score.updateTrustScore).toHaveBeenNthCalledWith(2, 0.75, 1, true)
    expect(score.updateTrustScore).toHaveBeenNthCalledWith(3, 0.833, 2, true)
  })

  it('should handle score drift over rejection sequences', async () => {
    // Arrange - simulate gradual score decrease
    const existingScore = {
      appId,
      category,
      trustScore: 0.8,
      sampleCount: 100,
      lastUpdatedAt: new Date(),
      decayHalfLifeDays: 30,
    }

    const scores = [
      { trustScore: 0.792, sampleCount: 101 },
      { trustScore: 0.784, sampleCount: 102 },
    ]

    vi.mocked(repository.getTrustScore)
      .mockResolvedValueOnce(existingScore)
      .mockResolvedValueOnce({
        ...existingScore,
        trustScore: scores[0]!.trustScore,
        sampleCount: scores[0]!.sampleCount,
      })

    vi.mocked(score.updateTrustScore)
      .mockReturnValueOnce(scores[0]!)
      .mockReturnValueOnce(scores[1]!)

    vi.mocked(repository.upsertTrustScore).mockResolvedValue()

    // Act - two failed approvals
    await recordOutcome(mockDb, appId, category, false)
    await recordOutcome(mockDb, appId, category, false)

    // Assert - score should decrease with each failure
    expect(score.updateTrustScore).toHaveBeenNthCalledWith(1, 0.8, 100, false)
    expect(score.updateTrustScore).toHaveBeenNthCalledWith(2, 0.792, 101, false)
  })
})
