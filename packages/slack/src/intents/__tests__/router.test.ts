import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HELP_RESPONSE, routeIntent } from '../router'

vi.mock('../llm-classifier', () => ({
  classifyIntent: vi.fn(),
}))

import { classifyIntent } from '../llm-classifier'

describe('routeIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('classifies status queries', async () => {
    const { intent, response } = await routeIntent('anything urgent?')

    expect(intent.category).toBe('status_query')
    expect(intent.confidence).toBeGreaterThan(0.7)
    expect(intent.rawText).toBe('anything urgent?')
    expect(response).toContain('status')
    expect(vi.mocked(classifyIntent)).not.toHaveBeenCalled()
  })

  it('classifies draft actions', async () => {
    const { intent } = await routeIntent('approve and send')

    expect(intent.category).toBe('draft_action')
    expect(intent.confidence).toBeGreaterThan(0.7)
    expect(vi.mocked(classifyIntent)).not.toHaveBeenCalled()
  })

  it('classifies context lookups with email extraction', async () => {
    const { intent } = await routeIntent('history with customer@example.com')

    expect(intent.category).toBe('context_lookup')
    expect(intent.entities.email).toBe('customer@example.com')
    expect(vi.mocked(classifyIntent)).not.toHaveBeenCalled()
  })

  it('classifies escalations with name extraction', async () => {
    const { intent } = await routeIntent('escalate to Jane Doe')

    expect(intent.category).toBe('escalation')
    expect(intent.entities.name).toBe('Jane Doe')
    expect(vi.mocked(classifyIntent)).not.toHaveBeenCalled()
  })

  it('returns help response for unknown intents', async () => {
    vi.mocked(classifyIntent).mockResolvedValue({
      category: 'general_query',
      confidence: 0.2,
      entities: {},
      rawText: 'ping me later',
    })

    const { intent, response } = await routeIntent('ping me later')

    expect(intent.category).toBe('unknown')
    expect(response).toBe(HELP_RESPONSE)
  })

  it('handles empty mentions as unknown', async () => {
    const { intent, response } = await routeIntent('   ')

    expect(intent.category).toBe('unknown')
    expect(response).toBe(HELP_RESPONSE)
    expect(vi.mocked(classifyIntent)).not.toHaveBeenCalled()
  })

  it('uses LLM fallback for unknown intents', async () => {
    vi.mocked(classifyIntent).mockResolvedValue({
      category: 'general_query',
      confidence: 0.72,
      entities: { query: 'recent emails from AI Hero' },
      rawText: 'get me recent emails from ai hero',
    })

    const { intent } = await routeIntent('get me recent emails from ai hero')

    expect(intent.category).toBe('general_query')
    expect(intent.entities.query).toBe('recent emails from AI Hero')
    expect(vi.mocked(classifyIntent)).toHaveBeenCalled()
  })
})
