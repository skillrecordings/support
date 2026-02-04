import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../helpers/test-context'

const mockGetDb = vi.hoisted(() => vi.fn())
const mockDesc = vi.hoisted(() => vi.fn((value: unknown) => value))
const mockSql = vi.hoisted(() =>
  vi.fn(() => ({
    as: vi.fn().mockReturnValue({}),
  }))
)

vi.mock('@skillrecordings/database', () => ({
  ConversationsTable: {
    status: 'status',
    updated_at: 'updated_at',
    front_conversation_id: 'front_conversation_id',
  },
  desc: mockDesc,
  sql: mockSql,
  getDb: mockGetDb,
}))

import { dbStatus } from '../../../src/commands/db-status'

describe('db-status command', () => {
  beforeEach(() => {
    mockGetDb.mockReset()
    mockDesc.mockClear()
    mockSql.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const cases = [
    {
      name: 'success',
      run: async () => {
        const statusCounts = [
          { status: 'open', count: 2 },
          { status: 'closed', count: 1 },
        ]
        const recent = [
          {
            front_conversation_id: 'conv_1',
            status: 'open',
            updated_at: new Date('2025-01-01T00:00:00.000Z'),
          },
        ]

        const statusQuery = {
          from: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockResolvedValue(statusCounts),
        }

        const recentQuery = {
          from: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(recent),
        }

        const db = {
          select: vi
            .fn()
            .mockImplementationOnce(() => statusQuery)
            .mockImplementationOnce(() => recentQuery),
        }

        mockGetDb.mockReturnValue(db)

        const { ctx, getStdout, getStderr } = await createTestContext()

        await dbStatus(ctx)

        expect(getStderr()).toBe('')
        const output = getStdout()
        expect(output).toContain('Conversation counts by status:')
        expect(output).toContain('open: 2')
        expect(output).toContain('closed: 1')
        expect(output).toContain('Recent conversations:')
        expect(output).toContain('conv_1: open')
      },
    },
    {
      name: 'connection failure',
      run: async () => {
        const statusQuery = {
          from: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockRejectedValue(new Error('Connection refused')),
        }

        const db = {
          select: vi.fn().mockImplementationOnce(() => statusQuery),
        }

        mockGetDb.mockReturnValue(db)

        const { ctx, getStderr } = await createTestContext()

        await dbStatus(ctx)

        const errorOutput = getStderr()
        expect(errorOutput).toContain('Database connection failed.')
        expect(errorOutput).toContain('Suggestion:')
      },
    },
    {
      name: 'timeout',
      run: async () => {
        vi.useFakeTimers()

        const statusQuery = {
          from: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockImplementation(() => new Promise(() => {})),
        }

        const db = {
          select: vi.fn().mockImplementationOnce(() => statusQuery),
        }

        mockGetDb.mockReturnValue(db)

        const { ctx, getStderr } = await createTestContext({
          config: { dbStatusTimeoutMs: 5 },
        })

        const run = dbStatus(ctx)

        await vi.advanceTimersByTimeAsync(10)
        await run

        const errorOutput = getStderr()
        expect(errorOutput).toContain('Database request timed out.')
        expect(errorOutput).toContain('Suggestion:')
      },
    },
  ]

  it.each(cases)('$name', async ({ run }) => {
    await run()
  })
})
