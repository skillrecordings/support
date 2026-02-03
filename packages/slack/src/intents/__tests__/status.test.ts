import type { Conversation, ConversationList } from '@skillrecordings/front-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFrontLink } from '../../formatters/status'
import {
  createStatusCache,
  handleHealthQuery,
  handlePendingQuery,
  handleUrgentQuery,
} from '../status'

const baseConversation: Conversation = {
  _links: {
    self: 'https://api2.frontapp.com/conversations/cnv_test',
    related: {
      events: 'https://api2.frontapp.com/conversations/cnv_test/events',
      followers: 'https://api2.frontapp.com/conversations/cnv_test/followers',
      messages: 'https://api2.frontapp.com/conversations/cnv_test/messages',
      comments: 'https://api2.frontapp.com/conversations/cnv_test/comments',
      inboxes: 'https://api2.frontapp.com/conversations/cnv_test/inboxes',
    },
  },
  id: 'cnv_test',
  subject: 'Test subject',
  status: 'unassigned',
  assignee: null,
  recipient: null,
  tags: [],
  links: [],
  custom_fields: {},
  created_at: 0,
  waiting_since: 0,
  is_private: false,
  scheduled_reminders: [],
  metadata: {},
}

function makeConversation(overrides: Partial<Conversation>): Conversation {
  return { ...baseConversation, ...overrides }
}

function mockConversationList(results: Conversation[]): ConversationList {
  return {
    _results: results,
    _pagination: { next: null },
    _links: { self: 'https://api2.frontapp.com/conversations' },
  }
}

describe('status intent handlers', () => {
  const logger = vi.fn().mockResolvedValue(undefined)
  const initializeAxiom = vi.fn()

  beforeEach(() => {
    logger.mockClear()
    initializeAxiom.mockClear()
  })

  it('handles urgent query with results', async () => {
    const conversations = [
      makeConversation({
        id: 'cnv_urgent_1',
        subject: 'License transfer request',
        tags: [{ id: 'tag_1', name: 'urgent' }],
        waiting_since: 100,
      }),
      makeConversation({
        id: 'cnv_urgent_2',
        subject: 'Refund request urgent',
        tags: [{ id: 'tag_2', name: 'high-priority' }],
        waiting_since: 200,
      }),
    ]

    const frontClient = {
      conversations: {
        search: vi.fn().mockResolvedValue(mockConversationList(conversations)),
      },
    }

    const now = () => new Date(300 * 1000)
    const result = await handleUrgentQuery(
      { type: 'urgent' },
      { frontClient, now, cache: createStatusCache(), logger, initializeAxiom }
    )

    expect(result.blocks[2]?.text?.text).toContain('Urgent (2)')
    expect(result.blocks[2]?.text?.text).toContain('License transfer request')
    expect(result.blocks[2]?.text?.text).toContain('Refund request urgent')
    expect(result.blocks[2]?.text?.text).toContain('View')
  })

  it('handles urgent query empty state', async () => {
    const frontClient = {
      conversations: {
        search: vi.fn().mockResolvedValue(mockConversationList([])),
      },
    }

    const result = await handleUrgentQuery(
      { type: 'urgent' },
      { frontClient, cache: createStatusCache(), logger, initializeAxiom }
    )

    expect(result.blocks[2]?.text?.text).toContain('Urgent (0)')
    expect(result.blocks[2]?.text?.text).toContain('No urgent conversations')
  })

  it('handles pending query with category breakdown', async () => {
    const conversations = [
      makeConversation({
        id: 'cnv_pending_1',
        tags: [
          { id: 'tag_1', name: 'category:refund' },
          { id: 'tag_2', name: 'product:Total TypeScript' },
        ],
      }),
      makeConversation({
        id: 'cnv_pending_2',
        tags: [
          { id: 'tag_3', name: 'category:refund' },
          { id: 'tag_4', name: 'product:Total TypeScript' },
        ],
      }),
      makeConversation({
        id: 'cnv_pending_3',
        tags: [
          { id: 'tag_5', name: 'category:access' },
          { id: 'tag_6', name: 'product:Epic React' },
        ],
      }),
    ]

    const frontClient = {
      conversations: {
        search: vi.fn().mockResolvedValue(mockConversationList(conversations)),
      },
    }

    const result = await handlePendingQuery(
      { type: 'pending' },
      { frontClient, cache: createStatusCache(), logger, initializeAxiom }
    )

    expect(result.blocks[2]?.text?.text).toContain('Pending Summary (3)')
    expect(result.blocks[2]?.text?.text).toContain(
      'Total TypeScript · refund: 2'
    )
    expect(result.blocks[2]?.text?.text).toContain('Epic React · access: 1')
  })

  it('handles health query with stats', async () => {
    const openConversations = [
      makeConversation({ id: 'cnv_open_1', waiting_since: 0 }),
      makeConversation({ id: 'cnv_open_2', waiting_since: 1800 }),
    ]
    const handledToday = [
      makeConversation({ id: 'cnv_done_1', status: 'archived' }),
      makeConversation({ id: 'cnv_done_2', status: 'archived' }),
      makeConversation({ id: 'cnv_done_3', status: 'archived' }),
    ]

    const search = vi
      .fn()
      .mockResolvedValueOnce(mockConversationList(openConversations))
      .mockResolvedValueOnce(mockConversationList(handledToday))

    const frontClient = { conversations: { search } }

    const now = () => new Date(3600 * 1000)
    const result = await handleHealthQuery(
      { type: 'health' },
      { frontClient, now, cache: createStatusCache(), logger, initializeAxiom }
    )

    expect(result.blocks[2]?.text?.text).toContain('Handled today: 3')
    expect(result.blocks[2]?.text?.text).toContain('Pending: 2')
    expect(result.blocks[2]?.text?.text).toContain('Avg response: 0.8h')
  })

  it('generates Front links for status items', () => {
    expect(buildFrontLink('cnv_123')).toBe(
      'https://app.frontapp.com/open/cnv_123'
    )
  })

  it('caches status results for 30 seconds', async () => {
    let currentTime = 0
    const now = () => new Date(currentTime)

    const search = vi.fn().mockResolvedValue(
      mockConversationList([
        makeConversation({
          id: 'cnv_cached',
          tags: [{ id: 'tag_1', name: 'urgent' }],
        }),
      ])
    )

    const frontClient = { conversations: { search } }
    const cache = createStatusCache()

    await handleUrgentQuery(
      { type: 'urgent' },
      { frontClient, now, cache, logger, initializeAxiom }
    )
    await handleUrgentQuery(
      { type: 'urgent' },
      { frontClient, now, cache, logger, initializeAxiom }
    )

    expect(search).toHaveBeenCalledTimes(1)

    currentTime = 31_000
    await handleUrgentQuery(
      { type: 'urgent' },
      { frontClient, now, cache, logger, initializeAxiom }
    )

    expect(search).toHaveBeenCalledTimes(2)
  })
})
