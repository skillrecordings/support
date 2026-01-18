import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouterDecision, RoutingContext } from '../router/message-router'
import { evalRouting } from './routing'
import type { EvalDatapoint, EvalGates } from './types'

// Mock the router
vi.mock('../router/message-router', () => ({
  routeMessage: vi.fn(),
}))

import { routeMessage } from '../router/message-router'

describe('evalRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return an EvalReport with required fields', async () => {
    // ARRANGE
    const mockRouteMessage = vi.mocked(routeMessage)
    mockRouteMessage.mockResolvedValue({
      route: 'rule',
      reason: 'Matched rule',
      confidence: 1.0,
      category: 'refund',
      ruleId: 'rule-1',
    })

    const dataset: EvalDatapoint[] = [
      {
        message: 'I want a refund',
        expectedCategory: 'refund',
        expectedRoute: 'rule',
      },
    ]

    // ACT
    const report = await evalRouting(dataset)

    // ASSERT
    expect(report).toHaveProperty('precision')
    expect(report).toHaveProperty('recall')
    expect(report).toHaveProperty('fpRate')
    expect(report).toHaveProperty('fnRate')
    expect(report).toHaveProperty('byCategory')
    expect(report).toHaveProperty('cost')
    expect(report).toHaveProperty('latency')
    expect(report).toHaveProperty('passed')
  })

  it('should calculate perfect precision and recall for all correct predictions', async () => {
    // ARRANGE
    const mockRouteMessage = vi.mocked(routeMessage)
    mockRouteMessage.mockResolvedValueOnce({
      route: 'rule',
      reason: 'Matched rule',
      confidence: 1.0,
      category: 'refund',
      ruleId: 'rule-1',
    })
    mockRouteMessage.mockResolvedValueOnce({
      route: 'canned',
      reason: 'Matched canned',
      confidence: 0.9,
      category: 'account',
      cannedResponseId: 'canned-1',
    })

    const dataset: EvalDatapoint[] = [
      {
        message: 'I want a refund',
        expectedCategory: 'refund',
        expectedRoute: 'rule',
      },
      {
        message: 'How do I reset my password?',
        expectedCategory: 'account',
        expectedRoute: 'canned',
      },
    ]

    // ACT
    const report = await evalRouting(dataset)

    // ASSERT
    expect(report.precision).toBe(1.0)
    expect(report.recall).toBe(1.0)
    expect(report.fpRate).toBe(0.0)
    expect(report.fnRate).toBe(0.0)
    expect(report.passed).toBe(true)
  })

  it('should calculate precision and recall with false positives', async () => {
    // ARRANGE
    const mockRouteMessage = vi.mocked(routeMessage)

    // Correct prediction
    mockRouteMessage.mockResolvedValueOnce({
      route: 'rule',
      reason: 'Matched rule',
      confidence: 1.0,
      category: 'refund',
      ruleId: 'rule-1',
    })

    // False positive - should be 'agent' but got 'canned'
    mockRouteMessage.mockResolvedValueOnce({
      route: 'canned',
      reason: 'Matched canned',
      confidence: 0.9,
      category: 'support',
      cannedResponseId: 'canned-1',
    })

    const dataset: EvalDatapoint[] = [
      {
        message: 'I want a refund',
        expectedCategory: 'refund',
        expectedRoute: 'rule',
      },
      {
        message: 'Complex custom question',
        expectedCategory: 'support',
        expectedRoute: 'agent',
      },
    ]

    // Disable gates for this test - we're testing metric calculation only
    const gates: EvalGates = {
      minPrecision: 0,
      minRecall: 0,
      maxFpRate: 1,
      maxFnRate: 1,
    }

    // ACT
    const report = await evalRouting(dataset, gates)

    // ASSERT
    // 1 TP (refund correct), 1 FP (canned when should be agent), 0 FN, 0 TN
    // Precision = TP / (TP + FP) = 1 / 2 = 0.5
    // Recall = TP / (TP + FN) = 1 / 1 = 1.0
    // FP rate = FP / (FP + TN) = 1 / (1 + 0) = 1.0 (no true negatives in this dataset)
    expect(report.precision).toBe(0.5)
    expect(report.recall).toBe(1.0)
    expect(report.fpRate).toBe(1.0)
  })

  it('should throw when precision gate fails', async () => {
    // ARRANGE
    const mockRouteMessage = vi.mocked(routeMessage)
    mockRouteMessage.mockResolvedValue({
      route: 'canned',
      reason: 'Matched canned',
      confidence: 0.9,
      category: 'support',
      cannedResponseId: 'canned-1',
    })

    const dataset: EvalDatapoint[] = [
      {
        message: 'Complex question',
        expectedCategory: 'support',
        expectedRoute: 'agent',
      },
    ]

    const gates: EvalGates = {
      minPrecision: 0.92,
    }

    // ACT & ASSERT
    await expect(evalRouting(dataset, gates)).rejects.toThrow(
      /precision.*below threshold/i
    )
  })

  it('should throw when recall gate fails', async () => {
    // ARRANGE
    const mockRouteMessage = vi.mocked(routeMessage)

    // False negative - should respond but didn't
    mockRouteMessage.mockResolvedValue({
      route: 'classifier',
      reason: 'No response needed',
      confidence: 0.8,
      category: 'none',
    })

    const dataset: EvalDatapoint[] = [
      {
        message: 'I need help',
        expectedCategory: 'support',
        expectedRoute: 'agent',
      },
    ]

    const gates: EvalGates = {
      minPrecision: 0, // Disable precision gate
      minRecall: 0.95,
    }

    // ACT & ASSERT
    await expect(evalRouting(dataset, gates)).rejects.toThrow(
      /recall.*below threshold/i
    )
  })

  it('should provide per-category breakdown', async () => {
    // ARRANGE
    const mockRouteMessage = vi.mocked(routeMessage)
    mockRouteMessage.mockResolvedValueOnce({
      route: 'rule',
      confidence: 1.0,
      category: 'refund',
      reason: 'Matched',
      ruleId: 'r1',
    })
    mockRouteMessage.mockResolvedValueOnce({
      route: 'canned',
      confidence: 0.9,
      category: 'account',
      reason: 'Matched',
      cannedResponseId: 'c1',
    })

    const dataset: EvalDatapoint[] = [
      {
        message: 'refund please',
        expectedCategory: 'refund',
        expectedRoute: 'rule',
      },
      {
        message: 'reset password',
        expectedCategory: 'account',
        expectedRoute: 'canned',
      },
    ]

    // ACT
    const report = await evalRouting(dataset)

    // ASSERT
    expect(report.byCategory).toHaveProperty('refund')
    expect(report.byCategory).toHaveProperty('account')
    expect(report.byCategory['refund']?.precision).toBe(1.0)
    expect(report.byCategory['account']?.precision).toBe(1.0)
  })

  it('should track cost and latency metrics', async () => {
    // ARRANGE
    const mockRouteMessage = vi.mocked(routeMessage)
    mockRouteMessage.mockResolvedValue({
      route: 'classifier',
      confidence: 0.8,
      category: 'support',
      reason: 'Classified',
    })

    const dataset: EvalDatapoint[] = [
      {
        message: 'test',
        expectedCategory: 'support',
        expectedRoute: 'classifier',
      },
    ]

    // ACT
    const report = await evalRouting(dataset)

    // ASSERT
    expect(report.cost.tokens).toBeGreaterThan(0)
    expect(report.cost.estimatedUsd).toBeGreaterThan(0)
    expect(report.latency.p50).toBeGreaterThanOrEqual(0)
    expect(report.latency.p95).toBeGreaterThanOrEqual(0)
    expect(report.latency.p99).toBeGreaterThanOrEqual(0)
  })

  it('should pass when all gates are satisfied', async () => {
    // ARRANGE
    const mockRouteMessage = vi.mocked(routeMessage)
    mockRouteMessage.mockResolvedValue({
      route: 'rule',
      confidence: 1.0,
      category: 'refund',
      reason: 'Matched',
      ruleId: 'r1',
    })

    const dataset: EvalDatapoint[] = [
      { message: 'refund', expectedCategory: 'refund', expectedRoute: 'rule' },
    ]

    const gates: EvalGates = {
      minPrecision: 0.92,
      minRecall: 0.95,
      maxFpRate: 0.03,
      maxFnRate: 0.02,
    }

    // ACT
    const report = await evalRouting(dataset, gates)

    // ASSERT
    expect(report.passed).toBe(true)
  })
})
