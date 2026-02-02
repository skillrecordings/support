import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkIdempotency,
  generateIdempotencyKey,
  withIdempotency,
} from '../actions'
import { sortObjectDeep } from '../actions/idempotency'

// Mock the database module
vi.mock('@skillrecordings/database', () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }

  // Chain returns
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  })

  mockDb.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  })

  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  })

  mockDb.delete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })

  return {
    getDb: () => mockDb,
    IdempotencyKeysTable: {
      id: 'id',
      expires_at: 'expires_at',
    },
    eq: vi.fn((a, b) => ({ field: a, value: b })),
    and: vi.fn((...args) => args),
    gt: vi.fn((a, b) => ({ gt: { field: a, value: b } })),
    lt: vi.fn((a, b) => ({ lt: { field: a, value: b } })),
  }
})

// Mock the observability module
vi.mock('../observability/axiom', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

describe('Idempotency Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('sortObjectDeep', () => {
    it('should return primitives unchanged', () => {
      expect(sortObjectDeep('hello')).toBe('hello')
      expect(sortObjectDeep(42)).toBe(42)
      expect(sortObjectDeep(true)).toBe(true)
      expect(sortObjectDeep(null)).toBe(null)
      expect(sortObjectDeep(undefined)).toBe(undefined)
    })

    it('should sort top-level object keys', () => {
      const input = { z: 1, a: 2, m: 3 }
      const result = sortObjectDeep(input)
      expect(Object.keys(result as object)).toEqual(['a', 'm', 'z'])
    })

    it('should recursively sort nested object keys', () => {
      const input = {
        z: { c: 1, a: 2 },
        a: { z: 3, b: 4 },
      }
      const result = sortObjectDeep(input) as Record<
        string,
        Record<string, number>
      >
      expect(Object.keys(result)).toEqual(['a', 'z'])
      expect(Object.keys(result['a']!)).toEqual(['b', 'z'])
      expect(Object.keys(result['z']!)).toEqual(['a', 'c'])
    })

    it('should handle arrays by recursively sorting their object elements', () => {
      const input = [
        { z: 1, a: 2 },
        { y: 3, b: 4 },
      ]
      const result = sortObjectDeep(input) as Array<Record<string, number>>
      expect(Object.keys(result[0]!)).toEqual(['a', 'z'])
      expect(Object.keys(result[1]!)).toEqual(['b', 'y'])
    })

    it('should handle deeply nested structures', () => {
      const input = {
        level1: {
          z: {
            level3: {
              c: 1,
              a: 2,
            },
            a: 'value',
          },
          a: [{ z: 1, a: 2 }],
        },
      }
      const result = JSON.stringify(sortObjectDeep(input))
      const expected = JSON.stringify({
        level1: {
          a: [{ a: 2, z: 1 }],
          z: {
            a: 'value',
            level3: {
              a: 2,
              c: 1,
            },
          },
        },
      })
      expect(result).toBe(expected)
    })
  })

  describe('generateIdempotencyKey', () => {
    it('should generate consistent keys for same inputs', () => {
      const key1 = generateIdempotencyKey('conv-123', 'processRefund', {
        purchaseId: 'purchase-456',
        reason: 'Customer request',
      })

      const key2 = generateIdempotencyKey('conv-123', 'processRefund', {
        purchaseId: 'purchase-456',
        reason: 'Customer request',
      })

      expect(key1).toBe(key2)
    })

    it('should generate consistent keys regardless of property order', () => {
      const key1 = generateIdempotencyKey('conv-123', 'processRefund', {
        purchaseId: 'purchase-456',
        reason: 'Customer request',
      })

      const key2 = generateIdempotencyKey('conv-123', 'processRefund', {
        reason: 'Customer request',
        purchaseId: 'purchase-456',
      })

      expect(key1).toBe(key2)
    })

    it('should generate different keys for different conversation IDs', () => {
      const key1 = generateIdempotencyKey('conv-123', 'processRefund', {
        purchaseId: 'purchase-456',
      })

      const key2 = generateIdempotencyKey('conv-789', 'processRefund', {
        purchaseId: 'purchase-456',
      })

      expect(key1).not.toBe(key2)
    })

    it('should generate different keys for different tool names', () => {
      const key1 = generateIdempotencyKey('conv-123', 'processRefund', {
        purchaseId: 'purchase-456',
      })

      const key2 = generateIdempotencyKey('conv-123', 'updateEmail', {
        purchaseId: 'purchase-456',
      })

      expect(key1).not.toBe(key2)
    })

    it('should generate different keys for different arguments', () => {
      const key1 = generateIdempotencyKey('conv-123', 'processRefund', {
        purchaseId: 'purchase-456',
      })

      const key2 = generateIdempotencyKey('conv-123', 'processRefund', {
        purchaseId: 'purchase-789',
      })

      expect(key1).not.toBe(key2)
    })

    it('should have the expected format', () => {
      const key = generateIdempotencyKey('conv-123', 'processRefund', {
        purchaseId: 'purchase-456',
      })

      expect(key).toMatch(/^conv-123:processRefund:[a-f0-9]{16}$/)
    })

    it('should generate consistent keys regardless of nested object property order', () => {
      const key1 = generateIdempotencyKey('conv-123', 'updateCustomer', {
        customer: {
          address: {
            city: 'Portland',
            state: 'OR',
          },
          name: 'John Doe',
        },
        action: 'update',
      })

      const key2 = generateIdempotencyKey('conv-123', 'updateCustomer', {
        action: 'update',
        customer: {
          name: 'John Doe',
          address: {
            state: 'OR',
            city: 'Portland',
          },
        },
      })

      expect(key1).toBe(key2)
    })

    it('should generate different keys for different nested values', () => {
      const key1 = generateIdempotencyKey('conv-123', 'updateCustomer', {
        customer: {
          address: {
            city: 'Portland',
            state: 'OR',
          },
        },
      })

      const key2 = generateIdempotencyKey('conv-123', 'updateCustomer', {
        customer: {
          address: {
            city: 'Seattle',
            state: 'WA',
          },
        },
      })

      expect(key1).not.toBe(key2)
    })

    it('should handle arrays within nested objects', () => {
      const key1 = generateIdempotencyKey('conv-123', 'updateOrder', {
        order: {
          items: [
            { sku: 'ABC', quantity: 2 },
            { sku: 'XYZ', quantity: 1 },
          ],
        },
      })

      const key2 = generateIdempotencyKey('conv-123', 'updateOrder', {
        order: {
          items: [
            { quantity: 2, sku: 'ABC' },
            { quantity: 1, sku: 'XYZ' },
          ],
        },
      })

      // Same data, different key order within array objects - should be same
      expect(key1).toBe(key2)
    })
  })

  describe('checkIdempotency', () => {
    it('should return isDuplicate: false for new operations', async () => {
      const result = await checkIdempotency({
        conversationId: 'conv-123',
        toolName: 'processRefund',
        args: { purchaseId: 'purchase-456' },
      })

      expect(result.isDuplicate).toBe(false)
      expect(result.key).toMatch(/^conv-123:processRefund:/)
    })

    it('should return isDuplicate: true when key exists', async () => {
      // Mock existing key
      const { getDb } = await import('@skillrecordings/database')
      const db = getDb()
      ;(db.select().from as ReturnType<typeof vi.fn>).mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: 'conv-123:processRefund:abc123',
            status: 'completed',
            result: { success: true },
            error: null,
          },
        ]),
      })

      const result = await checkIdempotency({
        conversationId: 'conv-123',
        toolName: 'processRefund',
        args: { purchaseId: 'purchase-456' },
      })

      expect(result.isDuplicate).toBe(true)
      expect(result.status).toBe('completed')
      expect(result.cachedResult?.result).toEqual({ success: true })
    })
  })

  describe('withIdempotency', () => {
    beforeEach(async () => {
      // Reset mocks to return no existing key (new operation)
      const { getDb } = await import('@skillrecordings/database')
      const db = getDb()
      ;(db.select().from as ReturnType<typeof vi.fn>).mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      })
    })

    it('should execute function for new operations', async () => {
      const executeFn = vi
        .fn()
        .mockResolvedValue({ success: true, data: 'test' })

      const { result, wasCached } = await withIdempotency(
        {
          conversationId: 'conv-123',
          toolName: 'testTool',
          args: { test: true },
        },
        executeFn
      )

      expect(executeFn).toHaveBeenCalledTimes(1)
      expect(wasCached).toBe(false)
      expect(result).toEqual({ success: true, data: 'test' })
    })

    it('should return cached result for duplicate completed operations', async () => {
      // Mock existing completed key
      const { getDb } = await import('@skillrecordings/database')
      const db = getDb()
      ;(db.select().from as ReturnType<typeof vi.fn>).mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: 'test-key',
            status: 'completed',
            result: { success: true, cached: true },
            error: null,
          },
        ]),
      })

      const executeFn = vi
        .fn()
        .mockResolvedValue({ success: true, data: 'new' })

      const { result, wasCached } = await withIdempotency(
        {
          conversationId: 'conv-123',
          toolName: 'testTool',
          args: { test: true },
        },
        executeFn
      )

      expect(executeFn).not.toHaveBeenCalled()
      expect(wasCached).toBe(true)
      expect(result).toEqual({ success: true, cached: true })
    })

    it('should throw for pending duplicate operations', async () => {
      // Mock existing pending key
      const { getDb } = await import('@skillrecordings/database')
      const db = getDb()
      ;(db.select().from as ReturnType<typeof vi.fn>).mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: 'test-key',
            status: 'pending',
            result: null,
            error: null,
          },
        ]),
      })

      const executeFn = vi.fn()

      await expect(
        withIdempotency(
          {
            conversationId: 'conv-123',
            toolName: 'testTool',
            args: { test: true },
          },
          executeFn
        )
      ).rejects.toThrow('already in progress')

      expect(executeFn).not.toHaveBeenCalled()
    })

    it('should re-throw cached errors for failed operations', async () => {
      // Mock existing failed key
      const { getDb } = await import('@skillrecordings/database')
      const db = getDb()
      ;(db.select().from as ReturnType<typeof vi.fn>).mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: 'test-key',
            status: 'failed',
            result: null,
            error: 'Previous execution failed: API error',
          },
        ]),
      })

      const executeFn = vi.fn()

      await expect(
        withIdempotency(
          {
            conversationId: 'conv-123',
            toolName: 'testTool',
            args: { test: true },
          },
          executeFn
        )
      ).rejects.toThrow('Previous execution failed: API error')

      expect(executeFn).not.toHaveBeenCalled()
    })
  })
})
