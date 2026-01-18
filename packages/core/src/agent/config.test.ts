import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runSupportAgent } from './config'

// Mock dependencies
vi.mock('../router/classifier', () => ({
  classifyMessage: vi.fn(),
}))

vi.mock('../trust/repository', () => ({
  getTrustScore: vi.fn(),
}))

vi.mock('../trust/score', () => ({
  shouldAutoSend: vi.fn(),
  calculateTrustScore: vi.fn((score) => score), // Pass-through for simplicity
}))

vi.mock('../vector/retrieval', () => ({
  buildAgentContext: vi.fn(async () => ({
    similarTickets: [],
    knowledge: [],
    goodResponses: [],
  })),
}))

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: 'Test response',
    steps: [],
  })),
  stepCountIs: vi.fn((n) => n),
  tool: vi.fn((def) => def),
}))

vi.mock('@skillrecordings/database', () => ({
  database: {}, // Mock database instance
}))

import { classifyMessage } from '../router/classifier'
import { getTrustScore } from '../trust/repository'
import { shouldAutoSend } from '../trust/score'

describe('runSupportAgent - auto-send integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should use real classifier and trust score for auto-send decision', async () => {
    // Arrange
    const mockClassifierResult = {
      category: 'billing' as const,
      confidence: 0.92,
      reasoning: 'Clear billing inquiry',
    }

    const mockTrustScore = {
      appId: 'total-typescript',
      category: 'billing',
      trustScore: 0.88,
      sampleCount: 120,
      lastUpdatedAt: new Date(),
      decayHalfLifeDays: 30,
    }

    vi.mocked(classifyMessage).mockResolvedValue(mockClassifierResult)
    vi.mocked(getTrustScore).mockResolvedValue(mockTrustScore)
    vi.mocked(shouldAutoSend).mockReturnValue(true)

    // Act
    const result = await runSupportAgent({
      message: 'Where is my invoice?',
      appId: 'total-typescript',
    })

    // Assert
    expect(classifyMessage).toHaveBeenCalledWith(
      'Where is my invoice?',
      expect.objectContaining({
        recentMessages: [],
      })
    )

    expect(getTrustScore).toHaveBeenCalledWith(
      expect.anything(), // db instance
      'total-typescript',
      'billing'
    )

    expect(shouldAutoSend).toHaveBeenCalledWith(
      'billing',
      0.88, // trust score
      0.92, // confidence
      120 // sample count
    )

    expect(result.autoSent).toBe(true)
    expect(result.requiresApproval).toBe(false)
  })

  it('should not auto-send when shouldAutoSend returns false', async () => {
    // Arrange
    const mockClassifierResult = {
      category: 'refund' as const,
      confidence: 0.85,
      reasoning: 'Refund request',
    }

    const mockTrustScore = {
      appId: 'total-typescript',
      category: 'refund',
      trustScore: 0.75,
      sampleCount: 50,
      lastUpdatedAt: new Date(),
      decayHalfLifeDays: 30,
    }

    vi.mocked(classifyMessage).mockResolvedValue(mockClassifierResult)
    vi.mocked(getTrustScore).mockResolvedValue(mockTrustScore)
    vi.mocked(shouldAutoSend).mockReturnValue(false)

    // Act
    const result = await runSupportAgent({
      message: 'I want a refund',
      appId: 'total-typescript',
    })

    // Assert
    expect(shouldAutoSend).toHaveBeenCalledWith('refund', 0.75, 0.85, 50)
    expect(result.autoSent).toBe(false)
  })

  it('should handle missing trust score gracefully', async () => {
    // Arrange
    const mockClassifierResult = {
      category: 'general' as const,
      confidence: 0.88,
      reasoning: 'General inquiry',
    }

    vi.mocked(classifyMessage).mockResolvedValue(mockClassifierResult)
    vi.mocked(getTrustScore).mockResolvedValue(null) // No trust score in DB
    vi.mocked(shouldAutoSend).mockReturnValue(false)

    // Act
    const result = await runSupportAgent({
      message: 'How do I access my course?',
      appId: 'total-typescript',
    })

    // Assert
    expect(shouldAutoSend).toHaveBeenCalledWith(
      'general',
      0, // fallback to 0 when no trust score
      0.88,
      0 // fallback to 0 samples
    )
    expect(result.autoSent).toBe(false)
  })
})
