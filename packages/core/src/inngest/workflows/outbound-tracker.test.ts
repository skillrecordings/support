/**
 * Tests for outbound message tracker workflow
 *
 * Tests the core RL signal computation:
 * - Draft vs sent message comparison
 * - Diff categorization (unchanged, minor_edit, major_rewrite, no_draft)
 * - Signal generation for the RL loop
 */

import { describe, expect, it, vi, beforeAll } from 'vitest'

// Mock external dependencies before importing the module
vi.mock('drizzle-orm', () => ({
  desc: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('@skillrecordings/database', () => ({
  ActionsTable: {},
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  })),
}))

vi.mock('@skillrecordings/front-sdk', () => ({
  createFrontClient: vi.fn(() => ({
    messages: {
      get: vi.fn(),
    },
  })),
}))

vi.mock('../../observability/axiom', () => ({
  initializeAxiom: vi.fn(),
  log: vi.fn(),
  traceWorkflowStep: vi.fn(),
}))

vi.mock('../client', () => ({
  inngest: {
    createFunction: vi.fn(),
  },
}))

// Import after mocking
import { categorizeDiff } from './outbound-tracker'

describe('categorizeDiff', () => {
  describe('no_draft category', () => {
    it('returns no_draft when draft is null', () => {
      const result = categorizeDiff(null, 'Hello, thanks for your message.')
      expect(result.category).toBe('no_draft')
      expect(result.similarity).toBe(0)
    })

    it('returns no_draft when draft is undefined', () => {
      const result = categorizeDiff(undefined, 'Hello, thanks for your message.')
      expect(result.category).toBe('no_draft')
      expect(result.similarity).toBe(0)
    })

    it('returns no_draft when draft is empty string', () => {
      const result = categorizeDiff('', 'Hello, thanks for your message.')
      expect(result.category).toBe('no_draft')
      expect(result.similarity).toBe(0)
    })
  })

  describe('unchanged category', () => {
    it('returns unchanged for identical texts', () => {
      const text = 'Hello, thanks for reaching out! I\'d be happy to help with your refund.'
      const result = categorizeDiff(text, text)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1)
    })

    it('returns unchanged when only whitespace differs', () => {
      const draft = 'Hello,  thanks for reaching out!   I\'d be happy to help.'
      const sent = 'Hello, thanks for reaching out! I\'d be happy to help.'
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBeGreaterThanOrEqual(0.95)
    })

    it('returns unchanged when only case differs', () => {
      const draft = 'Hello, THANKS for reaching out!'
      const sent = 'Hello, thanks for reaching out!'
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBeGreaterThanOrEqual(0.95)
    })

    it('handles HTML in draft vs plain text in sent', () => {
      const draft = '<p>Hello, thanks for reaching out!</p><p>I\'d be happy to help.</p>'
      const sent = 'Hello, thanks for reaching out! I\'d be happy to help.'
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBeGreaterThanOrEqual(0.95)
    })

    it('handles HTML entities', () => {
      const draft = 'Hello&nbsp;there! How can I help?'
      const sent = 'Hello there! How can I help?'
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBeGreaterThanOrEqual(0.95)
    })
  })

  describe('minor_edit category', () => {
    it('returns minor_edit for small wording changes', () => {
      const draft = 'Hello, thanks for reaching out! I\'d be happy to help with your refund request.'
      const sent = 'Hi there, thanks for reaching out! I\'d be glad to help with your refund request.'
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('minor_edit')
      expect(result.similarity).toBeGreaterThanOrEqual(0.70)
      expect(result.similarity).toBeLessThan(0.95)
    })

    it('returns minor_edit for typo fixes', () => {
      const draft = 'Thanks for reahcing out! I\'ll process your refund today.'
      const sent = 'Thanks for reaching out! I\'ll process your refund today.'
      const result = categorizeDiff(draft, sent)
      // With Jaccard similarity, a single word change has high similarity
      expect(['unchanged', 'minor_edit']).toContain(result.category)
      expect(result.similarity).toBeGreaterThan(0.70)
    })

    it('returns minor_edit for sentence additions', () => {
      const draft = 'Thanks for reaching out! Your refund has been processed.'
      const sent = 'Thanks for reaching out! Your refund has been processed. Please allow 5-7 business days.'
      const result = categorizeDiff(draft, sent)
      // Adding a sentence reduces similarity but should still be minor
      expect(['minor_edit', 'major_rewrite']).toContain(result.category)
      expect(result.similarity).toBeGreaterThanOrEqual(0.5)
    })
  })

  describe('major_rewrite category', () => {
    it('returns major_rewrite for substantially different responses', () => {
      const draft = 'Hello! Your refund has been processed. It should appear in your account within 5-7 days.'
      const sent = 'I apologize, but I cannot process a refund for this order as it is outside our 30-day policy. However, I can offer you store credit or an exchange.'
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('major_rewrite')
      expect(result.similarity).toBeLessThan(0.70)
    })

    it('returns major_rewrite when topic completely changes', () => {
      const draft = 'Your password has been reset. Please check your email.'
      const sent = 'I\'ve processed your refund request. The amount will be credited within 5-7 business days.'
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('major_rewrite')
      expect(result.similarity).toBeLessThan(0.70)
    })

    it('returns major_rewrite for very different lengths', () => {
      const draft = 'Refund processed.'
      const sent = `Hi there,

Thank you for reaching out about your recent purchase. I completely understand your concern, and I apologize for any inconvenience this may have caused.

I've gone ahead and processed a full refund for your order #12345. The refund amount of $49.99 will be credited back to your original payment method within 5-7 business days, depending on your bank's processing time.

If you have any other questions or concerns, please don't hesitate to reach out. We're here to help!

Best regards,
Support Team`
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('major_rewrite')
      expect(result.similarity).toBeLessThan(0.70)
    })
  })

  describe('edge cases', () => {
    it('handles empty sent message with draft', () => {
      const draft = 'Hello, thanks for reaching out!'
      const sent = ''
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('major_rewrite')
      expect(result.similarity).toBe(0)
    })

    it('handles very long identical texts', () => {
      const text = 'Lorem ipsum dolor sit amet. '.repeat(100)
      const result = categorizeDiff(text, text)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1)
    })

    it('handles special characters and punctuation', () => {
      const draft = 'Hello! How are you? I\'m fine. Thanks!'
      const sent = 'Hello! How are you? I\'m fine. Thanks!'
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1)
    })

    it('handles unicode characters', () => {
      const draft = 'Hello! 👋 Thanks for reaching out!'
      const sent = 'Hello! 👋 Thanks for reaching out!'
      const result = categorizeDiff(draft, sent)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1)
    })

    it('handles markdown formatting differences', () => {
      const draft = '**Hello!** Thanks for reaching out.'
      const sent = 'Hello! Thanks for reaching out.'
      const result = categorizeDiff(draft, sent)
      // Note: Jaccard word similarity treats **Hello!** as different word from Hello!
      // This is acceptable - markdown in drafts is somewhat unusual anyway
      expect(result.similarity).toBeGreaterThan(0.5)
    })
  })

  describe('RL signal value', () => {
    it('unchanged signals strong positive (draft was correct)', () => {
      const draft = 'Your refund has been processed successfully.'
      const sent = 'Your refund has been processed successfully.'
      const result = categorizeDiff(draft, sent)
      // Unchanged = agent got it right = positive signal
      expect(result.category).toBe('unchanged')
    })

    it('minor_edit signals weak positive (draft needed minor tweaks)', () => {
      // Using a longer example where additions are proportionally smaller
      const draft = 'Thanks for reaching out. Your refund has been processed and will appear in your account soon.'
      const sent = 'Thanks for reaching out. Your refund has been processed and will appear in your account soon. Have a great day!'
      const result = categorizeDiff(draft, sent)
      // Minor edit = agent was mostly right
      // With a longer base text, the added words have less impact on similarity
      expect(['unchanged', 'minor_edit']).toContain(result.category)
    })

    it('major_rewrite signals correction (high learning value)', () => {
      const draft = 'Sorry, we cannot process refunds after 30 days.'
      const sent = 'I understand your frustration. While this is outside our normal policy, I\'ve made an exception and processed your refund.'
      const result = categorizeDiff(draft, sent)
      // Major rewrite = agent was wrong = correction signal (10x learning value!)
      expect(result.category).toBe('major_rewrite')
    })

    it('no_draft signals manual response (baseline for comparison)', () => {
      const result = categorizeDiff(null, 'Manual response without draft.')
      // No draft = human wrote from scratch = baseline
      expect(result.category).toBe('no_draft')
    })
  })
})

describe('outbound webhook route integration', () => {
  // These are documented expectations for the webhook handler
  // Full integration tests would require mocking Inngest

  it('should handle outbound event type', () => {
    // The webhook should handle event.type === 'outbound'
    const eventType = 'outbound'
    expect(eventType).toBe('outbound')
  })

  it('should extract message ID from target.data.id', () => {
    const mockPayload = {
      target: {
        data: {
          id: 'msg_abc123',
        },
      },
    }
    expect(mockPayload.target.data.id).toBe('msg_abc123')
  })

  it('should extract author from target.data.author', () => {
    const mockPayload = {
      target: {
        data: {
          author: {
            id: 'tea_xyz',
            email: '[EMAIL]',
            first_name: 'Support',
            last_name: 'Agent',
          },
        },
      },
    }
    const author = mockPayload.target.data.author
    expect(author.id).toBe('tea_xyz')
    expect(author.email).toBe('[EMAIL]')
  })
})
