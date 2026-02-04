/**
 * Tests for template sync module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted for proper mock hoisting
const { mockPaginate, mockUpsertVector, mockCreateInstrumentedFrontClient } =
  vi.hoisted(() => ({
    mockPaginate: vi.fn(),
    mockUpsertVector: vi.fn(),
    mockCreateInstrumentedFrontClient: vi.fn(() => ({
      templates: {
        list: vi.fn(),
      },
      raw: {
        get: vi.fn(),
      },
    })),
  }))

// Mock the front-sdk
vi.mock('@skillrecordings/front-sdk', () => ({
  FRONT_API_BASE: 'https://api2.frontapp.com',
  paginate: mockPaginate,
}))

// Mock the instrumented client
vi.mock('../front/instrumented-client', () => ({
  createInstrumentedFrontClient: mockCreateInstrumentedFrontClient,
}))

// Mock the vector client
vi.mock('../vector/client', () => ({
  upsertVector: mockUpsertVector,
}))

import { syncTemplates } from './sync'

describe('syncTemplates', () => {
  const mockApiKey = 'test-api-key'

  beforeEach(() => {
    vi.clearAllMocks()
    mockPaginate.mockReset()
    mockUpsertVector.mockReset()
    mockUpsertVector.mockResolvedValue({})
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
    // Mock paginate to return empty array
    mockPaginate.mockResolvedValue([])

    await syncTemplates({
      appId: 'test-app',
      frontApiKey: 'custom-key',
    })

    expect(mockCreateInstrumentedFrontClient).toHaveBeenCalledWith({
      apiToken: 'custom-key',
    })
  })

  it('should sync templates from Front to vector store', async () => {
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

    mockPaginate.mockResolvedValue(mockTemplates)

    const result = await syncTemplates({ appId: 'test-app' })

    expect(result.synced).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(mockUpsertVector).toHaveBeenCalledTimes(2)

    // Verify the first template was transformed correctly
    expect(mockUpsertVector).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'front_template_rsp_123',
        data: 'Thank you for contacting us about a refund...',
        metadata: expect.objectContaining({
          type: 'response',
          appId: 'test-app',
          title: 'Refund Request',
          source: 'canned-response',
          frontId: 'rsp_123',
          isGlobal: 1,
        }),
      })
    )
  })

  it('should skip templates with empty body', async () => {
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

    mockPaginate.mockResolvedValue(mockTemplates)

    const result = await syncTemplates({ appId: 'test-app' })

    expect(result.synced).toBe(1)
    expect(result.skipped).toBe(2)
    expect(mockUpsertVector).toHaveBeenCalledTimes(1)
  })

  it('should handle errors gracefully', async () => {
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

    mockPaginate.mockResolvedValue(mockTemplates)
    mockUpsertVector
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

    mockPaginate.mockResolvedValue(mockTemplates)

    await syncTemplates({ appId: 'test-app' })

    expect(mockUpsertVector).toHaveBeenCalledWith(
      expect.objectContaining({
        data: 'HelloThis is bold text.',
      })
    )
  })
})
