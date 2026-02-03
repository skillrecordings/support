/**
 * Integration tests for the full pipeline
 *
 * Tests end-to-end flow with mocked external services (Upstash).
 * Validates that all validator checks work together correctly.
 */

import { generateObject } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { retrieveSkills } from '../../skill-retrieval'
import { validate } from '../steps/validate'
import * as validateModule from '../steps/validate'
import type { GatherOutput, MessageCategory } from '../types'

// Mock external dependencies
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('../../skill-retrieval', () => ({
  retrieveSkills: vi.fn(),
}))

const retrieveSkillsMock = retrieveSkills as unknown as ReturnType<typeof vi.fn>
const generateObjectMock = generateObject as unknown as ReturnType<typeof vi.fn>

// Fixtures simulating real Upstash skill data
const MOCK_SKILLS = {
  refundPolicy: {
    skill_id: 'refund-policy-tt',
    name: 'Total TypeScript Refund Policy',
    description:
      'Total TypeScript offers a 30-day money-back guarantee on all purchases.',
    path: 'skills/total-typescript/refund-policy.md',
    markdown: `# Refund Policy

Total TypeScript offers a **30-day money-back guarantee** on all purchases.

## How to Request a Refund
- Email support@totaltypescript.com
- Include your purchase email
- Refunds processed within 3-5 business days

## Conditions
- No questions asked within 30 days
- Pro-rated refunds may be available for annual subscriptions after 30 days at instructor discretion`,
    indexed_at: '2024-01-15T00:00:00.000Z',
    score: 0.95,
  },
  pricing: {
    skill_id: 'pricing-tt',
    name: 'Total TypeScript Pricing',
    description:
      'Pricing tiers for Total TypeScript: $299 for individual, $999 for teams.',
    path: 'skills/total-typescript/pricing.md',
    markdown: `# Pricing

## Individual License
- **$299** for lifetime access
- Includes all current and future content

## Team License (5+ seats)
- **$999** for teams of 5
- Volume discounts available for larger teams
- Contact sales@totaltypescript.com`,
    indexed_at: '2024-01-15T00:00:00.000Z',
    score: 0.92,
  },
}

