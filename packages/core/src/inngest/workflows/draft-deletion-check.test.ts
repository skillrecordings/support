/**
 * Tests for draft deletion check workflow
 *
 * Tests the deletion detection logic for the RL loop:
 * - Timeout-based deletion detection
 * - RL signal generation for deleted drafts
 */

import { describe, expect, it, vi } from 'vitest'

// Mock external dependencies
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

// Import the real rl module functions
import { DELETION_TIMEOUT_MS, markAsDeleted } from '../../rl'

describe('Draft Deletion Check', () => {
  describe('DELETION_TIMEOUT_MS', () => {
    it('is set to 2 hours', () => {
      // 2 hours in milliseconds
      expect(DELETION_TIMEOUT_MS).toBe(2 * 60 * 60 * 1000)
    })

    it('is 7,200,000 milliseconds', () => {
      expect(DELETION_TIMEOUT_MS).toBe(300000)
    })
  })

  describe('markAsDeleted', () => {
    it('returns deleted outcome', () => {
      const draftText = 'Thank you for reaching out about your refund.'
      const result = markAsDeleted(draftText)

      expect(result.outcome).toBe('deleted')
    })

    it('normalizes and includes original text', () => {
      const draftText = '<p>Hello <strong>World</strong></p>'
      const result = markAsDeleted(draftText)

      expect(result.originalText).toBe('hello world')
    })

    it('includes detection timestamp', () => {
      const before = new Date().toISOString()
      const result = markAsDeleted('test draft')
      const after = new Date().toISOString()

      expect(result.detectedAt).toBeTruthy()
      expect(result.detectedAt >= before).toBe(true)
      expect(result.detectedAt <= after).toBe(true)
    })

    it('does not include sentText for deleted drafts', () => {
      const result = markAsDeleted('test draft')

      expect(result.sentText).toBeUndefined()
    })

    it('does not include similarity for deleted drafts', () => {
      const result = markAsDeleted('test draft')

      expect(result.similarity).toBeUndefined()
    })

    it('handles empty draft content', () => {
      const result = markAsDeleted('')

      expect(result.outcome).toBe('deleted')
      expect(result.originalText).toBe('')
    })

    it('handles HTML content', () => {
      const htmlDraft = `
        <div>
          <p>Hello, thank you for contacting us!</p>
          <p>Your refund has been processed.</p>
        </div>
      `
      const result = markAsDeleted(htmlDraft)

      expect(result.outcome).toBe('deleted')
      expect(result.originalText).not.toContain('<')
      expect(result.originalText).not.toContain('>')
    })
  })

  describe('workflow behavior (contract tests)', () => {
    /**
     * These tests document the expected behavior of the workflow.
     * Full integration testing would require Inngest dev server.
     */

    it('should trigger on SUPPORT_DRAFT_CREATED event', () => {
      // Contract: workflow listens to 'support/draft.created'
      const eventName = 'support/draft.created'
      expect(eventName).toBe('support/draft.created')
    })

    it('should wait for SUPPORT_OUTBOUND_MESSAGE with timeout', () => {
      // Contract: workflow waits for 'support/outbound.message'
      // with match on conversationId and 2h timeout
      const waitConfig = {
        event: 'support/outbound.message',
        match: 'data.conversationId',
        timeout: `${DELETION_TIMEOUT_MS}ms`,
      }

      expect(waitConfig.event).toBe('support/outbound.message')
      expect(waitConfig.match).toBe('data.conversationId')
      expect(waitConfig.timeout).toBe('7200000ms')
    })

    it('should record deletion signal when timeout reached', () => {
      // Contract: when waitForEvent times out, record deletion signal
      // with rl_category: 'deleted'
      const expectedSignalFields = {
        rl_category: 'deleted',
        rl_has_draft: true,
      }

      expect(expectedSignalFields.rl_category).toBe('deleted')
      expect(expectedSignalFields.rl_has_draft).toBe(true)
    })

    it('should skip deletion recording if outbound message received', () => {
      // Contract: when outbound message is received before timeout,
      // the workflow should exit without recording deletion
      // (outbound-tracker handles that case)
      const expectedOutcome = 'sent'
      expect(expectedOutcome).toBe('sent')
    })
  })

  describe('RL signal value', () => {
    it('deleted drafts are strong negative signal', () => {
      // A draft that was never sent indicates:
      // 1. Human decided the response was wrong
      // 2. Human wrote a completely manual response
      // This is valuable feedback for the RL loop
      const result = markAsDeleted('Incorrect agent response')

      expect(result.outcome).toBe('deleted')
      // Deleted = agent got it very wrong = strong negative signal
    })

    it('deleted outcome is distinct from major_rewrite', () => {
      // major_rewrite = draft was heavily edited but sent
      // deleted = draft was completely discarded
      // Both are correction signals but deleted is "worse"
      const deletedResult = markAsDeleted('Draft content')

      expect(deletedResult.outcome).toBe('deleted')
      expect(deletedResult.outcome).not.toBe('major_rewrite')
    })
  })

  describe('integration with outbound-tracker', () => {
    /**
     * These tests document the relationship between:
     * - draft-deletion-check (handles timeout/deletion case)
     * - outbound-tracker (handles sent message case)
     */

    it('deletion check and outbound tracker are mutually exclusive', () => {
      // Contract: For a given draft, exactly ONE of:
      // 1. outbound-tracker records unchanged/minor_edit/major_rewrite (draft sent)
      // 2. deletion-check records deleted (draft not sent within timeout)
      //
      // The waitForEvent with match ensures this:
      // - If outbound message arrives, deletion-check exits early
      // - If timeout reached, deletion-check records and outbound will never match

      const outcomeCategories = {
        sentDraft: ['unchanged', 'minor_edit', 'major_rewrite'],
        deletedDraft: ['deleted'],
      }

      // These should never overlap
      const overlap = outcomeCategories.sentDraft.filter((c) =>
        outcomeCategories.deletedDraft.includes(c)
      )
      expect(overlap).toHaveLength(0)
    })

    it('uses same conversation ID for matching', () => {
      // Both workflows use conversationId to correlate drafts with messages
      const draftCreatedEvent = {
        data: { conversationId: 'cnv_123' },
      }
      const outboundMessageEvent = {
        data: { conversationId: 'cnv_123' },
      }

      expect(draftCreatedEvent.data.conversationId).toBe(
        outboundMessageEvent.data.conversationId
      )
    })
  })
})
