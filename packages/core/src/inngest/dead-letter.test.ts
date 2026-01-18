import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DLQ_OPTIONS,
  alertOnFailure,
  calculateBackoff,
  recordFailedEvent,
  withDeadLetter,
} from './dead-letter'

// Mock the database module
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
}

vi.mock('@skillrecordings/database', () => ({
  getDb: () => mockDb,
  DeadLetterQueueTable: {},
  eq: vi.fn(),
  desc: vi.fn(),
}))

describe('Dead Letter Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mockDb to return empty results by default
    mockDb.limit.mockResolvedValue([])
  })

  describe('calculateBackoff', () => {
    it('should calculate exponential backoff correctly', () => {
      const backoff = { type: 'exponential' as const, base: 1000 }

      expect(calculateBackoff(0, backoff)).toBe(1000) // 1000 * 2^0
      expect(calculateBackoff(1, backoff)).toBe(2000) // 1000 * 2^1
      expect(calculateBackoff(2, backoff)).toBe(4000) // 1000 * 2^2
      expect(calculateBackoff(3, backoff)).toBe(8000) // 1000 * 2^3
    })

    it('should calculate linear backoff correctly', () => {
      const backoff = { type: 'linear' as const, base: 500 }

      expect(calculateBackoff(0, backoff)).toBe(500) // 500 * 1
      expect(calculateBackoff(1, backoff)).toBe(1000) // 500 * 2
      expect(calculateBackoff(2, backoff)).toBe(1500) // 500 * 3
      expect(calculateBackoff(3, backoff)).toBe(2000) // 500 * 4
    })

    it('should use default backoff when strategy is undefined', () => {
      expect(calculateBackoff(1, undefined)).toBe(2000) // Default exponential
    })
  })

  describe('recordFailedEvent', () => {
    it('should record new failure with consecutive_failures = 1', async () => {
      const event = {
        name: 'support/inbound.received',
        data: { conversationId: 'conv-123' },
        error: new Error('Test error'),
      }

      mockDb.limit.mockResolvedValue([]) // No existing failures

      const result = await recordFailedEvent(event, 2)

      expect(result.consecutiveFailures).toBe(1)
      expect(mockDb.insert).toHaveBeenCalled()
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          event_name: 'support/inbound.received',
          error_message: 'Test error',
          retry_count: 2,
          consecutive_failures: 1,
        })
      )
    })

    it('should increment consecutive_failures on repeated failure', async () => {
      const event = {
        name: 'support/inbound.received',
        data: { conversationId: 'conv-123' },
        error: new Error('Test error'),
      }

      mockDb.limit.mockResolvedValue([
        {
          id: 'existing-id',
          consecutive_failures: 2,
          last_failed_at: new Date(),
        },
      ])

      const result = await recordFailedEvent(event, 3)

      expect(result.consecutiveFailures).toBe(3) // 2 + 1
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutive_failures: 3,
          retry_count: 3,
        })
      )
    })

    it('should include error stack when available', async () => {
      const error = new Error('Test error with stack')
      error.stack = 'Error: Test error\n  at test.ts:123'

      const event = {
        name: 'support/inbound.received',
        data: {},
        error,
      }

      mockDb.limit.mockResolvedValue([])

      await recordFailedEvent(event, 1)

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          error_stack: expect.stringContaining('at test.ts:123'),
        })
      )
    })
  })

  describe('withDeadLetter', () => {
    it('should return wrapped function', () => {
      const mockFn = vi.fn()
      const wrappedFn = withDeadLetter(mockFn as any, {
        maxRetries: 3,
        backoff: { type: 'exponential', base: 1000 },
      })

      expect(wrappedFn).toBeDefined()
      expect(typeof wrappedFn).toBe('function')
    })

    it('should accept configurable options', () => {
      const mockFn = vi.fn()
      const wrappedFn = withDeadLetter(mockFn as any, {
        maxRetries: 5,
        backoff: { type: 'linear', base: 200 },
        alertThreshold: 2,
      })

      expect(wrappedFn).toBeDefined()
    })

    it('should work with default options', () => {
      const mockFn = vi.fn()
      const wrappedFn = withDeadLetter(mockFn as any)

      expect(wrappedFn).toBeDefined()
    })
  })

  describe('alertOnFailure', () => {
    let consoleWarnSpy: any

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockDb.limit.mockResolvedValue([])
    })

    afterEach(() => {
      consoleWarnSpy.mockRestore()
    })

    it('should not alert for fewer than threshold failures', async () => {
      const event = {
        name: 'support/inbound.received',
        data: { conversationId: 'conv-123' },
        error: new Error('Test error'),
      }

      await alertOnFailure(event, 2)

      expect(consoleWarnSpy).not.toHaveBeenCalled()
      expect(mockDb.select).not.toHaveBeenCalled()
    })

    it('should alert after threshold consecutive failures', async () => {
      const event = {
        name: 'support/inbound.received',
        data: { conversationId: 'conv-123' },
        error: new Error('Database connection failed'),
      }

      await alertOnFailure(event, 3)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('3 consecutive failures'),
        'Database connection failed',
        expect.objectContaining({
          eventData: { conversationId: 'conv-123' },
        })
      )
    })

    it('should mark failure as alerted in database', async () => {
      const event = {
        name: 'support/inbound.received',
        data: {},
        error: new Error('Test'),
      }

      mockDb.limit.mockResolvedValue([
        {
          id: 'dlq-123',
          event_name: 'support/inbound.received',
          alerted_at: null,
        },
      ])

      await alertOnFailure(event, 5)

      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          alerted_at: expect.any(Date),
        })
      )
    })

    it('should not update if already alerted', async () => {
      const event = {
        name: 'support/inbound.received',
        data: {},
        error: new Error('Test'),
      }

      mockDb.limit.mockResolvedValue([
        {
          id: 'dlq-123',
          alerted_at: new Date(), // Already alerted
        },
      ])

      await alertOnFailure(event, 4)

      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should include error stack in alert data', async () => {
      const error = new Error('Critical failure')
      error.stack = 'Error: Critical\n  at handler.ts:42'

      const event = {
        name: 'support/action.approved',
        data: { actionId: 'act-123' },
        error,
      }

      await alertOnFailure(event, 3)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          errorStack: expect.stringContaining('at handler.ts:42'),
        })
      )
    })
  })

  describe('DEFAULT_DLQ_OPTIONS', () => {
    it('should export sensible defaults', () => {
      expect(DEFAULT_DLQ_OPTIONS.maxRetries).toBe(3)
      expect(DEFAULT_DLQ_OPTIONS.backoff.type).toBe('exponential')
      expect(DEFAULT_DLQ_OPTIONS.backoff.base).toBe(1000)
      expect(DEFAULT_DLQ_OPTIONS.alertThreshold).toBe(3)
    })
  })
})