describe('full pipeline integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(validateModule, 'getCategoryStats').mockResolvedValue({
      sentUnchangedRate: 0,
      volume: 0,
    })
  })

  describe('skill retrieval and validation', () => {
    it('retrieves skills and validates draft against ground truth', async () => {
      retrieveSkillsMock.mockResolvedValue([MOCK_SKILLS.refundPolicy])

      const result = await validate(
        {
          draft:
            'You can request a refund within 30 days of purchase. Just email us and we will process it within 3-5 business days.',
          context: {
            user: { id: '123', email: 'test@example.com', name: 'Test' },
            purchases: [
              {
                id: 'p1',
                productId: 'tt',
                productName: 'Total TypeScript',
                purchasedAt: '2024-01-10',
                status: 'active',
              },
            ],
            knowledge: [],
            history: [],
            priorMemory: [],
            priorConversations: [],
            gatherErrors: [],
          },
          customerMessage: {
            subject: 'Refund Request',
            body: 'I would like a refund please.',
          },
          originalMessage: 'I would like a refund please.',
        },
        {
          skipMemoryQuery: true,
          skipRelevanceCheck: true,
          appId: 'total-typescript',
          category: 'support_refund',
        }
      )

      // Should pass - draft matches skill content
      expect(result.valid).toBe(true)
      expect(
        result.issues.some((i) => i.type === 'ground_truth_mismatch')
      ).toBe(false)
      expect(retrieveSkillsMock).toHaveBeenCalledWith(
        'I would like a refund please.',
        { topK: 3 }
      )
    })

    it('detects ground truth mismatch with wrong refund period', async () => {
      retrieveSkillsMock.mockResolvedValue([MOCK_SKILLS.refundPolicy])

      const result = await validate(
        {
          draft:
            'We offer a 60-day refund window on all purchases. Contact us anytime.',
          context: {
            user: null,
            purchases: [],
            knowledge: [],
            history: [],
            priorMemory: [],
            priorConversations: [],
            gatherErrors: [],
          },
          customerMessage: {
            subject: 'Refund Policy',
            body: 'What is your refund policy?',
          },
          originalMessage: 'What is your refund policy?',
        },
        {
          skipMemoryQuery: true,
          skipRelevanceCheck: true,
          appId: 'total-typescript',
        }
      )

      // Should fail - draft says 60 days, skill says 30 days
      expect(result.valid).toBe(false)
      expect(
        result.issues.some((i) => i.type === 'ground_truth_mismatch')
      ).toBe(true)
    })

    it('detects fabricated price not in skills', async () => {
      retrieveSkillsMock.mockResolvedValue([MOCK_SKILLS.pricing])

      const result = await validate(
        {
          draft:
            'Total TypeScript is currently $199 for lifetime access. Great value!',
          context: {
            user: null,
            purchases: [],
            knowledge: [],
            history: [],
            priorMemory: [],
            priorConversations: [],
            gatherErrors: [],
          },
          customerMessage: {
            subject: 'Pricing',
            body: 'How much does it cost?',
          },
          originalMessage: 'How much does it cost?',
        },
        {
          skipMemoryQuery: true,
          skipRelevanceCheck: true,
          appId: 'total-typescript',
        }
      )

      // Should fail - $199 not in skill (skill says $299)
      expect(result.valid).toBe(false)
      const fabricationIssue = result.issues.find(
        (i) => i.type === 'fabrication'
      )
      expect(fabricationIssue).toBeDefined()
      expect(fabricationIssue?.message).toContain('$199')
    })
  })

  describe('four-tier routing with all validators', () => {
    it('auto-sends high-confidence response for earned category', async () => {
      retrieveSkillsMock.mockResolvedValue([MOCK_SKILLS.refundPolicy])
      vi.spyOn(validateModule, 'getCategoryStats').mockResolvedValue({
        sentUnchangedRate: 0.99,
        volume: 150,
      })

      const result = await validate(
        {
          draft:
            'Your refund has been initiated. You will see it in 3-5 business days.',
          context: {
            user: { id: '123', email: 'test@example.com', name: 'Test' },
            purchases: [
              {
                id: 'p1',
                productId: 'tt',
                productName: 'Total TypeScript',
                purchasedAt: '2024-01-01',
                status: 'active',
              },
            ],
            knowledge: [],
            history: [],
            priorMemory: [],
            priorConversations: [],
            gatherErrors: [],
          },
          customerMessage: {
            subject: 'Refund',
            body: 'Please process my refund.',
          },
          originalMessage: 'Please process my refund.',
        },
        {
          skipMemoryQuery: true,
          skipRelevanceCheck: true,
          appId: 'total-typescript',
          category: 'support_refund',
        }
      )

      expect(result.action).toBe('auto-send')
    })

    it('escalates team license requests always', async () => {
      retrieveSkillsMock.mockResolvedValue([MOCK_SKILLS.pricing])
      vi.spyOn(validateModule, 'getCategoryStats').mockResolvedValue({
        sentUnchangedRate: 0.99,
        volume: 500,
      })

      const result = await validate(
        {
          draft: 'I can help with your team license inquiry.',
          context: {
            user: { id: '123', email: 'test@example.com', name: 'Test' },
            purchases: [],
            knowledge: [],
            history: [],
            priorMemory: [],
            priorConversations: [],
            gatherErrors: [],
          },
          customerMessage: {
            subject: 'Team License',
            body: 'We need licenses for 20 developers.',
          },
          originalMessage: 'We need licenses for 20 developers.',
        },
        {
          skipMemoryQuery: true,
          skipRelevanceCheck: true,
          appId: 'total-typescript',
          // Use support_team-license which has escalateAlways: true in thresholds
          category: 'support_team-license' as any,
        }
      )

      expect(result.action).toBe('escalate')
    })

    it('needs-review when minor issues exist', async () => {
      retrieveSkillsMock.mockResolvedValue([])
      vi.spyOn(validateModule, 'getCategoryStats').mockResolvedValue({
        sentUnchangedRate: 0.5,
        volume: 50,
      })

      const result = await validate(
        {
          // Response is fine but category hasn't earned auto-send
          draft:
            'Your course access has been restored. You should be able to log in now and continue learning.',
          context: {
            user: { id: '123', email: 'test@example.com', name: 'Test' },
            purchases: [
              {
                id: 'p1',
                productId: 'tt',
                productName: 'Total TypeScript',
                purchasedAt: '2024-01-01',
                status: 'active',
              },
            ],
            knowledge: [],
            history: [],
            priorMemory: [],
            priorConversations: [],
            gatherErrors: [],
          },
          customerMessage: {
            subject: 'Access Issue',
            body: 'Cannot log in.',
          },
          originalMessage: 'Cannot log in.',
        },
        {
          skipMemoryQuery: true,
          skipRelevanceCheck: true,
          appId: 'total-typescript',
          category: 'support_access',
        }
      )

      // No errors, but category hasn't earned auto-send
      expect(result.action).toBe('draft')
    })
  })

  describe('tool failure handling', () => {
    it('escalates when user lookup failed for refund request', async () => {
      retrieveSkillsMock.mockResolvedValue([MOCK_SKILLS.refundPolicy])

      const result = await validate(
        {
          draft: 'Your refund is being processed.',
          context: {
            user: null,
            purchases: [],
            knowledge: [],
            history: [],
            priorMemory: [],
            priorConversations: [],
            gatherErrors: [
              { step: 'user', error: 'Database connection failed' },
            ],
          },
          customerMessage: {
            subject: 'Refund',
            body: 'I want a refund.',
          },
          originalMessage: 'I want a refund.',
        },
        {
          skipMemoryQuery: true,
          skipRelevanceCheck: true,
          appId: 'total-typescript',
          category: 'support_refund',
        }
      )

      expect(result.action).toBe('escalate')
      if (result.action === 'escalate') {
        expect(result.reason).toContain('unable to verify')
      }
    })
  })

  describe('audience awareness integration', () => {
    it('flags inappropriate technical jargon', async () => {
      retrieveSkillsMock.mockResolvedValue([])
      generateObjectMock.mockResolvedValue({
        object: {
          issues: [
            {
              type: 'technical_jargon',
              phrase: 'OAuth2',
              suggestion: 'login system',
            },
          ],
          appropriate: false,
          reasoning: 'Uses technical terms unfamiliar to typical customers',
        },
      })

      const result = await validate(
        {
          draft:
            'Your OAuth2 token has expired. Please re-authenticate using the SAML SSO endpoint.',
          context: {
            user: { id: '123', email: 'test@example.com', name: 'Test' },
            purchases: [],
            knowledge: [],
            history: [],
            priorMemory: [],
            priorConversations: [],
            gatherErrors: [],
          },
          customerMessage: {
            subject: 'Login Issue',
            body: 'Cannot log in.',
          },
          originalMessage: 'Cannot log in.',
        },
        {
          skipMemoryQuery: true,
          skipRelevanceCheck: true,
          checkAudienceAwareness: true,
          appId: 'total-typescript',
          category: 'support_access',
        }
      )

      expect(
        result.issues.some((i) => i.type === 'audience_inappropriate')
      ).toBe(true)
    })
  })
})
