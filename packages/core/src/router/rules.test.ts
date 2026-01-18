import { describe, expect, it } from 'vitest'
import { type Rule, matchRules } from './rules'

describe('matchRules', () => {
  describe('regex rules', () => {
    it('should match basic regex pattern', () => {
      const rules: Rule[] = [
        {
          id: 'refund-request',
          priority: 1,
          type: 'regex',
          pattern: '\\brefund\\b',
          action: 'escalate',
        },
      ]

      const result = matchRules(
        'I would like a refund please',
        'user@example.com',
        rules
      )

      expect(result).toEqual({
        ruleId: 'refund-request',
        action: 'escalate',
        response: undefined,
        cannedResponseId: undefined,
      })
    })

    it('should be case insensitive by default', () => {
      const rules: Rule[] = [
        {
          id: 'cancel-request',
          priority: 1,
          type: 'regex',
          pattern: '\\bcancel\\b',
          action: 'escalate',
        },
      ]

      const result = matchRules(
        'I want to CANCEL my subscription',
        'user@example.com',
        rules
      )

      expect(result).not.toBeNull()
      expect(result?.ruleId).toBe('cancel-request')
    })

    it('should not match partial words', () => {
      const rules: Rule[] = [
        {
          id: 'test-rule',
          priority: 1,
          type: 'regex',
          pattern: '\\btest\\b',
          action: 'no_respond',
        },
      ]

      const result = matchRules(
        'This is a testing message',
        'user@example.com',
        rules
      )

      expect(result).toBeNull()
    })
  })

  describe('keyword rules', () => {
    it('should match simple keyword', () => {
      const rules: Rule[] = [
        {
          id: 'spam-filter',
          priority: 1,
          type: 'keyword',
          pattern: 'unsubscribe',
          action: 'no_respond',
        },
      ]

      const result = matchRules(
        'unsubscribe me from this list',
        'user@example.com',
        rules
      )

      expect(result).toEqual({
        ruleId: 'spam-filter',
        action: 'no_respond',
        response: undefined,
        cannedResponseId: undefined,
      })
    })

    it('should match multiple keywords (OR)', () => {
      const rules: Rule[] = [
        {
          id: 'auto-reply',
          priority: 1,
          type: 'keyword',
          pattern: 'ooo|out of office|vacation',
          action: 'no_respond',
        },
      ]

      const result1 = matchRules(
        'I am ooo this week',
        'user@example.com',
        rules
      )
      expect(result1?.ruleId).toBe('auto-reply')

      const result2 = matchRules(
        'Out of office until Monday',
        'user@example.com',
        rules
      )
      expect(result2?.ruleId).toBe('auto-reply')
    })

    it('should be case insensitive', () => {
      const rules: Rule[] = [
        {
          id: 'urgent',
          priority: 1,
          type: 'keyword',
          pattern: 'urgent',
          action: 'escalate',
        },
      ]

      const result = matchRules('URGENT: need help', 'user@example.com', rules)
      expect(result?.ruleId).toBe('urgent')
    })
  })

  describe('sender_domain rules', () => {
    it('should match exact domain', () => {
      const rules: Rule[] = [
        {
          id: 'internal-email',
          priority: 1,
          type: 'sender_domain',
          pattern: 'skillrecordings.com',
          action: 'no_respond',
        },
      ]

      const result = matchRules(
        'Test message',
        'joel@skillrecordings.com',
        rules
      )

      expect(result).toEqual({
        ruleId: 'internal-email',
        action: 'no_respond',
        response: undefined,
        cannedResponseId: undefined,
      })
    })

    it('should match wildcard subdomain', () => {
      const rules: Rule[] = [
        {
          id: 'partner-domain',
          priority: 1,
          type: 'sender_domain',
          pattern: '*.example.com',
          action: 'route_to_canned',
          cannedResponseId: 'partner-response',
        },
      ]

      const result = matchRules(
        'Partner inquiry',
        'contact@support.example.com',
        rules
      )

      expect(result?.ruleId).toBe('partner-domain')
      expect(result?.cannedResponseId).toBe('partner-response')
    })

    it('should not match unrelated domain', () => {
      const rules: Rule[] = [
        {
          id: 'test-domain',
          priority: 1,
          type: 'sender_domain',
          pattern: 'test.com',
          action: 'no_respond',
        },
      ]

      const result = matchRules('Message', 'user@other.com', rules)
      expect(result).toBeNull()
    })
  })

  describe('priority ordering', () => {
    it('should respect priority (lower number = higher priority)', () => {
      const rules: Rule[] = [
        {
          id: 'low-priority',
          priority: 10,
          type: 'keyword',
          pattern: 'help',
          action: 'escalate',
        },
        {
          id: 'high-priority',
          priority: 1,
          type: 'keyword',
          pattern: 'help',
          action: 'auto_respond',
          response: 'Quick help response',
        },
      ]

      const result = matchRules('I need help', 'user@example.com', rules)

      expect(result?.ruleId).toBe('high-priority')
      expect(result?.action).toBe('auto_respond')
    })

    it('should process rules in priority order even if array is unsorted', () => {
      const rules: Rule[] = [
        {
          id: 'rule-3',
          priority: 50,
          type: 'keyword',
          pattern: 'test',
          action: 'no_respond',
        },
        {
          id: 'rule-1',
          priority: 1,
          type: 'keyword',
          pattern: 'test',
          action: 'escalate',
        },
        {
          id: 'rule-2',
          priority: 25,
          type: 'keyword',
          pattern: 'test',
          action: 'auto_respond',
          response: 'Test response',
        },
      ]

      const result = matchRules('test message', 'user@example.com', rules)
      expect(result?.ruleId).toBe('rule-1')
    })
  })

  describe('action types', () => {
    it('should return auto_respond action with response', () => {
      const rules: Rule[] = [
        {
          id: 'auto-reply',
          priority: 1,
          type: 'keyword',
          pattern: 'hours',
          action: 'auto_respond',
          response: 'Our hours are 9-5 EST',
        },
      ]

      const result = matchRules(
        'What are your hours?',
        'user@example.com',
        rules
      )

      expect(result?.action).toBe('auto_respond')
      expect(result?.response).toBe('Our hours are 9-5 EST')
    })

    it('should return route_to_canned action with cannedResponseId', () => {
      const rules: Rule[] = [
        {
          id: 'pricing',
          priority: 1,
          type: 'keyword',
          pattern: 'price|pricing|cost',
          action: 'route_to_canned',
          cannedResponseId: 'pricing-info',
        },
      ]

      const result = matchRules(
        'How much does it cost?',
        'user@example.com',
        rules
      )

      expect(result?.action).toBe('route_to_canned')
      expect(result?.cannedResponseId).toBe('pricing-info')
    })
  })

  describe('edge cases', () => {
    it('should return null when no rules match', () => {
      const rules: Rule[] = [
        {
          id: 'test',
          priority: 1,
          type: 'keyword',
          pattern: 'foo',
          action: 'no_respond',
        },
      ]

      const result = matchRules('bar baz', 'user@example.com', rules)
      expect(result).toBeNull()
    })

    it('should return null for empty rules array', () => {
      const result = matchRules('any message', 'user@example.com', [])
      expect(result).toBeNull()
    })

    it('should handle invalid regex gracefully', () => {
      const rules: Rule[] = [
        {
          id: 'bad-regex',
          priority: 1,
          type: 'regex',
          pattern: '[invalid(regex',
          action: 'no_respond',
        },
      ]

      // Should not throw, just not match
      const result = matchRules('test message', 'user@example.com', rules)
      expect(result).toBeNull()
    })

    it('should handle malformed email address', () => {
      const rules: Rule[] = [
        {
          id: 'domain-rule',
          priority: 1,
          type: 'sender_domain',
          pattern: 'test.com',
          action: 'no_respond',
        },
      ]

      const result = matchRules('message', 'not-an-email', rules)
      expect(result).toBeNull()
    })
  })
})
