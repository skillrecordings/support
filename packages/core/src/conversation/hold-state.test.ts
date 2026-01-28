import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setHold, clearHold, isOnHold, getHoldInfo } from './hold-state'

// Mock the Redis client
const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
}

vi.mock('../redis/client', () => ({
  getRedis: () => mockRedis,
}))

describe('hold-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-28T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('setHold', () => {
    it('sets a hold with correct Redis key and TTL', async () => {
      const conversationId = 'conv-123'
      const until = new Date('2025-01-28T14:00:00.000Z') // 2 hours from "now"
      const reason = 'Waiting for customer response'

      await setHold(conversationId, until, reason)

      expect(mockRedis.set).toHaveBeenCalledWith(
        'hold:conv-123',
        expect.any(String),
        { ex: 7200 } // 2 hours in seconds
      )

      // Verify the stored data
      const storedData = JSON.parse(mockRedis.set.mock.calls[0]![1] as string)
      expect(storedData).toMatchObject({
        conversationId: 'conv-123',
        until: until.getTime(),
        reason: 'Waiting for customer response',
        createdAt: new Date('2025-01-28T12:00:00.000Z').getTime(),
      })
    })

    it('rounds up TTL to avoid early expiration', async () => {
      const conversationId = 'conv-456'
      // 1.5 seconds in the future
      const until = new Date(Date.now() + 1500)
      const reason = 'Brief hold'

      await setHold(conversationId, until, reason)

      // Should round up to 2 seconds
      expect(mockRedis.set).toHaveBeenCalledWith(
        'hold:conv-456',
        expect.any(String),
        { ex: 2 }
      )
    })

    it('does not set hold if time is in the past', async () => {
      const conversationId = 'conv-789'
      const until = new Date('2025-01-28T10:00:00.000Z') // 2 hours before "now"
      const reason = 'Already expired'

      await setHold(conversationId, until, reason)

      expect(mockRedis.set).not.toHaveBeenCalled()
    })
  })

  describe('clearHold', () => {
    it('deletes the hold from Redis', async () => {
      const conversationId = 'conv-123'

      await clearHold(conversationId)

      expect(mockRedis.del).toHaveBeenCalledWith('hold:conv-123')
    })
  })

  describe('isOnHold', () => {
    it('returns true when hold exists', async () => {
      mockRedis.exists.mockResolvedValue(1)

      const result = await isOnHold('conv-123')

      expect(result).toBe(true)
      expect(mockRedis.exists).toHaveBeenCalledWith('hold:conv-123')
    })

    it('returns false when hold does not exist', async () => {
      mockRedis.exists.mockResolvedValue(0)

      const result = await isOnHold('conv-456')

      expect(result).toBe(false)
      expect(mockRedis.exists).toHaveBeenCalledWith('hold:conv-456')
    })
  })

  describe('getHoldInfo', () => {
    it('returns hold info when hold exists (JSON string)', async () => {
      const storedData = {
        conversationId: 'conv-123',
        until: new Date('2025-01-28T14:00:00.000Z').getTime(),
        reason: 'Waiting for response',
        createdAt: new Date('2025-01-28T12:00:00.000Z').getTime(),
      }
      mockRedis.get.mockResolvedValue(JSON.stringify(storedData))

      const result = await getHoldInfo('conv-123')

      expect(result).toEqual({
        conversationId: 'conv-123',
        until: new Date('2025-01-28T14:00:00.000Z'),
        reason: 'Waiting for response',
        createdAt: new Date('2025-01-28T12:00:00.000Z'),
      })
      expect(mockRedis.get).toHaveBeenCalledWith('hold:conv-123')
    })

    it('returns hold info when Upstash auto-parses JSON', async () => {
      // Upstash Redis sometimes returns already-parsed objects
      const storedData = {
        conversationId: 'conv-123',
        until: new Date('2025-01-28T14:00:00.000Z').getTime(),
        reason: 'Auto-parsed',
        createdAt: new Date('2025-01-28T12:00:00.000Z').getTime(),
      }
      mockRedis.get.mockResolvedValue(storedData)

      const result = await getHoldInfo('conv-123')

      expect(result).toEqual({
        conversationId: 'conv-123',
        until: new Date('2025-01-28T14:00:00.000Z'),
        reason: 'Auto-parsed',
        createdAt: new Date('2025-01-28T12:00:00.000Z'),
      })
    })

    it('returns null when hold does not exist', async () => {
      mockRedis.get.mockResolvedValue(null)

      const result = await getHoldInfo('conv-789')

      expect(result).toBeNull()
    })
  })
})
