import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routeMessage } from './message-router'
import type { RouterDecision, RoutingContext } from './message-router'
import type { Rule } from './types'

// Mock the classifier to avoid hitting real AI Gateway in tests
const mockClassifyMessage = vi.hoisted(() => vi.fn())
vi.mock('./classifier', () => ({
  classifyMessage: mockClassifyMessage,
}))

describe('routeMessage', () => {
  let mockCache: any
  let context: RoutingContext

  beforeEach(() => {
    vi.clearAllMocks()

    // Default classifier mock - high confidence classification
    mockClassifyMessage.mockResolvedValue({
      category: 'general',
      confidence: 0.85,
      reasoning: 'Mock classification for testing',
    })

    mockCache = {
      getDecision: vi.fn().mockReturnValue(null),
      setDecision: vi.fn(),
    }

    context = {
      conversationId: 'conv-123',
      messageId: 'msg-456',
      sender: '[EMAIL]',
      rules: [],
      cache: mockCache,
    }
  })

  describe('cache hits', () => {
    it('returns cached decision when available', async () => {
      const cachedDecision: RouterDecision = {
        route: 'rule',
        reason: 'Cached from previous routing',
        confidence: 1.0,
        category: 'cached',
        ruleId: 'cache-rule',
      }

      mockCache.getDecision.mockReturnValue(cachedDecision)

      const result = await routeMessage('test message', context)

      expect(result).toEqual(cachedDecision)
      expect(mockCache.getDecision).toHaveBeenCalledWith('conv-123:msg-456')
      expect(mockCache.setDecision).not.toHaveBeenCalled()
    })
  })

  describe('rule-based routing', () => {
    it('routes via rules when rule matches', async () => {
      const rules: Rule[] = [
        {
          id: 'refund-rule',
          priority: 1,
          type: 'keyword',
          pattern: 'refund',
          action: 'escalate',
        },
      ]

      context.rules = rules

      const result = await routeMessage('I want a refund please', context)

      expect(result.route).toBe('rule')
      expect(result.ruleId).toBe('refund-rule')
      expect(result.confidence).toBe(1.0)
      expect(mockCache.setDecision).toHaveBeenCalledWith(
        'conv-123:msg-456',
        result
      )
    })

    it('includes canned response ID when rule routes to canned response', async () => {
      const rules: Rule[] = [
        {
          id: 'status-check',
          priority: 1,
          type: 'keyword',
          pattern: 'status|where is',
          action: 'route_to_canned',
          cannedResponseId: 'canned-status-update',
        },
      ]

      context.rules = rules

      const result = await routeMessage('Where is my order?', context)

      expect(result.route).toBe('canned')
      expect(result.ruleId).toBe('status-check')
      expect(result.cannedResponseId).toBe('canned-status-update')
      expect(result.confidence).toBe(1.0)
    })
  })

  describe('canned response routing', () => {
    it('routes to canned when canned matcher succeeds', async () => {
      context.cannedResponses = [
        {
          id: 'canned-thanks',
          pattern: 'thanks|thank you',
          response: 'You are welcome!',
        },
      ]

      const result = await routeMessage('Thanks for your help!', context)

      expect(result.route).toBe('canned')
      expect(result.cannedResponseId).toBe('canned-thanks')
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
    })

    it('skips canned when no canned responses provided', async () => {
      // No cannedResponses in context
      // Should skip to classifier

      // Mock classifier by using a message that clearly needs response
      const result = await routeMessage('I need help with billing', context)

      expect(result.route).not.toBe('canned')
    })
  })

  describe('classifier routing', () => {
    it('routes via classifier when rules and canned do not match', async () => {
      // Message that does not match any rules or canned responses
      const result = await routeMessage(
        'What are your business hours?',
        context
      )

      expect(result.route).toBe('classifier')
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.category).toBeDefined()
    })

    it('includes conversation context when available', async () => {
      context.recentMessages = [
        'I purchased your product yesterday',
        'But I have not received my license key',
      ]

      const result = await routeMessage('Can you help?', context)

      expect(result.route).toBe('classifier')
      expect(result.category).toBeDefined()
    })
  })

  describe('agent fallback', () => {
    it('routes to agent when classifier confidence is low', async () => {
      // Mock low confidence from classifier
      mockClassifyMessage.mockResolvedValue({
        category: 'general',
        confidence: 0.5,
        reasoning: 'Ambiguous message, low confidence',
      })

      const result = await routeMessage('...', context)

      // Router should upgrade to agent route when confidence is low
      expect(result.route).toBe('agent')
      expect(result.confidence).toBeLessThan(0.7)
    })
  })

  describe('pipeline order', () => {
    it('checks cache first, exits early on hit', async () => {
      const cachedDecision: RouterDecision = {
        route: 'rule',
        reason: 'Cached',
        confidence: 1.0,
        category: 'test',
      }

      mockCache.getDecision.mockReturnValue(cachedDecision)

      // Provide rules that WOULD match, but cache should prevent evaluation
      context.rules = [
        {
          id: 'test-rule',
          priority: 1,
          type: 'keyword',
          pattern: 'test',
          action: 'escalate',
        },
      ]

      await routeMessage('test message', context)

      // Cache hit means we never evaluate rules
      expect(mockCache.getDecision).toHaveBeenCalled()
    })

    it('checks rules before canned responses', async () => {
      const rules: Rule[] = [
        {
          id: 'priority-rule',
          priority: 1,
          type: 'keyword',
          pattern: 'urgent',
          action: 'escalate',
        },
      ]

      context.rules = rules
      context.cannedResponses = [
        {
          id: 'canned-urgent',
          pattern: 'urgent',
          response: 'We will help ASAP',
        },
      ]

      const result = await routeMessage('This is urgent!', context)

      // Rule takes precedence
      expect(result.route).toBe('rule')
      expect(result.ruleId).toBe('priority-rule')
    })
  })
})
