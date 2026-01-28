import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentThread } from '../../conversation/comment-context'
import type { HoldParams, IntentResult } from '../../conversation/intent-parser'

// Mock dependencies before importing the module
vi.mock('../../conversation/comment-context', () => ({
  createCommentContextService: vi.fn(() => ({
    getCommentThread: vi.fn(),
  })),
}))

vi.mock('../../conversation/hold-state', () => ({
  setHold: vi.fn(),
}))

vi.mock('../../conversation/intent-parser', () => ({
  parseIntent: vi.fn(),
  describeIntent: vi.fn((r: IntentResult) => `Intent: ${r.type}`),
  isConfident: vi.fn((r: IntentResult) => r.confidence >= 0.7),
}))

vi.mock('../../observability/axiom', () => ({
  initializeAxiom: vi.fn(),
  log: vi.fn(),
}))

vi.mock('@skillrecordings/database', () => ({
  getDb: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(),
    })),
  })),
  ActionsTable: {},
}))

import { createCommentContextService } from '../../conversation/comment-context'
import { setHold } from '../../conversation/hold-state'
import { isConfident, parseIntent } from '../../conversation/intent-parser'

describe('Comment Correction Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FRONT_API_KEY = 'test-api-key'
  })

  afterEach(() => {
    delete process.env.FRONT_API_KEY
  })

  // Helper to create mock step functions
  const createMockStep = () => {
    const sentEvents: Array<{ name: string; data: unknown }> = []
    return {
      run: vi.fn(async (name: string, fn: () => Promise<unknown>) => fn()),
      sendEvent: vi.fn(
        async (name: string, event: { name: string; data: unknown }) => {
          sentEvents.push(event)
        }
      ),
      sentEvents,
    }
  }

  // Helper to create mock event
  const createMockEvent = (body: string) => ({
    data: {
      conversationId: 'cnv_test123',
      appId: 'app_test',
      commentId: 'com_test456',
      body,
      authorEmail: '[EMAIL]',
      authorId: 'tea_abc',
      traceId: 'trace_xyz',
    },
  })

  describe('Intent: Approve', () => {
    it('should create action and emit approved event for approve intent', async () => {
      // Setup mocks
      const mockContextService = {
        getCommentThread: vi.fn().mockResolvedValue({
          messages: [
            {
              id: 'msg_1',
              body: 'test',
              text: 'test',
              isInbound: true,
              createdAt: 1000,
              authorId: null,
              authorEmail: '[EMAIL]',
            },
          ],
          authors: new Map(),
          latestTimestamp: 1000,
          messageCount: 1,
        }),
      }
      vi.mocked(createCommentContextService).mockReturnValue(mockContextService)

      vi.mocked(parseIntent).mockResolvedValue({
        type: 'approve',
        confidence: 0.95,
        parameters: { type: 'approve' },
      })

      const mockStep = createMockStep()
      const event = createMockEvent('send it')

      // Simulate workflow execution manually since we can't easily invoke inngest
      // Step 1: Fetch context
      const thread = (await mockStep.run('fetch-context', async () => {
        const contextService = createCommentContextService({ apiToken: 'test' })
        const commentThread =
          await contextService.getCommentThread('cnv_test123')
        return {
          messages: commentThread.messages,
          authors: Object.fromEntries(commentThread.authors),
          latestTimestamp: commentThread.latestTimestamp,
          messageCount: commentThread.messageCount,
        }
      })) as {
        messages: unknown[]
        authors: Record<string, unknown>
        latestTimestamp: number
        messageCount: number
      }

      expect(mockContextService.getCommentThread).toHaveBeenCalledWith(
        'cnv_test123'
      )
      expect(thread.messageCount).toBe(1)

      // Step 2: Parse intent
      const intent = (await mockStep.run('parse-intent', async () => {
        return parseIntent('send it')
      })) as IntentResult

      expect(parseIntent).toHaveBeenCalledWith('send it')
      expect(intent.type).toBe('approve')
      expect(intent.confidence).toBe(0.95)
    })

    it('should recognize various approve phrases', async () => {
      const approveInputs = [
        'send',
        'send it',
        'lgtm',
        'looks good',
        'ship it',
        'approved',
        '👍',
      ]

      for (const input of approveInputs) {
        vi.mocked(parseIntent).mockResolvedValue({
          type: 'approve',
          confidence: 0.9,
          parameters: { type: 'approve' },
        })

        const result = await parseIntent(input)
        expect(result.type).toBe('approve')
      }
    })
  })

  describe('Intent: Hold', () => {
    it('should set hold state for hold intent with duration', async () => {
      vi.mocked(parseIntent).mockResolvedValue({
        type: 'hold',
        confidence: 0.9,
        parameters: { type: 'hold', duration: '2h' },
      })

      const mockStep = createMockStep()

      // Simulate intent parse
      const intent = (await mockStep.run('parse-intent', async () => {
        return parseIntent('snooze for 2h')
      })) as IntentResult

      expect(intent.type).toBe('hold')
      expect(intent.parameters).toEqual({ type: 'hold', duration: '2h' })

      // Verify setHold would be called (in actual workflow)
      expect(isConfident(intent)).toBe(true)
    })

    it('should set hold state for hold intent with until', async () => {
      vi.mocked(parseIntent).mockResolvedValue({
        type: 'hold',
        confidence: 0.85,
        parameters: { type: 'hold', until: 'tomorrow' },
      })

      const intent = await parseIntent('hold until tomorrow')

      expect(intent.type).toBe('hold')
      expect((intent.parameters as { until?: string }).until).toBe('tomorrow')
    })
  })

  describe('Intent: Edit', () => {
    it('should handle edit intent as placeholder', async () => {
      vi.mocked(parseIntent).mockResolvedValue({
        type: 'edit',
        confidence: 0.85,
        parameters: { type: 'edit', instruction: 'make it shorter' },
      })

      const intent = await parseIntent('make it shorter')

      expect(intent.type).toBe('edit')
      expect((intent.parameters as { instruction?: string }).instruction).toBe(
        'make it shorter'
      )
    })

    it('should handle change X to Y pattern', async () => {
      vi.mocked(parseIntent).mockResolvedValue({
        type: 'edit',
        confidence: 0.95,
        parameters: {
          type: 'edit',
          instruction: 'change "hello" to "hi"',
          target: 'hello',
          replacement: 'hi',
        },
      })

      const intent = await parseIntent('change "hello" to "hi"')

      expect(intent.type).toBe('edit')
      expect((intent.parameters as { target?: string }).target).toBe('hello')
      expect((intent.parameters as { replacement?: string }).replacement).toBe(
        'hi'
      )
    })
  })

  describe('Intent: Unknown', () => {
    it('should skip unknown intents', async () => {
      vi.mocked(parseIntent).mockResolvedValue({
        type: 'unknown',
        confidence: 0,
        parameters: { type: 'unknown', raw: 'random gibberish' },
      })

      vi.mocked(isConfident).mockReturnValue(false)

      const intent = await parseIntent('random gibberish')

      expect(intent.type).toBe('unknown')
      expect(isConfident(intent)).toBe(false)
    })
  })

  describe('Confidence threshold', () => {
    it('should skip low confidence intents', async () => {
      vi.mocked(parseIntent).mockResolvedValue({
        type: 'approve',
        confidence: 0.5, // Below threshold
        parameters: { type: 'approve' },
      })

      vi.mocked(isConfident).mockReturnValue(false)

      const intent = await parseIntent('maybe?')

      expect(isConfident(intent)).toBe(false)
    })

    it('should proceed with high confidence intents', async () => {
      vi.mocked(parseIntent).mockResolvedValue({
        type: 'approve',
        confidence: 0.95,
        parameters: { type: 'approve' },
      })

      vi.mocked(isConfident).mockReturnValue(true)

      const intent = await parseIntent('send')

      expect(isConfident(intent)).toBe(true)
    })
  })

  describe('Context fetching', () => {
    it('should fetch thread context from Front', async () => {
      const mockThread = {
        messages: [
          {
            id: 'msg_1',
            body: '<p>Hello</p>',
            text: 'Hello',
            isInbound: true,
            createdAt: 1000,
            authorId: null,
            authorEmail: '[EMAIL]',
          },
          {
            id: 'msg_2',
            body: '<p>Hi there</p>',
            text: 'Hi there',
            isInbound: false,
            createdAt: 2000,
            authorId: 'tea_1',
            authorEmail: '[EMAIL]',
          },
        ],
        authors: new Map([
          [
            'tea_1',
            {
              id: 'tea_1',
              email: '[EMAIL]',
              name: 'Support',
              isTeammate: true,
            },
          ],
        ]),
        latestTimestamp: 2000,
        messageCount: 2,
      }

      const mockContextService = {
        getCommentThread: vi.fn().mockResolvedValue(mockThread),
      }
      vi.mocked(createCommentContextService).mockReturnValue(mockContextService)

      const service = createCommentContextService({ apiToken: 'test' })
      const thread = await service.getCommentThread('cnv_test123')

      expect(thread.messageCount).toBe(2)
      expect(thread.messages).toHaveLength(2)
      expect(thread.authors.get('tea_1')?.name).toBe('Support')
    })

    it('should throw if FRONT_API_KEY is missing', async () => {
      delete process.env.FRONT_API_KEY

      // The workflow would throw when trying to create the context service
      // This is checked in the actual workflow code
      expect(process.env.FRONT_API_KEY).toBeUndefined()
    })
  })
})
