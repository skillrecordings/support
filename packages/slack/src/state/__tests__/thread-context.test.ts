import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRedis } from '../../../../core/src/redis/client'
import {
  DEFAULT_THREAD_CONTEXT_TTL_SECONDS,
  STALE_THREAD_MESSAGE,
  clearThreadContext,
  createThreadContext,
  getThreadContext,
  setThreadContext,
  shouldClearThreadContext,
} from '../thread-context'

vi.mock('../../../../core/src/redis/client', () => ({
  getRedis: vi.fn(),
}))

const mockedGetRedis = getRedis as unknown as {
  mockReturnValue: (value: unknown) => void
  mockImplementation: (fn: () => never) => void
}

const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}

const logger = vi.fn().mockResolvedValue(undefined)
const initializeAxiom = vi.fn()

describe('thread context state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedis.set.mockResolvedValue('OK')
    mockRedis.get.mockResolvedValue(null)
    mockRedis.del.mockResolvedValue(1)
    mockedGetRedis.mockReturnValue(mockRedis as never)
  })

  it('stores and retrieves thread context', async () => {
    const now = new Date('2026-02-03T00:00:00Z')
    const context = createThreadContext({
      threadTs: 'thread-1',
      channelId: 'C1',
      conversationId: 'conv-1',
      currentDraft: 'Draft text',
      draftVersion: 2,
      customerId: 'cust-1',
      now: () => now,
    })

    const setResult = await setThreadContext(context, {
      logger,
      initializeAxiom,
      now: () => now,
    })

    expect(setResult.status).toBe('ok')
    expect(mockRedis.set).toHaveBeenCalledWith(
      'slack:thread-context:thread-1',
      expect.any(String),
      { ex: DEFAULT_THREAD_CONTEXT_TTL_SECONDS }
    )

    const stored = mockRedis.set.mock.calls[0]?.[1] as string
    mockRedis.get.mockResolvedValue(stored)

    const result = await getThreadContext('thread-1', {
      logger,
      initializeAxiom,
      now: () => now,
    })

    expect(result.status).toBe('active')
    if (result.status === 'active') {
      expect(result.context.conversationId).toBe('conv-1')
      expect(result.context.customerId).toBe('cust-1')
      expect(result.context.draftVersion).toBe(2)
    }
  })

  it('detects stale thread context and clears it', async () => {
    const now = new Date('2026-02-03T01:00:00Z')
    const stale = new Date(
      now.getTime() - (DEFAULT_THREAD_CONTEXT_TTL_SECONDS + 60) * 1000
    )

    const stored = {
      threadTs: 'thread-2',
      channelId: 'C2',
      conversationId: 'conv-2',
      currentDraft: 'Old draft',
      draftVersion: 1,
      createdAt: stale.toISOString(),
      lastActivityAt: stale.toISOString(),
      ttlSeconds: DEFAULT_THREAD_CONTEXT_TTL_SECONDS,
    }

    mockRedis.get.mockResolvedValue(JSON.stringify(stored))

    const result = await getThreadContext('thread-2', {
      logger,
      initializeAxiom,
      now: () => now,
    })

    expect(result.status).toBe('stale')
    expect(result.message).toBe(STALE_THREAD_MESSAGE)
    expect(mockRedis.del).toHaveBeenCalledWith('slack:thread-context:thread-2')
  })

  it('detects explicit reset language', () => {
    expect(shouldClearThreadContext('new topic')).toBe(true)
    expect(shouldClearThreadContext('different customer')).toBe(true)
    expect(shouldClearThreadContext('hello there')).toBe(false)
  })

  it('handles redis errors gracefully', async () => {
    mockedGetRedis.mockImplementation(() => {
      throw new Error('redis down')
    })

    const result = await getThreadContext('thread-3', {
      logger,
      initializeAxiom,
    })

    expect(result.status).toBe('error')
  })

  it('clears thread context', async () => {
    await clearThreadContext('thread-4', { logger, initializeAxiom })
    expect(mockRedis.del).toHaveBeenCalledWith('slack:thread-context:thread-4')
  })
})
