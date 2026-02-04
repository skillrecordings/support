import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../helpers/test-context'

const mockCreateInstrumentedFrontClient = vi.hoisted(() => vi.fn())

vi.mock('@skillrecordings/core/front/instrumented-client', () => ({
  createInstrumentedFrontClient: mockCreateInstrumentedFrontClient,
}))

import { archiveConversations } from '../../../src/commands/front/archive'
import { bulkArchiveConversations } from '../../../src/commands/front/bulk-archive'
import {
  listConversations,
  listInboxes,
} from '../../../src/commands/front/inbox'
import { getConversation, getMessage } from '../../../src/commands/front/index'
import { pullConversations } from '../../../src/commands/front/pull-conversations'
import { listTags } from '../../../src/commands/front/tags'

type MockFrontClient = {
  messages: { get: ReturnType<typeof vi.fn> }
  conversations: {
    get: ReturnType<typeof vi.fn>
    listMessages: ReturnType<typeof vi.fn>
  }
  inboxes: { list: ReturnType<typeof vi.fn> }
  raw: {
    get: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
  }
  tags: {
    listConversations: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
}

const createFrontMock = (): MockFrontClient => ({
  messages: { get: vi.fn() },
  conversations: { get: vi.fn(), listMessages: vi.fn() },
  inboxes: { list: vi.fn() },
  raw: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  tags: {
    listConversations: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
})

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('front commands', () => {
  const originalFrontToken = process.env.FRONT_API_TOKEN

  beforeEach(() => {
    process.env.FRONT_API_TOKEN = 'test-front-token'
    process.exitCode = undefined
    mockCreateInstrumentedFrontClient.mockReset()
  })

  afterEach(() => {
    if (originalFrontToken === undefined) {
      delete process.env.FRONT_API_TOKEN
    } else {
      process.env.FRONT_API_TOKEN = originalFrontToken
    }
  })

  it('message outputs JSON payload', async () => {
    const front = createFrontMock()
    front.messages.get.mockResolvedValue({
      id: 'msg_1',
      type: 'email',
      subject: 'Hello',
      created_at: 1700000000,
      recipients: [],
      attachments: [],
    })
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await getMessage(ctx, 'msg_1', { json: true })

    expect(getStderr()).toBe('')
    const payload = parseLastJson(getStdout()) as {
      _type: string
      data: { id: string }
    }
    expect(payload._type).toBe('message')
    expect(payload.data.id).toBe('msg_1')
  })

  it('message reports errors', async () => {
    const front = createFrontMock()
    front.messages.get.mockRejectedValue(new Error('boom'))
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStderr } = await createTestContext({
      format: 'json',
    })

    await getMessage(ctx, 'msg_1', { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to fetch Front message.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('conversation outputs JSON payload', async () => {
    const front = createFrontMock()
    front.conversations.get.mockResolvedValue({
      id: 'cnv_1',
      subject: 'Support',
      status: 'open',
      created_at: 1700000000,
      tags: [],
    })
    front.conversations.listMessages.mockResolvedValue({
      _results: [
        {
          id: 'msg_1',
          is_inbound: true,
          created_at: 1700000001,
          text: 'Hello there',
          author: { email: 'user@example.com' },
        },
      ],
    })
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await getConversation(ctx, 'cnv_1', { json: true, messages: true })

    const payload = parseLastJson(getStdout()) as {
      _type: string
      data: { conversation: { id: string }; messages: unknown[] }
    }
    expect(payload._type).toBe('conversation')
    expect(payload.data.conversation.id).toBe('cnv_1')
    expect(payload.data.messages).toHaveLength(1)
  })

  it('conversation reports errors', async () => {
    const front = createFrontMock()
    front.conversations.get.mockRejectedValue(new Error('not found'))
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await getConversation(ctx, 'cnv_1', { json: true, messages: false })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to fetch Front conversation.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('tags list outputs JSON payload', async () => {
    const front = createFrontMock()
    front.raw.get.mockResolvedValue({
      _results: [{ id: 'tag_1', name: 'VIP', is_private: false }],
      _pagination: { next: null },
    })
    front.tags.listConversations.mockResolvedValue({
      _results: [],
      _pagination: { total: 2 },
    })
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await listTags(ctx, { json: true, unused: false })

    const payload = parseLastJson(getStdout()) as {
      _type: string
      data: unknown[]
    }
    expect(payload._type).toBe('tag-list')
    expect(payload.data).toHaveLength(1)
  })

  it('tags list reports errors', async () => {
    const front = createFrontMock()
    front.raw.get.mockRejectedValue(new Error('down'))
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await listTags(ctx, { json: true, unused: false })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to list Front tags.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('inbox list outputs JSON payload', async () => {
    const front = createFrontMock()
    front.inboxes.list.mockResolvedValue({
      _results: [{ id: 'inbox_1', name: 'Support', is_private: false }],
    })
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await listInboxes(ctx, { json: true })

    const payload = parseLastJson(getStdout()) as {
      _type: string
      data: unknown[]
    }
    expect(payload._type).toBe('inbox-list')
    expect(payload.data).toHaveLength(1)
  })

  it('inbox conversations report errors', async () => {
    const front = createFrontMock()
    front.inboxes.list.mockResolvedValue({
      _results: [{ id: 'inbox_1', name: 'Support', is_private: false }],
    })
    front.raw.get.mockRejectedValue(new Error('nope'))
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await listConversations(ctx, 'inbox_1', { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to list Front inbox conversations.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('archive outputs JSON payload', async () => {
    const front = createFrontMock()
    front.raw.patch.mockResolvedValue({})
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await archiveConversations(ctx, 'cnv_1', [], { json: true })

    const payload = parseLastJson(getStdout()) as {
      _type: string
      data: unknown[]
    }
    expect(payload._type).toBe('archive-result')
    expect(payload.data).toHaveLength(1)
  })

  it('archive reports errors', async () => {
    delete process.env.FRONT_API_TOKEN

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await archiveConversations(ctx, 'cnv_1', [], { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain(
      'FRONT_API_TOKEN environment variable is required.'
    )
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('bulk archive outputs JSON payload', async () => {
    const front = createFrontMock()
    front.raw.get.mockResolvedValueOnce({
      _results: [
        {
          id: 'cnv_1',
          subject: 'Question',
          status: 'open',
          created_at: 1700000000,
          tags: [],
        },
      ],
      _pagination: { next: null },
    })
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await bulkArchiveConversations(ctx, {
      inbox: 'inbox_1',
      status: 'open',
      dryRun: true,
      json: true,
    })

    const payload = parseLastJson(getStdout()) as {
      _type: string
      data: { matches: unknown[] }
    }
    expect(payload._type).toBe('bulk-archive-result')
    expect(payload.data.matches).toHaveLength(1)
  })

  it('bulk archive reports errors', async () => {
    const front = createFrontMock()
    front.raw.get.mockRejectedValue(new Error('timeout'))
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await bulkArchiveConversations(ctx, {
      inbox: 'inbox_1',
      status: 'open',
      dryRun: true,
      json: true,
    })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to bulk archive Front conversations.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('pull outputs JSON payload', async () => {
    const front = createFrontMock()
    front.raw.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/inboxes/')) {
        return {
          _results: [
            {
              id: 'cnv_1',
              subject: 'Refund request',
              status: 'open',
              created_at: 1700000000,
              tags: [{ id: 'tag_1', name: 'refund' }],
              recipient: { handle: 'user@example.com' },
            },
          ],
          _pagination: { next: null },
        }
      }

      if (path.includes('/messages')) {
        return {
          _results: [
            {
              id: 'msg_1',
              is_inbound: true,
              created_at: 1700000001,
              text: 'Please help with my refund request.',
              author: { email: 'user@example.com' },
            },
          ],
        }
      }

      return { _results: [], _pagination: { next: null } }
    })
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await pullConversations(ctx, { inbox: 'inbox_1', limit: 1, json: true })

    const payload = parseLastJson(getStdout()) as {
      _type: string
      data: unknown[]
    }
    expect(payload._type).toBe('eval-dataset')
    expect(payload.data).toHaveLength(1)
  })

  it('pull reports errors', async () => {
    const front = createFrontMock()
    front.raw.get.mockRejectedValue(new Error('bad gateway'))
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await pullConversations(ctx, { inbox: 'inbox_1', limit: 1, json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to pull Front conversations.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })
})
