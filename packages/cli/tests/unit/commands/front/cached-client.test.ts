import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  createCachedInstrumentedFrontClient,
  resetFrontCache,
} from '../../../../src/commands/front/client'

type BaseClient = {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const createBaseClient = (): BaseClient => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
})

const wireDefaultClients = () => {
  mockCreateConversationsClient.mockReturnValue({})
  mockCreateMessagesClient.mockReturnValue({})
  mockCreateDraftsClient.mockReturnValue({})
  mockCreateTemplatesClient.mockReturnValue({})
  mockCreateTagsClient.mockReturnValue({})
  mockCreateInboxesClient.mockReturnValue({})
  mockCreateChannelsClient.mockReturnValue({})
  mockCreateContactsClient.mockReturnValue({})
  mockCreateTeammatesClient.mockReturnValue({})
}

describe('getFrontClient with cache', () => {
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
    resetFrontCache()
  })

  afterEach(() => {
    resetFrontCache()
  })

  it('caches GET responses', async () => {
    const baseClient = createBaseClient()
    baseClient.get.mockResolvedValue({ ok: true })
    mockCreateInstrumentedBaseClient.mockReturnValue(baseClient)
    wireDefaultClients()

    const client = createCachedInstrumentedFrontClient({
      apiToken: 'token',
    })

    const first = await client.raw.get('/conversations/cnv_1')
    const second = await client.raw.get('/conversations/cnv_1')

    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
    expect(baseClient.get).toHaveBeenCalledTimes(1)
  })

  it('returns cached response on second call', async () => {
    const baseClient = createBaseClient()
    baseClient.get.mockResolvedValue({ ok: true })
    mockCreateInstrumentedBaseClient.mockReturnValue(baseClient)
    wireDefaultClients()

    const client = createCachedInstrumentedFrontClient({
      apiToken: 'token',
    })

    await client.raw.get('/messages/msg_1')
    await client.raw.get('/messages/msg_1')

    expect(baseClient.get).toHaveBeenCalledTimes(1)
  })

  it('invalidates cache after POST', async () => {
    const baseClient = createBaseClient()
    baseClient.get.mockResolvedValue({ ok: true })
    baseClient.post.mockResolvedValue({ ok: true })
    mockCreateInstrumentedBaseClient.mockReturnValue(baseClient)
    wireDefaultClients()

    const client = createCachedInstrumentedFrontClient({
      apiToken: 'token',
    })

    await client.raw.get('/tags')
    await client.raw.post('/tags', { name: 'VIP' })
    await client.raw.get('/tags')

    expect(baseClient.get).toHaveBeenCalledTimes(2)
    expect(baseClient.post).toHaveBeenCalledTimes(1)
  })

  it('invalidates cache after PATCH', async () => {
    const baseClient = createBaseClient()
    baseClient.get.mockResolvedValue({ ok: true })
    baseClient.patch.mockResolvedValue({ ok: true })
    mockCreateInstrumentedBaseClient.mockReturnValue(baseClient)
    wireDefaultClients()

    const client = createCachedInstrumentedFrontClient({
      apiToken: 'token',
    })

    await client.raw.get('/conversations/cnv_1')
    await client.raw.patch('/conversations/cnv_1/tags', { tag: 'tag_1' })
    await client.raw.get('/conversations/cnv_1')

    expect(baseClient.get).toHaveBeenCalledTimes(2)
    expect(baseClient.patch).toHaveBeenCalledTimes(1)
  })

  it('sub-clients use cached base (conversations.get hits cache)', async () => {
    const baseClient = createBaseClient()
    baseClient.get.mockResolvedValue({ ok: true })
    mockCreateInstrumentedBaseClient.mockReturnValue(baseClient)

    mockCreateConversationsClient.mockImplementation((base) => ({
      get: (id: string) => base.get(`/conversations/${id}`),
    }))
    mockCreateMessagesClient.mockReturnValue({})
    mockCreateDraftsClient.mockReturnValue({})
    mockCreateTemplatesClient.mockReturnValue({})
    mockCreateTagsClient.mockReturnValue({})
    mockCreateInboxesClient.mockReturnValue({})
    mockCreateChannelsClient.mockReturnValue({})
    mockCreateContactsClient.mockReturnValue({})
    mockCreateTeammatesClient.mockReturnValue({})

    const client = createCachedInstrumentedFrontClient({
      apiToken: 'token',
    })

    await client.conversations.get('cnv_1')
    await client.conversations.get('cnv_1')

    expect(baseClient.get).toHaveBeenCalledTimes(1)
  })

  it('does not cache error responses', async () => {
    const baseClient = createBaseClient()
    baseClient.get
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true })
    mockCreateInstrumentedBaseClient.mockReturnValue(baseClient)
    wireDefaultClients()

    const client = createCachedInstrumentedFrontClient({
      apiToken: 'token',
    })

    await expect(client.raw.get('/messages/msg_1')).rejects.toThrow('boom')
    await expect(client.raw.get('/messages/msg_1')).resolves.toEqual({
      ok: true,
    })

    expect(baseClient.get).toHaveBeenCalledTimes(2)
  })
})
