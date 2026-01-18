import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterCache } from './cache'
import type { RouterDecision } from './types'

describe('RouterCache', () => {
  let cache: RouterCache
  let mockNow: number

  beforeEach(() => {
    mockNow = Date.now()
    vi.useFakeTimers()
    vi.setSystemTime(mockNow)

    cache = new RouterCache({
      decisionTtlMs: 60 * 60 * 1000, // 1 hour
      contextTtlMs: 24 * 60 * 60 * 1000, // 24 hours
    })
  })

  describe('getDecision', () => {
    it('returns null for unknown message ID', () => {
      const result = cache.getDecision('unknown-message-id')
      expect(result).toBeNull()
    })

    it('returns cached decision within TTL', () => {
      const decision: RouterDecision = {
        route: 'canned',
        reason: 'Test reason',
        confidence: 0.95,
        category: 'refund',
        cannedResponseId: 'canned-123',
      }

      cache.setDecision('msg-1', decision)
      const result = cache.getDecision('msg-1')

      expect(result).toEqual(decision)
    })

    it('returns null for expired decision (past TTL)', () => {
      const decision: RouterDecision = {
        route: 'agent',
        reason: 'Needs custom response',
        confidence: 0.8,
        category: 'technical',
      }

      cache.setDecision('msg-2', decision)

      // Advance time past 1 hour TTL
      vi.advanceTimersByTime(61 * 60 * 1000)

      const result = cache.getDecision('msg-2')
      expect(result).toBeNull()
    })
  })

  describe('setDecision', () => {
    it('stores decision with current timestamp', () => {
      const decision: RouterDecision = {
        route: 'rule',
        reason: 'Matched auto-respond rule',
        confidence: 1.0,
        category: 'no_response',
        ruleId: 'rule-456',
      }

      cache.setDecision('msg-3', decision)
      const result = cache.getDecision('msg-3')

      expect(result).toEqual(decision)
    })

    it('overwrites existing decision for same message ID', () => {
      const decision1: RouterDecision = {
        route: 'classifier',
        reason: 'First classification',
        confidence: 0.7,
        category: 'general',
      }

      const decision2: RouterDecision = {
        route: 'agent',
        reason: 'Second classification',
        confidence: 0.9,
        category: 'billing',
      }

      cache.setDecision('msg-4', decision1)
      cache.setDecision('msg-4', decision2)

      const result = cache.getDecision('msg-4')
      expect(result).toEqual(decision2)
    })
  })

  describe('invalidateConversation', () => {
    it('removes all decisions for a conversation', () => {
      const decision1: RouterDecision = {
        route: 'canned',
        reason: 'Standard refund response',
        confidence: 0.95,
        category: 'refund',
        cannedResponseId: 'refund-001',
      }

      const decision2: RouterDecision = {
        route: 'agent',
        reason: 'Follow-up question',
        confidence: 0.85,
        category: 'technical',
      }

      // Store decisions with conversation ID prefix
      cache.setDecision('conv-abc:msg-1', decision1)
      cache.setDecision('conv-abc:msg-2', decision2)
      cache.setDecision('conv-xyz:msg-3', decision1)

      // Invalidate conversation abc
      cache.invalidateConversation('conv-abc')

      // Decisions for conv-abc should be gone
      expect(cache.getDecision('conv-abc:msg-1')).toBeNull()
      expect(cache.getDecision('conv-abc:msg-2')).toBeNull()

      // Decision for conv-xyz should remain
      expect(cache.getDecision('conv-xyz:msg-3')).toEqual(decision1)
    })

    it('handles invalidation of non-existent conversation gracefully', () => {
      expect(() => {
        cache.invalidateConversation('conv-nonexistent')
      }).not.toThrow()
    })
  })

  describe('idempotency', () => {
    it('serves cached decision on duplicate Front event', () => {
      const decision: RouterDecision = {
        route: 'canned',
        reason: 'Duplicate event',
        confidence: 0.92,
        category: 'account_issue',
        cannedResponseId: 'account-help-001',
      }

      // First event
      cache.setDecision('msg-duplicate', decision)
      const firstResult = cache.getDecision('msg-duplicate')

      // Duplicate event (same message ID)
      const secondResult = cache.getDecision('msg-duplicate')

      expect(firstResult).toEqual(decision)
      expect(secondResult).toEqual(decision)
      expect(firstResult).toEqual(secondResult)
    })
  })

  describe('TTL edge cases', () => {
    it('decision expires exactly at TTL boundary', () => {
      const decision: RouterDecision = {
        route: 'agent',
        reason: 'Complex query',
        confidence: 0.75,
        category: 'general',
      }

      cache.setDecision('msg-ttl', decision)

      // Advance time to exactly 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000)

      const result = cache.getDecision('msg-ttl')
      expect(result).toBeNull()
    })

    it('decision available just before TTL expires', () => {
      const decision: RouterDecision = {
        route: 'classifier',
        reason: 'Nearly expired',
        confidence: 0.88,
        category: 'billing',
      }

      cache.setDecision('msg-almost-expired', decision)

      // Advance time to 1 millisecond before TTL
      vi.advanceTimersByTime(60 * 60 * 1000 - 1)

      const result = cache.getDecision('msg-almost-expired')
      expect(result).toEqual(decision)
    })
  })
})
