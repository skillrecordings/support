/**
 * Draft step unit tests
 *
 * Tests the draft step independently with mocked context.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftInput, MessageCategory } from '../types'
import { draft, getPromptForCategory, setPromptForCategory } from './draft'
import type { DraftOptions } from './draft'

// Mock the AI SDK
vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'Mocked response from the AI model.',
  }),
}))

describe('draft step', () => {
  const mockContext = {
    user: { id: 'user-1', email: '[EMAIL]', name: 'Test User' },
    purchases: [
      {
        id: 'purchase-1',
        productId: 'prod-1',
        productName: 'Total TypeScript',
        purchasedAt: '2024-01-01',
        status: 'active' as const,
      },
    ],
    knowledge: [],
    history: [],
    priorMemory: [],
    gatherErrors: [],
  }

  const mockClassification = {
    category: 'support_access' as MessageCategory,
    confidence: 0.9,
    signals: {
      hasEmailInBody: true,
      hasPurchaseDate: false,
      hasErrorMessage: false,
      isReply: false,
      mentionsInstructor: false,
      hasAngrySentiment: false,
      isAutomated: false,
      isVendorOutreach: false,
      hasLegalThreat: false,
      hasOutsidePolicyTimeframe: false,
      isPersonalToInstructor: false,
    },
    reasoning: 'Access issue detected',
  }

  const mockMessage = {
    subject: 'Cannot access my course',
    body: 'I purchased Total TypeScript but cannot log in. My email is [EMAIL].',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('draft()', () => {
    it('should return a draft response with required fields', async () => {
      const input: DraftInput = {
        message: mockMessage,
        classification: mockClassification,
        context: mockContext,
      }

      const result = await draft(input)

      expect(result).toHaveProperty('draft')
      expect(result).toHaveProperty('toolsUsed')
      expect(result).toHaveProperty('durationMs')
      expect(typeof result.draft).toBe('string')
      expect(Array.isArray(result.toolsUsed)).toBe(true)
      expect(typeof result.durationMs).toBe('number')
    })

    it('should call generateText with correct parameters', async () => {
      const { generateText } = await import('ai')

      const input: DraftInput = {
        message: mockMessage,
        classification: mockClassification,
        context: mockContext,
      }

      await draft(input)

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'anthropic/claude-haiku-4-5',
          system: expect.stringContaining('support agent'),
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('Customer Message'),
            }),
          ]),
        })
      )
    })

    it('should use custom model when provided', async () => {
      const { generateText } = await import('ai')

      const input: DraftInput = {
        message: mockMessage,
        classification: mockClassification,
        context: mockContext,
      }

      await draft(input, { model: 'anthropic/claude-sonnet-4-5' })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'anthropic/claude-sonnet-4-5',
        })
      )
    })

    it('should use prompt override when provided', async () => {
      const { generateText } = await import('ai')

      const customPrompt = 'You are a custom support agent.'
      const input: DraftInput = {
        message: mockMessage,
        classification: mockClassification,
        context: mockContext,
      }

      await draft(input, { promptOverride: customPrompt })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: customPrompt,
        })
      )
    })

    it('should include context in the user message', async () => {
      const { generateText } = await import('ai')

      const input: DraftInput = {
        message: mockMessage,
        classification: mockClassification,
        context: mockContext,
      }

      await draft(input)

      // Check that generateText was called with user message containing context
      const call = (generateText as any).mock.calls[0][0]
      expect(call.messages[0].content).toContain('[EMAIL]')
      expect(call.messages[0].content).toContain('Total TypeScript')
    })

    it('should track duration', async () => {
      const input: DraftInput = {
        message: mockMessage,
        classification: mockClassification,
        context: mockContext,
      }

      const result = await draft(input)

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getPromptForCategory()', () => {
    it('should return category-specific prompt for support_access', () => {
      const prompt = getPromptForCategory('support_access')
      expect(prompt).toContain('Access Issues')
      expect(prompt).toContain('magic link')
    })

    it('should return category-specific prompt for support_refund', () => {
      const prompt = getPromptForCategory('support_refund')
      expect(prompt).toContain('Refund Requests')
      expect(prompt).toContain('30 days')
    })

    it('should return category-specific prompt for support_billing', () => {
      const prompt = getPromptForCategory('support_billing')
      expect(prompt).toContain('Billing/Invoice')
      expect(prompt).toContain('invoices page')
    })

    it('should return base prompt for uncategorized messages', () => {
      const prompt = getPromptForCategory('unknown')
      expect(prompt).toContain('support agent')
      expect(prompt).not.toContain('Access Issues')
    })
  })

  describe('setPromptForCategory()', () => {
    it('should allow setting custom category prompts', () => {
      const originalPrompt = getPromptForCategory('fan_mail')
      const customPrompt = 'Custom prompt for testing'

      setPromptForCategory('fan_mail', customPrompt)

      const retrieved = getPromptForCategory('fan_mail')
      expect(retrieved).toBe(customPrompt)

      // Restore original (fan_mail doesn't have a default, so it goes to base)
      setPromptForCategory('fan_mail', originalPrompt)
    })
  })

  describe('category prompt usage', () => {
    it.each([
      ['support_access', 'Access Issues'],
      ['support_refund', 'Refund Requests'],
      ['support_transfer', 'Transfer Requests'],
      ['support_billing', 'Billing/Invoice'],
      ['support_technical', 'Technical Questions'],
    ])(
      'should use %s prompt for category',
      async (category, expectedContent) => {
        const { generateText } = await import('ai')

        const input: DraftInput = {
          message: mockMessage,
          classification: {
            ...mockClassification,
            category: category as MessageCategory,
          },
          context: mockContext,
        }

        await draft(input)

        const call = (generateText as any).mock.calls[0][0]
        expect(call.system).toContain(expectedContent)
      }
    )
  })
})
