import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIError } from '../../../../src/core/errors'

const mockCreateInstrumentedBaseClient = vi.hoisted(() => vi.fn())
const mockCreateConversationsClient = vi.hoisted(() => vi.fn())
const mockCreateMessagesClient = vi.hoisted(() => vi.fn())
const mockCreateDraftsClient = vi.hoisted(() => vi.fn())
const mockCreateTemplatesClient = vi.hoisted(() => vi.fn())
const mockCreateTagsClient = vi.hoisted(() => vi.fn())
const mockCreateInboxesClient = vi.hoisted(() => vi.fn())
const mockCreateChannelsClient = vi.hoisted(() => vi.fn())
const mockCreateContactsClient = vi.hoisted(() => vi.fn())
const mockCreateTeammatesClient = vi.hoisted(() => vi.fn())

vi.mock('@skillrecordings/core/front/instrumented-client', () => ({
  createInstrumentedBaseClient: mockCreateInstrumentedBaseClient,
}))

vi.mock('@skillrecordings/front-sdk', () => ({
  createConversationsClient: mockCreateConversationsClient,
  createMessagesClient: mockCreateMessagesClient,
  createDraftsClient: mockCreateDraftsClient,
  createTemplatesClient: mockCreateTemplatesClient,
  createTagsClient: mockCreateTagsClient,
  createInboxesClient: mockCreateInboxesClient,
  createChannelsClient: mockCreateChannelsClient,
  createContactsClient: mockCreateContactsClient,
  createTeammatesClient: mockCreateTeammatesClient,
}))

import {
  getFrontClient,
  normalizeId,
  requireFrontToken,
  resetFrontRateLimiter,
} from '../../../../src/commands/front/client'

describe('front client helpers', () => {
  const originalFrontToken = process.env.FRONT_API_TOKEN

  beforeEach(() => {
    mockCreateInstrumentedBaseClient.mockReset()
    mockCreateConversationsClient.mockReset()
    mockCreateMessagesClient.mockReset()
    mockCreateDraftsClient.mockReset()
    mockCreateTemplatesClient.mockReset()
    mockCreateTagsClient.mockReset()
    mockCreateInboxesClient.mockReset()
    mockCreateChannelsClient.mockReset()
    mockCreateContactsClient.mockReset()
    mockCreateTeammatesClient.mockReset()
    delete process.env.FRONT_API_TOKEN
    resetFrontRateLimiter()
  })

  it('requireFrontToken throws when FRONT_API_TOKEN is missing', () => {
    expect(() => requireFrontToken()).toThrow(CLIError)
  })

  it('requireFrontToken returns token when present', () => {
    process.env.FRONT_API_TOKEN = 'front-token'

    expect(requireFrontToken()).toBe('front-token')
  })

  it('normalizeId strips URL prefixes', () => {
    expect(normalizeId('https://app.frontapp.com/open/cnv_123')).toBe('cnv_123')
  })

  it('normalizeId passes through IDs', () => {
    expect(normalizeId('cnv_456')).toBe('cnv_456')
  })

  it('getFrontClient uses the Front token', () => {
    process.env.FRONT_API_TOKEN = 'front-token'
    const baseClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }
    mockCreateInstrumentedBaseClient.mockReturnValue(baseClient)
    mockCreateConversationsClient.mockReturnValue({})
    mockCreateMessagesClient.mockReturnValue({})
    mockCreateDraftsClient.mockReturnValue({})
    mockCreateTemplatesClient.mockReturnValue({})
    mockCreateTagsClient.mockReturnValue({})
    mockCreateInboxesClient.mockReturnValue({})
    mockCreateChannelsClient.mockReturnValue({})
    mockCreateContactsClient.mockReturnValue({})
    mockCreateTeammatesClient.mockReturnValue({})

    const client = getFrontClient()

    expect(mockCreateInstrumentedBaseClient).toHaveBeenCalledWith({
      apiToken: 'front-token',
    })
    expect(client.raw).toBeTruthy()
  })

  afterEach(() => {
    if (originalFrontToken === undefined) {
      delete process.env.FRONT_API_TOKEN
    } else {
      process.env.FRONT_API_TOKEN = originalFrontToken
    }
  })
})
