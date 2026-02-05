import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyIntent } from '../llm-classifier'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

import { generateObject } from 'ai'

describe('classifyIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('classifies general queries with product extraction', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        category: 'general_query',
        confidence: 0.76,
        entities: {
          product: 'AI Hero',
        },
        reasoning: 'Asks for recent emails about AI Hero',
      },
    } as any)

    const result = await classifyIntent('get me recent emails from ai hero')

    expect(result.category).toBe('general_query')
    expect(result.entities.product).toBe('AI Hero')
    expect(result.confidence).toBeGreaterThan(0.7)
    expect(vi.mocked(generateObject)).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-haiku-4-5',
      })
    )
  })

  it('classifies general queries with search terms', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        category: 'general_query',
        confidence: 0.71,
        entities: {
          query: 'refund requests today',
        },
        reasoning: 'Searching for refund requests',
      },
    } as any)

    const result = await classifyIntent('what refund requests came in today')

    expect(result.category).toBe('general_query')
    expect(result.entities.query).toBe('refund requests today')
  })

  it('returns low confidence for unclear input', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        category: 'general_query',
        confidence: 0.2,
        entities: {},
        reasoning: 'Unclear message',
      },
    } as any)

    const result = await classifyIntent('asdf qwer zxcv')

    expect(result.confidence).toBeLessThanOrEqual(0.3)
  })
})
