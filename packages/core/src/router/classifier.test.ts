import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ClassifierResult, classifyMessage } from './classifier'

// Mock AI SDK
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

import { generateObject } from 'ai'

describe('classifyMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('classifies a refund request with high confidence', async () => {
    const mockResult: ClassifierResult = {
      category: 'refund',
      confidence: 0.95,
      reasoning: 'Customer explicitly requests refund',
      complexity: 'simple',
    }

    vi.mocked(generateObject).mockResolvedValue({
      object: mockResult,
    } as any)

    const result = await classifyMessage(
      'I want a refund for my Total TypeScript purchase'
    )

    expect(result.category).toBe('refund')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    expect(result.reasoning).toBeTruthy()
    expect(vi.mocked(generateObject)).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-haiku-4-5',
      })
    )
  })

  it('classifies technical support with medium confidence', async () => {
    const mockResult: ClassifierResult = {
      category: 'technical',
      confidence: 0.78,
      reasoning: 'User reports technical issue with product access',
      complexity: 'simple',
    }

    vi.mocked(generateObject).mockResolvedValue({
      object: mockResult,
    } as any)

    const result = await classifyMessage(
      "I can't access the videos after purchasing"
    )

    expect(result.category).toBe('technical')
    expect(result.confidence).toBeGreaterThan(0.7)
    expect(result.reasoning).toBeTruthy()
  })

  it('classifies no response needed for automated messages', async () => {
    const mockResult: ClassifierResult = {
      category: 'no_response',
      confidence: 0.92,
      reasoning: 'Automated bounce notification, no action required',
      complexity: 'skip',
    }

    vi.mocked(generateObject).mockResolvedValue({
      object: mockResult,
    } as any)

    const result = await classifyMessage(
      'This is an automated message. Your email could not be delivered.'
    )

    expect(result.category).toBe('no_response')
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('classifies human required for complex multi-issue messages', async () => {
    const mockResult: ClassifierResult = {
      category: 'human_required',
      confidence: 0.88,
      reasoning:
        'Multiple issues mentioned requiring human judgment and empathy',
      complexity: 'complex',
    }

    vi.mocked(generateObject).mockResolvedValue({
      object: mockResult,
    } as any)

    const result = await classifyMessage(
      'I bought the wrong course, need a refund, and also my team license is broken'
    )

    expect(result.category).toBe('human_required')
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('includes recent messages in context when provided', async () => {
    const mockResult: ClassifierResult = {
      category: 'billing',
      confidence: 0.85,
      reasoning: 'Follow-up on previous billing inquiry',
      complexity: 'simple',
    }

    vi.mocked(generateObject).mockResolvedValue({
      object: mockResult,
    } as any)

    await classifyMessage('What about my invoice?', {
      recentMessages: [
        'I need an invoice for my purchase',
        'Sure, let me help with that',
      ],
    })

    const call = vi.mocked(generateObject).mock.calls[0]?.[0]
    expect(call?.prompt).toContain('What about my invoice?')
    expect(call?.prompt).toContain('I need an invoice for my purchase')
  })

  it('uses structured output with Zod schema', async () => {
    const mockResult: ClassifierResult = {
      category: 'general',
      confidence: 0.72,
      reasoning: 'General inquiry about product features',
      complexity: 'simple',
    }

    vi.mocked(generateObject).mockResolvedValue({
      object: mockResult,
    } as any)

    await classifyMessage('What features does Total TypeScript have?')

    const call = vi.mocked(generateObject).mock.calls[0]?.[0] as {
      schema?: unknown
    }
    expect(call?.schema).toBeDefined()
  })

  it('validates confidence is between 0 and 1', async () => {
    const mockResult: ClassifierResult = {
      category: 'technical',
      confidence: 0.5,
      reasoning: 'Uncertain classification',
      complexity: 'complex',
    }

    vi.mocked(generateObject).mockResolvedValue({
      object: mockResult,
    } as any)

    const result = await classifyMessage('Help me')

    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  it('returns valid category from enum', async () => {
    const validCategories = [
      'needs_response',
      'no_response',
      'canned_response',
      'human_required',
      'refund',
      'transfer',
      'account_issue',
      'billing',
      'technical',
      'general',
    ]

    const mockResult: ClassifierResult = {
      category: 'account_issue',
      confidence: 0.82,
      reasoning: 'User cannot access account',
      complexity: 'simple',
    }

    vi.mocked(generateObject).mockResolvedValue({
      object: mockResult,
    } as any)

    const result = await classifyMessage('I cannot log in to my account')

    expect(validCategories).toContain(result.category)
  })

  it('returns complexity tier for model selection', async () => {
    const mockResult: ClassifierResult = {
      category: 'human_required',
      confidence: 0.9,
      reasoning: 'Frustrated customer needs careful handling',
      complexity: 'complex',
    }

    vi.mocked(generateObject).mockResolvedValue({
      object: mockResult,
    } as any)

    const result = await classifyMessage(
      'This is ridiculous! Nothing works and nobody is helping me!'
    )

    expect(result.complexity).toBe('complex')
  })
})
