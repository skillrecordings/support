import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCommentContextService } from './comment-context'

// Mock the front-sdk module
vi.mock('@skillrecordings/front-sdk', () => {
  const mockListMessages = vi.fn()
  const mockRawGet = vi.fn()

  return {
    createFrontClient: vi.fn(() => ({
      conversations: {
        listMessages: mockListMessages,
      },
      raw: {
        get: mockRawGet,
      },
    })),
    paginate: vi.fn(async (firstPage, getPage) => {
      const results: unknown[] = []
      let page = await firstPage()
      results.push(...page._results)

      while (page._pagination?.next) {
        page = await getPage(page._pagination.next)
        results.push(...page._results)
      }

      return results
    }),
  }
})

import { createFrontClient, paginate } from '@skillrecordings/front-sdk'

type MockFrontClient = {
  conversations: { listMessages: ReturnType<typeof vi.fn> }
  raw: { get: ReturnType<typeof vi.fn> }
}

/**
 * Create a mock Front message
 */
function createMockMessage(overrides: {
  id: string
  body: string
  text?: string
  is_inbound: boolean
  created_at: number
  author?: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  } | null
  recipients?: Array<{ handle: string; role: string }>
}) {
  return {
    _links: {
      self: `https://api2.frontapp.com/messages/${overrides.id}`,
      related: {
        conversation: 'https://api2.frontapp.com/conversations/cnv_test',
      },
    },
    id: overrides.id,
    type: 'email' as const,
    is_inbound: overrides.is_inbound,
    is_draft: false,
    error_type: null,
    version: null,
    created_at: overrides.created_at,
    subject: 'Test Subject',
    blurb: overrides.body.substring(0, 100),
    body: overrides.body,
    text: overrides.text ?? overrides.body,
    author: overrides.author ?? null,
    recipients: overrides.recipients ?? [],
    attachments: [],
  }
}

