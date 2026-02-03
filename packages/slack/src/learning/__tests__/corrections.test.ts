import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRedis } from '../../../../core/src/redis/client'
import { listCorrectionEvents, recordCorrectionEvent } from '../corrections'

vi.mock('../../../../core/src/redis/client', () => ({
  getRedis: vi.fn(),
}))

const mockedGetRedis = getRedis as unknown as {
  mockReturnValue: (value: unknown) => void
}

const mockRedis = {
  lpush: vi.fn(),
  lrange: vi.fn(),
}

const logger = vi.fn().mockResolvedValue(undefined)
const initializeAxiom = vi.fn()

describe('correction events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedis.lpush.mockResolvedValue(1)
    mockRedis.lrange.mockResolvedValue([])
    mockedGetRedis.mockReturnValue(mockRedis as never)
  })

  it('captures correction events for learning', async () => {
    const now = new Date('2026-02-03T00:00:00Z')
    const result = await recordCorrectionEvent(
      {
        conversationId: 'conv-1',
        originalDraft: 'Original draft',
        revisedDraft: 'Revised draft',
        refinementType: 'simplify',
        userId: 'U1',
        timestamp: now,
        threadTs: 'thread-1',
      },
      { logger, initializeAxiom }
    )

    expect(result.status).toBe('ok')
    expect(mockRedis.lpush).toHaveBeenCalledTimes(2)

    const payload = JSON.parse(mockRedis.lpush.mock.calls[0]?.[1] as string)
    expect(payload.conversationId).toBe('conv-1')
    expect(payload.timestamp).toBe(now.toISOString())
  })

  it('lists correction events', async () => {
    const stored = {
      conversationId: 'conv-2',
      originalDraft: 'Draft',
      revisedDraft: 'Draft revised',
      refinementType: 'shorten',
      userId: 'U2',
      timestamp: '2026-02-03T02:00:00Z',
      threadTs: 'thread-2',
    }

    mockRedis.lrange.mockResolvedValue([JSON.stringify(stored)])

    const result = await listCorrectionEvents(5)
    expect(result).toHaveLength(1)
    expect(result[0]?.conversationId).toBe('conv-2')
    expect(result[0]?.timestamp).toEqual(new Date(stored.timestamp))
  })
})
