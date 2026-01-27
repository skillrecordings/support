/**
 * Tests for template matching module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatherOutput } from '../pipeline/types'
import {
  buildTemplateVariables,
  createTemplateUsageLog,
  findUnresolvedVariables,
  interpolateTemplate,
  matchTemplate,
} from './match'

// Mock the vector client
vi.mock('../vector/client', () => ({
  queryVectors: vi.fn(),
}))

import { queryVectors } from '../vector/client'

const mockQueryVectors = vi.mocked(queryVectors)

describe('matchTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mockContext: GatherOutput = {
    user: { id: 'user-1', email: '[EMAIL]', name: 'Test User' },
    purchases: [
      {
        id: 'purchase-1',
        productId: 'prod-1',
        productName: 'Total TypeScript',
        purchasedAt: '2024-01-01',
        status: 'active',
      },
    ],
    knowledge: [],
    history: [],
    priorMemory: [],
    priorConversations: [],
    gatherErrors: [],
  }

  it('should return match when score exceeds threshold', async () => {
    mockQueryVectors.mockResolvedValue([
      {
        id: 'front_template_tmp_123',
        score: 0.95,
        data: 'Hi {{customer_name}}, click here to access your course.',
        metadata: {
          type: 'response',
          appId: 'total-typescript',
          source: 'canned-response',
          title: 'Access Issue Response',
        },
      },
    ])

    const result = await matchTemplate({
      appId: 'total-typescript',
      category: 'support_access',
      context: mockContext,
      query: 'I cannot access my course',
      threshold: 0.9,
    })

    expect(result.match).not.toBeNull()
    expect(result.match?.templateId).toBe('front_template_tmp_123')
    expect(result.match?.frontId).toBe('tmp_123')
    expect(result.match?.confidence).toBe(0.95)
    expect(result.match?.name).toBe('Access Issue Response')
    expect(result.candidates).toHaveLength(1)
  })

  it('should return null when no match exceeds threshold', async () => {
    mockQueryVectors.mockResolvedValue([
      {
        id: 'front_template_tmp_123',
        score: 0.85, // Below 0.9 threshold
        data: 'Some template content',
        metadata: {
          type: 'response',
          appId: 'total-typescript',
          source: 'canned-response',
          title: 'Some Template',
        },
      },
    ])

    const result = await matchTemplate({
      appId: 'total-typescript',
      category: 'support_access',
      context: mockContext,
      query: 'Random question',
      threshold: 0.9,
    })

    expect(result.match).toBeNull()
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.score).toBe(0.85)
  })

  it('should use correct filter for vector query', async () => {
    mockQueryVectors.mockResolvedValue([])

    await matchTemplate({
      appId: 'total-typescript',
      category: 'support_access',
      context: mockContext,
      query: 'test query',
    })

    expect(mockQueryVectors).toHaveBeenCalledWith({
      data: 'test query',
      topK: 5,
      includeMetadata: true,
      includeData: true,
      filter:
        "type = 'response' AND source = 'canned-response' AND appId = 'total-typescript'",
    })
  })

  it('should handle empty results', async () => {
    mockQueryVectors.mockResolvedValue([])

    const result = await matchTemplate({
      appId: 'total-typescript',
      category: 'support_access',
      context: mockContext,
      query: 'unique query',
    })

    expect(result.match).toBeNull()
    expect(result.candidates).toHaveLength(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('interpolateTemplate', () => {
  it('should replace known variables', () => {
    const template = 'Hi {{customer_name}}, your {{product_name}} is ready.'
    const result = interpolateTemplate(template, {
      customer_name: 'Joel',
      product_name: 'Total TypeScript',
    })

    expect(result).toBe('Hi Joel, your Total TypeScript is ready.')
  })

  it('should handle variables with whitespace', () => {
    const template = 'Hi {{ customer_name }}, thanks!'
    const result = interpolateTemplate(template, { customer_name: 'Joel' })

    expect(result).toBe('Hi Joel, thanks!')
  })

  it('should leave unknown variables as-is', () => {
    const template = 'Hi {{customer_name}}, your {{unknown_var}} is ready.'
    const result = interpolateTemplate(template, { customer_name: 'Joel' })

    expect(result).toBe('Hi Joel, your {{unknown_var}} is ready.')
  })

  it('should handle empty variables object', () => {
    const template = 'Hi {{customer_name}}!'
    const result = interpolateTemplate(template, {})

    expect(result).toBe('Hi {{customer_name}}!')
  })

  it('should handle template with no variables', () => {
    const template = 'This is a plain template.'
    const result = interpolateTemplate(template, { customer_name: 'Joel' })

    expect(result).toBe('This is a plain template.')
  })

  it('should handle undefined values', () => {
    const template = 'Hi {{customer_name}}, email: {{email}}'
    const result = interpolateTemplate(template, {
      customer_name: 'Joel',
      email: undefined,
    })

    expect(result).toBe('Hi Joel, email: {{email}}')
  })
})

describe('buildTemplateVariables', () => {
  it('should extract variables from context with user and purchases', () => {
    const context: GatherOutput = {
      user: { id: 'u1', email: '[EMAIL]', name: 'Joel' },
      purchases: [
        {
          id: 'p1',
          productId: 'prod-1',
          productName: 'Total TypeScript',
          purchasedAt: '2024-01-01',
          status: 'active',
        },
      ],
      knowledge: [],
      history: [],
      priorMemory: [],
      priorConversations: [],
      gatherErrors: [],
    }

    const vars = buildTemplateVariables(context)

    expect(vars.customer_name).toBe('Joel')
    expect(vars.email).toBe('[EMAIL]')
    expect(vars.product_name).toBe('Total TypeScript')
  })

  it('should handle missing user', () => {
    const context: GatherOutput = {
      user: null,
      purchases: [],
      knowledge: [],
      history: [],
      priorMemory: [],
      priorConversations: [],
      gatherErrors: [],
    }

    const vars = buildTemplateVariables(context)

    expect(vars.customer_name).toBeUndefined()
    expect(vars.email).toBeUndefined()
    expect(vars.product_name).toBeUndefined()
  })

  it('should handle empty purchases', () => {
    const context: GatherOutput = {
      user: { id: 'u1', email: '[EMAIL]', name: 'Test' },
      purchases: [],
      knowledge: [],
      history: [],
      priorMemory: [],
      priorConversations: [],
      gatherErrors: [],
    }

    const vars = buildTemplateVariables(context)

    expect(vars.product_name).toBeUndefined()
  })
})

describe('findUnresolvedVariables', () => {
  it('should find unresolved variables', () => {
    const content = 'Hi {{customer_name}}, your {{product_name}} is ready.'
    const unresolved = findUnresolvedVariables(content)

    expect(unresolved).toEqual(['customer_name', 'product_name'])
  })

  it('should return empty array for resolved content', () => {
    const content = 'Hi Joel, your Total TypeScript is ready.'
    const unresolved = findUnresolvedVariables(content)

    expect(unresolved).toEqual([])
  })

  it('should handle mixed resolved and unresolved', () => {
    const content = 'Hi Joel, your {{product_name}} is ready.'
    const unresolved = findUnresolvedVariables(content)

    expect(unresolved).toEqual(['product_name'])
  })
})

describe('createTemplateUsageLog', () => {
  it('should create log for template match', () => {
    const log = createTemplateUsageLog('total-typescript', 'support_access', {
      templateId: 'front_template_123',
      content: 'template content',
      name: 'Access Response',
      confidence: 0.95,
      frontId: 'tmp_123',
    })

    expect(log.type).toBe('template_match')
    expect(log.templateId).toBe('front_template_123')
    expect(log.templateName).toBe('Access Response')
    expect(log.confidence).toBe(0.95)
    expect(log.appId).toBe('total-typescript')
    expect(log.category).toBe('support_access')
    expect(log.timestamp).toBeGreaterThan(0)
  })

  it('should create log for LLM generation', () => {
    const log = createTemplateUsageLog(
      'total-typescript',
      'support_access',
      null
    )

    expect(log.type).toBe('llm_generation')
    expect(log.templateId).toBeUndefined()
    expect(log.templateName).toBeUndefined()
    expect(log.appId).toBe('total-typescript')
    expect(log.category).toBe('support_access')
  })
})