describe('createCommentContextService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getCommentThread', () => {
    it('returns empty thread for conversation with no messages', async () => {
      const service = createCommentContextService({ apiToken: 'test-token' })

      const mockFn = createFrontClient as ReturnType<typeof vi.fn>
      const mockClient = mockFn.mock.results[0]?.value as
        | MockFrontClient
        | undefined
      mockClient?.conversations.listMessages.mockResolvedValue({
        _results: [],
        _pagination: {},
      })

      const thread = await service.getCommentThread('cnv_test')

      expect(thread.messages).toEqual([])
      expect(thread.authors.size).toBe(0)
      expect(thread.latestTimestamp).toBe(0)
      expect(thread.messageCount).toBe(0)
    })

    it('returns thread with single message', async () => {
      const service = createCommentContextService({ apiToken: 'test-token' })

      const mockFn = createFrontClient as ReturnType<typeof vi.fn>
      const mockClient = mockFn.mock.results[0]?.value as
        | MockFrontClient
        | undefined
      mockClient?.conversations.listMessages.mockResolvedValue({
        _results: [
          createMockMessage({
            id: 'msg_001',
            body: 'Hello, I need help!',
            is_inbound: true,
            created_at: 1706745600,
            recipients: [{ handle: 'customer@example.com', role: 'from' }],
          }),
        ],
        _pagination: {},
      })

      const thread = await service.getCommentThread('cnv_test')

      expect(thread.messageCount).toBe(1)
      expect(thread.messages[0]).toMatchObject({
        id: 'msg_001',
        body: 'Hello, I need help!',
        isInbound: true,
        createdAt: 1706745600,
        authorEmail: 'customer@example.com',
        authorId: null,
      })
      expect(thread.latestTimestamp).toBe(1706745600)
    })

    it('returns thread with multiple messages sorted by creation time', async () => {
      const service = createCommentContextService({ apiToken: 'test-token' })

      const mockFn = createFrontClient as ReturnType<typeof vi.fn>
      const mockClient = mockFn.mock.results[0]?.value as
        | MockFrontClient
        | undefined
      mockClient?.conversations.listMessages.mockResolvedValue({
        _results: [
          // Return in reverse order to test sorting
          createMockMessage({
            id: 'msg_003',
            body: 'Is there anything else I can help with?',
            is_inbound: false,
            created_at: 1706745800,
            author: {
              id: 'tea_agent',
              email: 'agent@example.com',
              first_name: 'Support',
              last_name: 'Agent',
            },
          }),
          createMockMessage({
            id: 'msg_001',
            body: 'Hello, I need help!',
            is_inbound: true,
            created_at: 1706745600,
            recipients: [{ handle: 'customer@example.com', role: 'from' }],
          }),
          createMockMessage({
            id: 'msg_002',
            body: 'Hi! I can help you with that.',
            is_inbound: false,
            created_at: 1706745700,
            author: {
              id: 'tea_agent',
              email: 'agent@example.com',
              first_name: 'Support',
              last_name: 'Agent',
            },
          }),
        ],
        _pagination: {},
      })

      const thread = await service.getCommentThread('cnv_test')

      expect(thread.messageCount).toBe(3)
      expect(thread.messages.map((m) => m.id)).toEqual([
        'msg_001',
        'msg_002',
        'msg_003',
      ])
      expect(thread.latestTimestamp).toBe(1706745800)
    })

    it('builds author map from teammate authors', async () => {
      const service = createCommentContextService({ apiToken: 'test-token' })

      const mockFn = createFrontClient as ReturnType<typeof vi.fn>
      const mockClient = mockFn.mock.results[0]?.value as
        | MockFrontClient
        | undefined
      mockClient?.conversations.listMessages.mockResolvedValue({
        _results: [
          createMockMessage({
            id: 'msg_001',
            body: 'First response',
            is_inbound: false,
            created_at: 1706745600,
            author: {
              id: 'tea_alice',
              email: 'alice@example.com',
              first_name: 'Alice',
              last_name: 'Smith',
            },
          }),
          createMockMessage({
            id: 'msg_002',
            body: 'Second response',
            is_inbound: false,
            created_at: 1706745700,
            author: {
              id: 'tea_bob',
              email: 'bob@example.com',
              first_name: 'Bob',
            },
          }),
          createMockMessage({
            id: 'msg_003',
            body: 'Follow-up from Alice',
            is_inbound: false,
            created_at: 1706745800,
            author: {
              id: 'tea_alice',
              email: 'alice@example.com',
              first_name: 'Alice',
              last_name: 'Smith',
            },
          }),
        ],
        _pagination: {},
      })

      const thread = await service.getCommentThread('cnv_test')

      expect(thread.authors.size).toBe(2)

      const alice = thread.authors.get('tea_alice')
      expect(alice).toMatchObject({
        id: 'tea_alice',
        email: 'alice@example.com',
        name: 'Alice Smith',
        isTeammate: true,
      })

      const bob = thread.authors.get('tea_bob')
      expect(bob).toMatchObject({
        id: 'tea_bob',
        email: 'bob@example.com',
        name: 'Bob',
        isTeammate: true,
      })
    })

    it('handles pagination for long threads', async () => {
      const service = createCommentContextService({ apiToken: 'test-token' })

      const mockFn = createFrontClient as ReturnType<typeof vi.fn>
      const mockClient = mockFn.mock.results[0]?.value as
        | MockFrontClient
        | undefined

      // First page
      mockClient?.conversations.listMessages.mockResolvedValue({
        _results: [
          createMockMessage({
            id: 'msg_001',
            body: 'Page 1 message',
            is_inbound: true,
            created_at: 1706745600,
            recipients: [{ handle: 'customer@example.com', role: 'from' }],
          }),
        ],
        _pagination: {
          next: 'https://api2.frontapp.com/conversations/cnv_test/messages?page=2',
        },
      })

      // Second page (fetched via raw.get)
      mockClient?.raw.get.mockResolvedValue({
        _results: [
          createMockMessage({
            id: 'msg_002',
            body: 'Page 2 message',
            is_inbound: false,
            created_at: 1706745700,
            author: {
              id: 'tea_agent',
              email: 'agent@example.com',
              first_name: 'Agent',
            },
          }),
        ],
        _pagination: {},
      })

      const thread = await service.getCommentThread('cnv_test')

      expect(thread.messageCount).toBe(2)
      expect(thread.messages.map((m) => m.id)).toEqual(['msg_001', 'msg_002'])
      expect(paginate).toHaveBeenCalled()
    })

    it('extracts sender email from recipients for inbound messages', async () => {
      const service = createCommentContextService({ apiToken: 'test-token' })

      const mockFn = createFrontClient as ReturnType<typeof vi.fn>
      const mockClient = mockFn.mock.results[0]?.value as
        | MockFrontClient
        | undefined
      mockClient?.conversations.listMessages.mockResolvedValue({
        _results: [
          createMockMessage({
            id: 'msg_001',
            body: 'Inbound message',
            is_inbound: true,
            created_at: 1706745600,
            author: null,
            recipients: [
              { handle: 'customer@example.com', role: 'from' },
              { handle: 'support@example.com', role: 'to' },
            ],
          }),
        ],
        _pagination: {},
      })

      const thread = await service.getCommentThread('cnv_test')

      expect(thread.messages[0]?.authorEmail).toBe('customer@example.com')
      expect(thread.messages[0]?.authorId).toBeNull()
    })

    it('uses author email when author is present', async () => {
      const service = createCommentContextService({ apiToken: 'test-token' })

      const mockFn = createFrontClient as ReturnType<typeof vi.fn>
      const mockClient = mockFn.mock.results[0]?.value as
        | MockFrontClient
        | undefined
      mockClient?.conversations.listMessages.mockResolvedValue({
        _results: [
          createMockMessage({
            id: 'msg_001',
            body: 'Outbound message',
            is_inbound: false,
            created_at: 1706745600,
            author: {
              id: 'tea_agent',
              email: 'agent@example.com',
              first_name: 'Agent',
            },
            recipients: [{ handle: 'customer@example.com', role: 'to' }],
          }),
        ],
        _pagination: {},
      })

      const thread = await service.getCommentThread('cnv_test')

      expect(thread.messages[0]?.authorEmail).toBe('agent@example.com')
      expect(thread.messages[0]?.authorId).toBe('tea_agent')
    })
  })
})
