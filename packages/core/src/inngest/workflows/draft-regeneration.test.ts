import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// Mock only the logging/observability
vi.mock('../../observability/axiom', () => ({
  initializeAxiom: vi.fn(),
  log: vi.fn(),
  traceWorkflowStep: vi.fn(),
}))

import {
  type RegenerateDraftDeps,
  type RegenerateDraftInput,
  regenerateDraftWithFeedback,
} from './draft-response'

describe('regenerateDraftWithFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FRONT_API_KEY = 'test-api-key'
  })

  afterEach(() => {
    delete process.env.FRONT_API_KEY
  })

  // Helper to create mock dependencies
  const createMockDeps = (
    overrides: Partial<{
      generateTextResult: string
      frontDrafts: Array<{ id: string }>
      channelId: string
      inboxId: string
      newDraftId: string
    }> = {}
  ) => {
    const {
      generateTextResult = 'New draft content',
      frontDrafts = [],
      channelId = 'cha_456',
      inboxId = 'inb_123',
      newDraftId = 'dft_new123',
    } = overrides

    const mockDrafts = {
      list: vi.fn().mockResolvedValue({ _results: frontDrafts }),
      delete: vi.fn().mockResolvedValue(undefined),
      createReply: vi.fn().mockResolvedValue({ id: newDraftId }),
    }

    const mockConversations = {
      addComment: vi.fn().mockResolvedValue(undefined),
    }

    const mockRaw = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ _results: [{ id: inboxId }] })
        .mockResolvedValueOnce({ _results: [{ id: channelId }] }),
    }

    const mockGenerateText = vi.fn().mockResolvedValue({
      text: generateTextResult,
    })

    const mockCreateFrontClient = vi.fn(() => ({
      drafts: mockDrafts,
      conversations: mockConversations,
      raw: mockRaw,
    }))

    return {
      generateText: mockGenerateText,
      createFrontClient:
        mockCreateFrontClient as unknown as RegenerateDraftDeps['createFrontClient'],
      markdownToHtml: vi.fn((text: string) => `<p>${text}</p>`),
      // Expose internal mocks for assertions
      _mocks: {
        drafts: mockDrafts,
        conversations: mockConversations,
        raw: mockRaw,
        generateText: mockGenerateText,
        createFrontClient: mockCreateFrontClient,
      },
    }
  }

  const baseInput: RegenerateDraftInput = {
    currentDraft:
      'Hello there! Thanks for reaching out. I would be happy to help you with your refund request. Let me know if you have any other questions!',
    feedback: 'make it shorter and more direct',
    context: {
      subject: 'Refund request',
      body: "I'd like a refund for my purchase please.",
      customerEmail: '[EMAIL]',
    },
    conversationId: 'cnv_test123',
    appId: 'total-typescript',
  }

  describe('LLM draft generation', () => {
    it('should generate a new draft with feedback incorporated', async () => {
      const mockDeps = createMockDeps({
        generateTextResult:
          "Got it - I'll process your refund now. You should see it within 5-7 business days.",
      })

      const result = await regenerateDraftWithFeedback(baseInput, {
        skipFrontUpdate: true,
        deps: mockDeps,
      })

      expect(mockDeps._mocks.generateText).toHaveBeenCalledTimes(1)
      expect(result.newDraft).toBe(
        "Got it - I'll process your refund now. You should see it within 5-7 business days."
      )
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should include current draft and feedback in the prompt', async () => {
      const mockDeps = createMockDeps()

      await regenerateDraftWithFeedback(baseInput, {
        skipFrontUpdate: true,
        deps: mockDeps,
      })

      const call = mockDeps._mocks.generateText.mock.calls[0]!
      expect(call).toBeDefined()
      const systemPrompt = call[0].system as string

      // Should include the current draft
      expect(systemPrompt).toContain(baseInput.currentDraft)
      // Should include the feedback
      expect(systemPrompt).toContain(baseInput.feedback)
      // Should include style guidelines
      expect(systemPrompt).toContain('direct')
      expect(systemPrompt).toContain('concise')
    })

    it('should include customer context in the user message', async () => {
      const mockDeps = createMockDeps()

      await regenerateDraftWithFeedback(baseInput, {
        skipFrontUpdate: true,
        deps: mockDeps,
      })

      const call = mockDeps._mocks.generateText.mock.calls[0]!
      expect(call).toBeDefined()
      const userMessage = call[0].messages[0].content as string

      // Should include customer's original message
      expect(userMessage).toContain(baseInput.context.subject)
      expect(userMessage).toContain(baseInput.context.body)
    })

    it('should use configurable model', async () => {
      const mockDeps = createMockDeps()

      await regenerateDraftWithFeedback(baseInput, {
        model: 'anthropic/claude-sonnet-4',
        skipFrontUpdate: true,
        deps: mockDeps,
      })

      const call = mockDeps._mocks.generateText.mock.calls[0]!
      expect(call[0].model).toBe('anthropic/claude-sonnet-4')
    })
  })

  describe('Front integration', () => {
    it('should update draft in Front when not skipped', async () => {
      const mockDeps = createMockDeps({
        frontDrafts: [{ id: 'dft_old1' }, { id: 'dft_old2' }],
        newDraftId: 'dft_new123',
      })

      const result = await regenerateDraftWithFeedback(baseInput, {
        frontApiToken: 'test-token',
        deps: mockDeps,
      })

      // Should delete existing drafts
      expect(mockDeps._mocks.drafts.delete).toHaveBeenCalledWith('dft_old1')
      expect(mockDeps._mocks.drafts.delete).toHaveBeenCalledWith('dft_old2')

      // Should create new draft
      expect(mockDeps._mocks.drafts.createReply).toHaveBeenCalledWith(
        'cnv_test123',
        expect.objectContaining({
          body: expect.stringContaining('New draft content'),
          channel_id: 'cha_456',
          mode: 'shared',
        })
      )

      // Should add confirmation comment
      expect(mockDeps._mocks.conversations.addComment).toHaveBeenCalledWith(
        'cnv_test123',
        expect.stringContaining('Draft regenerated with feedback')
      )

      expect(result.frontUpdated).toBe(true)
      expect(result.draftId).toBe('dft_new123')
      expect(result.commentAdded).toBe(true)
    })

    it('should skip Front update when skipFrontUpdate is true', async () => {
      const mockDeps = createMockDeps()

      const result = await regenerateDraftWithFeedback(baseInput, {
        skipFrontUpdate: true,
        deps: mockDeps,
      })

      expect(mockDeps._mocks.createFrontClient).not.toHaveBeenCalled()
      expect(result.frontUpdated).toBe(false)
      expect(result.draftId).toBeUndefined()
      expect(result.commentAdded).toBe(false)
    })

    it('should use provided channelId if available', async () => {
      const mockDeps = createMockDeps({ frontDrafts: [] })

      await regenerateDraftWithFeedback(
        { ...baseInput, channelId: 'cha_provided' },
        { frontApiToken: 'test-token', deps: mockDeps }
      )

      // Should NOT call raw.get to look up channel
      expect(mockDeps._mocks.raw.get).not.toHaveBeenCalled()

      // Should use provided channel ID
      expect(mockDeps._mocks.drafts.createReply).toHaveBeenCalledWith(
        'cnv_test123',
        expect.objectContaining({
          channel_id: 'cha_provided',
        })
      )
    })
  })

  describe('context preservation', () => {
    it('should include gathered context when available', async () => {
      const mockDeps = createMockDeps()

      const inputWithGatherOutput: RegenerateDraftInput = {
        ...baseInput,
        context: {
          ...baseInput.context,
          gatherOutput: {
            user: { id: 'usr_123', email: '[EMAIL]' },
            purchases: [
              {
                id: 'pur_1',
                productId: 'prod_1',
                productName: 'Total TypeScript',
                purchasedAt: '2024-01-01',
                status: 'active',
              },
            ],
            knowledge: [],
            history: [
              { direction: 'in', body: 'First message', timestamp: 1000 },
              { direction: 'out', body: 'Our response', timestamp: 2000 },
            ],
            priorMemory: [],
            priorConversations: [],
            gatherErrors: [],
          },
        },
      }

      await regenerateDraftWithFeedback(inputWithGatherOutput, {
        skipFrontUpdate: true,
        deps: mockDeps,
      })

      const call = mockDeps._mocks.generateText.mock.calls[0]!
      const userMessage = call[0].messages[0].content as string

      // Should include customer email
      expect(userMessage).toContain('[EMAIL]')
      // Should include purchase info
      expect(userMessage).toContain('Total TypeScript')
      // Should include history
      expect(userMessage).toContain('First message')
    })
  })

  describe('feedback handling', () => {
    it('should handle "change X to Y" style feedback', async () => {
      const mockDeps = createMockDeps({
        generateTextResult: 'Hello! Processing your refund now.',
      })

      const input: RegenerateDraftInput = {
        ...baseInput,
        feedback: 'change "Thanks for reaching out" to "Hello"',
      }

      await regenerateDraftWithFeedback(input, {
        skipFrontUpdate: true,
        deps: mockDeps,
      })

      const call = mockDeps._mocks.generateText.mock.calls[0]!
      const systemPrompt = call[0].system as string

      // Feedback should be in the prompt
      expect(systemPrompt).toContain(
        'change "Thanks for reaching out" to "Hello"'
      )
    })

    it('should handle style adjustment feedback', async () => {
      const mockDeps = createMockDeps({
        generateTextResult: 'Shorter response.',
      })

      const input: RegenerateDraftInput = {
        ...baseInput,
        feedback: 'make it more friendly and add an apology',
      }

      await regenerateDraftWithFeedback(input, {
        skipFrontUpdate: true,
        deps: mockDeps,
      })

      const call = mockDeps._mocks.generateText.mock.calls[0]!
      const systemPrompt = call[0].system as string

      expect(systemPrompt).toContain('make it more friendly and add an apology')
    })

    it('should truncate long feedback in confirmation comment', async () => {
      const mockDeps = createMockDeps({ frontDrafts: [] })

      const longFeedback = 'a'.repeat(200) // 200 character feedback

      await regenerateDraftWithFeedback(
        { ...baseInput, feedback: longFeedback },
        { frontApiToken: 'test-token', deps: mockDeps }
      )

      // Confirmation comment should truncate the feedback
      const commentCall =
        mockDeps._mocks.conversations.addComment.mock.calls[0]!
      expect(commentCall[1]).toContain('...')
      expect(commentCall[1].length).toBeLessThan(200)
    })
  })

  describe('error handling', () => {
    it('should handle Front API errors gracefully', async () => {
      const mockDeps = createMockDeps()
      // Override to throw an error
      mockDeps._mocks.drafts.list.mockRejectedValue(
        new Error('Front API error')
      )

      const result = await regenerateDraftWithFeedback(baseInput, {
        frontApiToken: 'test-token',
        deps: mockDeps,
      })

      // Should still return the new draft
      expect(result.newDraft).toBe('New draft content')
      // Front update should fail gracefully
      expect(result.frontUpdated).toBe(false)
    })

    it('should handle missing FRONT_API_KEY', async () => {
      delete process.env.FRONT_API_KEY

      const mockDeps = createMockDeps()

      const result = await regenerateDraftWithFeedback(baseInput, {
        deps: mockDeps,
      })

      // Should generate draft but skip Front update
      expect(result.newDraft).toBe('New draft content')
      expect(result.frontUpdated).toBe(false)
      expect(mockDeps._mocks.createFrontClient).not.toHaveBeenCalled()
    })
  })
})
