import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../helpers/test-context'

const mockGetDb = vi.fn()
const mockEq = vi.fn(() => ({}))
const mockAnd = vi.fn(() => ({}))
const mockOr = vi.fn(() => ({}))
const mockGte = vi.fn(() => ({}))
const mockDesc = vi.fn((value: unknown) => value)

vi.mock('@skillrecordings/database', () => ({
  ActionsTable: {
    id: 'id',
    type: 'type',
    app_id: 'app_id',
    conversation_id: 'conversation_id',
    created_at: 'created_at',
    parameters: 'parameters',
    approved_by: 'approved_by',
    approved_at: 'approved_at',
    rejected_by: 'rejected_by',
    rejected_at: 'rejected_at',
    category: 'category',
  },
  AppsTable: {
    id: 'id',
    slug: 'slug',
    name: 'name',
  },
  ConversationsTable: {
    front_conversation_id: 'front_conversation_id',
    customer_email: 'customer_email',
    customer_name: 'customer_name',
  },
  and: (...args: unknown[]) => mockAnd(...args),
  or: (...args: unknown[]) => mockOr(...args),
  eq: (...args: unknown[]) => mockEq(...args),
  gte: (...args: unknown[]) => mockGte(...args),
  desc: (...args: unknown[]) => mockDesc(...args),
  getDb: (...args: unknown[]) => mockGetDb(...args),
}))

import { getResponse, listResponses } from '../../../src/commands/responses'

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('responses commands', () => {
  beforeEach(() => {
    process.exitCode = undefined
    mockGetDb.mockReset()
  })

  it('list outputs JSON payload', async () => {
    const results = [
      {
        action: {
          id: 'action-1',
          type: 'draft-response',
          app_id: 'app-1',
          conversation_id: 'conv-1',
          created_at: new Date('2025-01-01T00:00:00Z'),
          parameters: { response: 'Hello', category: 'general' },
          approved_by: 'agent',
          approved_at: new Date('2025-01-01T00:00:10Z'),
        },
        app: {
          slug: 'app-1',
          name: 'App One',
        },
        conversation: {
          customer_email: 'user@example.com',
          customer_name: 'User',
        },
      },
    ]

    mockGetDb.mockImplementation(() => ({
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: async () => results,
                }),
              }),
            }),
          }),
        }),
      }),
    }))

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await listResponses(ctx, { json: true })

    const payload = parseLastJson(getStdout()) as Array<{ actionId: string }>
    expect(payload[0]?.actionId).toBe('action-1')
  })

  it('get outputs JSON payload', async () => {
    const results = [
      {
        action: {
          id: 'action-2',
          type: 'draft-response',
          app_id: 'app-1',
          conversation_id: 'conv-1',
          created_at: new Date('2025-01-02T00:00:00Z'),
          parameters: { response: 'Hello', category: 'general' },
          approved_by: null,
          rejected_by: null,
        },
        app: {
          slug: 'app-1',
          name: 'App One',
        },
        conversation: {
          customer_email: 'user@example.com',
          customer_name: 'User',
        },
      },
    ]

    mockGetDb.mockImplementation(() => ({
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({
              where: () => ({
                limit: async () => results,
              }),
            }),
          }),
        }),
      }),
    }))

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await getResponse(ctx, 'action-2', { json: true })

    const payload = parseLastJson(getStdout()) as { actionId: string }
    expect(payload.actionId).toBe('action-2')
  })
})
