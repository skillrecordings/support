/**
 * Tests for template sync module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncTemplates } from './sync'

// Mock the front-sdk
vi.mock('@skillrecordings/front-sdk', () => ({
  createFrontClient: vi.fn(() => ({
    templates: {
      list: vi.fn(),
    },
    raw: {
      get: vi.fn(),
    },
  })),
  paginate: vi.fn(),
}))

// Mock the vector client
vi.mock('../vector/client', () => ({
  upsertVector: vi.fn().mockResolvedValue({}),
}))

describe('syncTemplates', () => {
  const mockApiKey = 'test-api-key'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FRONT_API_KEY = mockApiKey
  })

  afterEach(() => {
    delete process.env.FRONT_API_KEY
  })

  it('should throw if no API key is provided', async () => {
    delete process.env.FRONT_API_KEY

    await expect(syncTemplates({ appId: 'test-app' })).rejects.toThrow(
      'Front API key required'
    )
  })

  it('should use provided API key over env var', async () => {
    const { createFrontClient } = await import('@skillrecordings/front-sdk')
    const { paginate } = await import('@skillrecordings/front-sdk')

    // Mock paginate to return empty array
    vi.mocked(paginate).mockResolvedValue([])

    await syncTemplates({
      appId: 'test-app',
      frontApiKey: 'custom-key',
    })

    expect(createFrontClient).toHaveBeenCalledWith({ apiToken: 'custom-key' })
  })

  it('should sync templates from Front to vector store', async () => {
    const { paginate } = await import('@skillrecordings/front-sdk')
    const { upsertVector } = await import('../vector/client')

    const mockTemplates = [
      {
        id: 'rsp_123',
        name: 'Refund Request',
        body: '<p>Thank you for contacting us about a refund...</p>',
        subject: null,
        is_available_for_all_inboxes: true,
        _links: { self: 'https://api.frontapp.com/message_templates/rsp_123' },
      },
      {
        id: 'rsp_456',
        name: 'License Transfer',
        body: '<p>We can help you transfer your license...</p>',
        subject: null,
        is_available_for_all_inboxes: false,
        _links: { self: 'https://api.frontapp.com/message_templates/rsp_456' },
      },
    ]

    vi.mocked(paginate).mockResolvedValue(mockTemplates)

    const result = await syncTemplates({ appId: 'test-app' })

    expect(result.synced).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(upsertVector).toHaveBeenCalledTimes(2)

    // Verify the first template was transformed correctly
    expect(upsertVector).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'front_template_rsp_123',
        data: 'Thank you for contacting us about a refund...',
        metadata: expect.objectContaining({
          type: 'response',
          appId: 'test-app',
          title: 'Refund Request',
          source: 'front_template',
          frontId: 'rsp_123',
          isGlobal: 1,
        }),
      })
    )
  })

  it('should skip templates with empty body', async () => {
    const { paginate } = await import('@skillrecordings/front-sdk')
    const { upsertVector } = await import('../vector/client')

    const mockTemplates = [
      {
        id: 'rsp_123',
        name: 'Valid Template',
        body: '<p>Content here</p>',
        subject: null,
        is_available_for_all_inboxes: true,
        _links: { self: 'https://api.frontapp.com/message_templates/rsp_123' },
      },
      {
        id: 'rsp_empty',
        name: 'Empty Template',
        body: '',
        subject: null,
        is_available_for_all_inboxes: true,
        _links: {
          self: 'https://api.frontapp.com/message_templates/rsp_empty',
        },
      },
      {
        id: 'rsp_whitespace',
        name: 'Whitespace Template',
        body: '   ',
        subject: null,
        is_available_for_all_inboxes: true,
        _links: {
          self: 'https://api.frontapp.com/message_templates/rsp_whitespace',
        },
      },
    ]

    vi.mocked(paginate).mockResolvedValue(mockTemplates)

    const result = await syncTemplates({ appId: 'test-app' })

    expect(result.synced).toBe(1)
    expect(result.skipped).toBe(2)
    expect(upsertVector).toHaveBeenCalledTimes(1)
  })

  it('should handle errors gracefully', async () => {
    const { paginate } = await import('@skillrecordings/front-sdk')
    const { upsertVector } = await import('../vector/client')

    const mockTemplates = [
      {
        id: 'rsp_123',
        name: 'Good Template',
        body: '<p>Content</p>',
        subject: null,
        is_available_for_all_inboxes: true,
        _links: { self: 'https://api.frontapp.com/message_templates/rsp_123' },
      },
      {
        id: 'rsp_bad',
        name: 'Bad Template',
        body: '<p>Will fail</p>',
        subject: null,
        is_available_for_all_inboxes: true,
        _links: { self: 'https://api.frontapp.com/message_templates/rsp_bad' },
      },
    ]

    vi.mocked(paginate).mockResolvedValue(mockTemplates)
    vi.mocked(upsertVector)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Vector store error'))

    const result = await syncTemplates({ appId: 'test-app' })

    expect(result.synced).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      templateId: 'rsp_bad',
      templateName: 'Bad Template',
      error: 'Vector store error',
    })
  })

  it('should strip HTML tags from template body', async () => {
    const { paginate } = await import('@skillrecordings/front-sdk')
    const { upsertVector } = await import('../vector/client')

    const mockTemplates = [
      {
        id: 'rsp_html',
        name: 'HTML Template',
        body: '<h1>Hello</h1><p>This is <strong>bold</strong> text.</p>',
        subject: null,
        is_available_for_all_inboxes: true,
        _links: { self: 'https://api.frontapp.com/message_templates/rsp_html' },
      },
    ]

    vi.mocked(paginate).mockResolvedValue(mockTemplates)

    await syncTemplates({ appId: 'test-app' })

    expect(upsertVector).toHaveBeenCalledWith(
      expect.objectContaining({
        data: 'HelloThis is bold text.',
      })
    )
  })
})
