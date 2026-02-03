import { describe, expect, it, vi } from 'vitest'
import type { Conversation, ConversationList } from '../../../../front-sdk/src'
import { formatCustomerProfileBlocks } from '../../formatters/customer'
import {
  handleHistoryQuery,
  handleProfileQuery,
  parseCustomerQuery,
} from '../context'

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

describe('customer context parsing', () => {
  it('parses history with email', () => {
    expect(parseCustomerQuery('history with jane@example.com')).toEqual({
      type: 'history',
      email: 'jane@example.com',
    })
  })

  it('parses who is query with identifier', () => {
    expect(parseCustomerQuery('who is Ada Lovelace')).toEqual({
      type: 'profile',
      email: 'Ada Lovelace',
    })
  })
})

describe('customer context handlers', () => {
  it('assembles profile from multiple sources', async () => {
    const conversations = [
      makeConversation({
        id: 'cnv_1',
        subject: 'License transfer',
        status: 'archived',
        created_at: 100,
      }),
      makeConversation({
        id: 'cnv_2',
        subject: 'Login issue',
        status: 'unassigned',
        created_at: 200,
      }),
    ]

    const frontClient = {
      conversations: {
        search: vi.fn().mockResolvedValue(mockConversationList(conversations)),
      },
    }

    const lookupUser = vi.fn().mockResolvedValue({
      id: 'user_1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      createdAt: new Date('2024-01-01T00:00:00Z'),
    })

    const purchaseLookup = vi.fn().mockResolvedValue([
      {
        id: 'pur_1',
        productId: 'tt',
        productName: 'Total TypeScript',
        purchasedAt: new Date('2025-01-10T00:00:00Z'),
        amount: 19900,
        currency: 'USD',
        status: 'active',
      },
      {
        id: 'pur_2',
        productId: 'er',
        productName: 'Epic React',
        purchasedAt: new Date('2024-03-15T00:00:00Z'),
        amount: 24900,
        currency: 'USD',
        status: 'active',
      },
    ])

    const result = await handleProfileQuery(
      { type: 'profile', email: 'ada@example.com' },
      {
        frontClient,
        lookupUser,
        purchaseLookup,
        now: () => new Date('2025-02-01T00:00:00Z'),
      }
    )

    expect(result.profile.name).toBe('Ada Lovelace')
    expect(result.profile.products).toEqual(['Total TypeScript', 'Epic React'])
    expect(result.profile.lifetimeValue).toBe(448)
    expect(result.profile.supportStats.totalTickets).toBe(2)
    expect(result.profile.supportStats.resolvedTickets).toBe(1)
    expect(result.profile.supportStats.lastContact?.getTime()).toBe(200000)
  })

  it('handles empty history state', async () => {
    const frontClient = {
      conversations: {
        search: vi.fn().mockResolvedValue(mockConversationList([])),
      },
    }

    const result = await handleHistoryQuery(
      { type: 'history', email: 'empty@example.com' },
      { frontClient }
    )

    expect(result.empty).toBe(true)
    expect(result.text).toContain('No prior conversations')
  })
})

describe('customer context formatting', () => {
  it('formats Slack blocks for profile', () => {
    const profile = {
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      products: ['Total TypeScript', 'Epic React'],
      lifetimeValue: 448,
      supportStats: {
        totalTickets: 2,
        resolvedTickets: 1,
        lastContact: new Date('2025-01-15T00:00:00Z'),
      },
    }

    const blocks = formatCustomerProfileBlocks({
      profile,
      purchases: [
        {
          productName: 'Total TypeScript',
          purchasedAt: new Date('2025-01-10T00:00:00Z'),
        },
      ],
      history: [
        {
          conversationId: 'cnv_1',
          subject: 'License transfer',
          status: 'resolved',
        },
      ],
      now: new Date('2025-02-01T00:00:00Z'),
    })

    expect(blocks.blocks[0]?.type).toBe('section')
    expect(blocks.blocks[0]?.text?.text).toContain('Customer Profile')
    expect(blocks.blocks[2]?.text?.text).toContain('ada@example.com')
    expect(blocks.blocks[3]?.text?.text).toContain('Products')
    expect(blocks.blocks[4]?.text?.text).toContain('Support History')
  })
})
