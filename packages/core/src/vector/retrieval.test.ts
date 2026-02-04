import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from './client'
import * as redact from './redact'
import { buildAgentContext } from './retrieval'
import type { VectorQueryResult } from './types'

vi.mock('./client', () => ({
  queryVectors: vi.fn(),
}))
vi.mock('./redact', () => ({
  redactPII: vi.fn(),
}))

describe('buildAgentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should redact PII from query before searching', async () => {
    const redactPIISpy = vi
      .spyOn(redact, 'redactPII')
      .mockReturnValue('redacted query')
    vi.spyOn(client, 'queryVectors').mockResolvedValue([])

    await buildAgentContext({
      appId: 'test-app',
      query: '[EMAIL] had an issue',
    })

    expect(redactPIISpy).toHaveBeenCalledWith('[EMAIL] had an issue', [])
  })

  it('should redact customer email from known names', async () => {
    const redactPIISpy = vi
      .spyOn(redact, 'redactPII')
      .mockReturnValue('redacted query')
    vi.spyOn(client, 'queryVectors').mockResolvedValue([])

    await buildAgentContext({
      appId: 'test-app',
      query: 'Customer John Smith contacted us',
      customerEmail: 'john.smith@example.com',
    })

    expect(redactPIISpy).toHaveBeenCalledWith(
      'Customer John Smith contacted us',
      ['john.smith']
    )
  })

  it('should query vectors with hybrid search and appId filter', async () => {
    vi.spyOn(redact, 'redactPII').mockReturnValue('redacted query')
    const queryVectorsSpy = vi
      .spyOn(client, 'queryVectors')
      .mockResolvedValue([])

    await buildAgentContext({
      appId: 'test-app',
      query: 'test query',
      limit: 10,
    })

    expect(queryVectorsSpy).toHaveBeenCalledWith({
      data: 'redacted query',
      topK: 10,
      includeMetadata: true,
      includeData: true,
      filter: 'appId = "test-app"',
    })
  })

  it('should use default limit of 20 when not specified', async () => {
    vi.spyOn(redact, 'redactPII').mockReturnValue('redacted query')
    const queryVectorsSpy = vi
      .spyOn(client, 'queryVectors')
      .mockResolvedValue([])

    await buildAgentContext({
      appId: 'test-app',
      query: 'test query',
    })

    expect(queryVectorsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        topK: 20,
      })
    )
  })

  it('should separate results by documentType', async () => {
    vi.spyOn(redact, 'redactPII').mockReturnValue('redacted query')

    const mockResults: VectorQueryResult[] = [
      {
        id: 'conv-1',
        score: 0.9,
        data: 'Conversation about refund',
        metadata: {
          type: 'conversation',
          appId: 'test-app',
          category: 'refund',
          resolution: 'refund',
        },
      },
      {
        id: 'kb-1',
        score: 0.85,
        data: 'Knowledge base article',
        metadata: {
          type: 'knowledge',
          appId: 'test-app',
          source: 'docs',
        },
      },
      {
        id: 'resp-1',
        score: 0.8,
        data: 'Canned response template',
        metadata: {
          type: 'response',
          appId: 'test-app',
          source: 'canned-response',
        },
      },
    ]

    vi.spyOn(client, 'queryVectors').mockResolvedValue(mockResults)

    const result = await buildAgentContext({
      appId: 'test-app',
      query: 'test query',
    })

    expect(result.similarTickets).toHaveLength(1)
    expect(result.similarTickets[0]?.id).toBe('conv-1')

    expect(result.knowledge).toHaveLength(1)
    expect(result.knowledge[0]?.id).toBe('kb-1')

    expect(result.goodResponses).toHaveLength(1)
    expect(result.goodResponses[0]?.id).toBe('resp-1')
  })

  it('should handle results without metadata gracefully', async () => {
    vi.spyOn(redact, 'redactPII').mockReturnValue('redacted query')

    const mockResults: VectorQueryResult[] = [
      {
        id: 'doc-1',
        score: 0.9,
        data: 'Some document',
        // No metadata
      },
    ]

    vi.spyOn(client, 'queryVectors').mockResolvedValue(mockResults)

    const result = await buildAgentContext({
      appId: 'test-app',
      query: 'test query',
    })

    // Should be skipped since no metadata
    expect(result.similarTickets).toHaveLength(0)
    expect(result.knowledge).toHaveLength(0)
    expect(result.goodResponses).toHaveLength(0)
  })

  it('should convert VectorQueryResult to VectorDocument format', async () => {
    vi.spyOn(redact, 'redactPII').mockReturnValue('redacted query')

    const mockResults: VectorQueryResult[] = [
      {
        id: 'conv-1',
        score: 0.9,
        data: 'Conversation text',
        metadata: {
          type: 'conversation',
          appId: 'test-app',
        },
      },
    ]

    vi.spyOn(client, 'queryVectors').mockResolvedValue(mockResults)

    const result = await buildAgentContext({
      appId: 'test-app',
      query: 'test query',
    })

    expect(result.similarTickets[0]).toEqual({
      id: 'conv-1',
      data: 'Conversation text',
      metadata: {
        type: 'conversation',
        appId: 'test-app',
      },
    })
  })

  it('should handle empty results', async () => {
    vi.spyOn(redact, 'redactPII').mockReturnValue('redacted query')
    vi.spyOn(client, 'queryVectors').mockResolvedValue([])

    const result = await buildAgentContext({
      appId: 'test-app',
      query: 'test query',
    })

    expect(result.similarTickets).toEqual([])
    expect(result.knowledge).toEqual([])
    expect(result.goodResponses).toEqual([])
  })

  it('should throw error if queryVectors fails', async () => {
    vi.spyOn(redact, 'redactPII').mockReturnValue('redacted query')
    vi.spyOn(client, 'queryVectors').mockRejectedValue(
      new Error('Vector query failed')
    )

    await expect(
      buildAgentContext({
        appId: 'test-app',
        query: 'test query',
      })
    ).rejects.toThrow('Vector query failed')
  })
})
