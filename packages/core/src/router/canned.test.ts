import { beforeEach, describe, expect, it, vi } from 'vitest'
import { interpolateTemplate, matchCannedResponse } from './canned'

// Mock the vector client
const mockQueryVectors = vi.hoisted(() => vi.fn())
vi.mock('../vector/client', () => ({
  queryVectors: mockQueryVectors,
}))

describe('canned response matching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('matchCannedResponse', () => {
    it('returns no match when similarity is below threshold', async () => {
      mockQueryVectors.mockResolvedValue([
        {
          id: 'resp-1',
          score: 0.85,
          data: 'Thanks for reaching out about refunds...',
          metadata: {
            type: 'response',
            appId: 'totaltypescript',
            category: 'refund',
          },
        },
      ])

      const result = await matchCannedResponse(
        'I want my money back',
        'totaltypescript',
        0.92
      )

      expect(result.matched).toBe(false)
      expect(result.response).toBeUndefined()
      expect(result.templateId).toBeUndefined()
      expect(mockQueryVectors).toHaveBeenCalledWith({
        data: 'I want my money back',
        topK: 1,
        includeMetadata: true,
        includeData: true,
        filter: 'appId = "totaltypescript" AND type = "response"',
      })
    })

    it('returns match when similarity exceeds threshold', async () => {
      mockQueryVectors.mockResolvedValue([
        {
          id: 'resp-refund-standard',
          score: 0.95,
          data: 'I understand you would like a refund. I can help with that.',
          metadata: {
            type: 'response',
            appId: 'totaltypescript',
            category: 'refund',
          },
        },
      ])

      const result = await matchCannedResponse(
        'Can I get a refund please?',
        'totaltypescript'
      )

      expect(result.matched).toBe(true)
      expect(result.response).toBe(
        'I understand you would like a refund. I can help with that.'
      )
      expect(result.templateId).toBe('resp-refund-standard')
      expect(result.similarity).toBe(0.95)
    })

    it('uses default threshold of 0.92', async () => {
      mockQueryVectors.mockResolvedValue([
        {
          id: 'resp-1',
          score: 0.93,
          data: 'Canned response',
          metadata: {
            type: 'response',
            appId: 'test',
          },
        },
      ])

      const result = await matchCannedResponse('test message', 'test')

      expect(result.matched).toBe(true)
    })

    it('handles no results from vector search', async () => {
      mockQueryVectors.mockResolvedValue([])

      const result = await matchCannedResponse('test', 'app')

      expect(result.matched).toBe(false)
    })

    it('handles results without data', async () => {
      mockQueryVectors.mockResolvedValue([
        {
          id: 'resp-1',
          score: 0.95,
          metadata: { type: 'response', appId: 'app' },
        },
      ])

      const result = await matchCannedResponse('test', 'app')

      expect(result.matched).toBe(false)
    })

    it('filters by appId and type=response', async () => {
      mockQueryVectors.mockResolvedValue([])

      await matchCannedResponse('test', 'totaltypescript', 0.9)

      expect(mockQueryVectors).toHaveBeenCalledWith({
        data: 'test',
        topK: 1,
        includeMetadata: true,
        includeData: true,
        filter: 'appId = "totaltypescript" AND type = "response"',
      })
    })
  })

  describe('interpolateTemplate', () => {
    it('replaces single variable', () => {
      const template = 'Hello {{customer_name}}!'
      const result = interpolateTemplate(template, {
        customer_name: 'Alice',
      })
      expect(result).toBe('Hello Alice!')
    })

    it('replaces multiple variables', () => {
      const template =
        'Hi {{customer_name}}, thanks for purchasing {{product_name}}.'
      const result = interpolateTemplate(template, {
        customer_name: 'Bob',
        product_name: 'Total TypeScript',
      })
      expect(result).toBe('Hi Bob, thanks for purchasing Total TypeScript.')
    })

    it('preserves template syntax for missing variables', () => {
      const template = 'Hello {{customer_name}}, code: {{voucher_code}}'
      const result = interpolateTemplate(template, {
        customer_name: 'Charlie',
      })
      expect(result).toBe('Hello Charlie, code: {{voucher_code}}')
    })

    it('handles templates with no variables', () => {
      const template = 'This is a plain text response.'
      const result = interpolateTemplate(template, {})
      expect(result).toBe('This is a plain text response.')
    })

    it('handles repeated variables', () => {
      const template = '{{name}} and {{name}} again'
      const result = interpolateTemplate(template, { name: 'Echo' })
      expect(result).toBe('Echo and Echo again')
    })

    it('ignores variables not in template', () => {
      const template = 'Hello {{name}}'
      const result = interpolateTemplate(template, {
        name: 'Dave',
        unused: 'value',
      })
      expect(result).toBe('Hello Dave')
    })
  })
})
