/**
 * Tests for validate-draft workflow event emission.
 *
 * Verifies that the SUPPORT_DRAFT_VALIDATED event includes:
 * 1. draft.toolsUsed — forwarded from incoming draft
 * 2. validation.structuredIssues — full ValidationIssue objects alongside string[]
 * 3. gatheredContext — full context from CONTEXT_GATHERED, not just counts
 *
 * These are the three data-loss fixes from the Epic 1.5 data flow audit (Boundary 6).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock observability
vi.mock('../../../observability/axiom', () => ({
  initializeAxiom: vi.fn(),
  log: vi.fn(),
  traceWorkflowStep: vi.fn(),
}))

// Mock data integrity
vi.mock('../../../pipeline/assert-data-integrity', () => ({
  assertDataIntegrity: vi.fn(),
  buildDataFlowCheck: vi.fn(() => ({})),
}))

// Mock validate step — returns configurable results
const mockValidate = vi.fn()
vi.mock('../../../pipeline/steps/validate', () => ({
  validate: (...args: unknown[]) => mockValidate(...args),
}))

// Mock Inngest client
vi.mock('../../client', () => ({
  inngest: {
    createFunction: vi.fn(
      (
        config: Record<string, unknown>,
        trigger: Record<string, unknown>,
        handler: Function
      ) => ({
        ...config,
        trigger,
        handler,
      })
    ),
  },
}))

// Import after mocks
import { SUPPORT_DRAFT_VALIDATED } from '../../events'

describe('validate-draft workflow — event emission', () => {
  const createMockStep = () => ({
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    sendEvent: vi.fn(),
  })

  const baseEventData = {
    conversationId: 'cnv_test123',
    messageId: 'msg_test456',
    appId: 'total-typescript',
    subject: 'Help with TypeScript generics',
    body: 'I need help understanding generics in TypeScript.',
    senderEmail: 'customer@example.com',
    classification: {
      category: 'support_content',
      confidence: 0.92,
      signals: { hasCodeSnippet: true },
      reasoning: 'Technical question about TypeScript generics',
    },
    draft: {
      content:
        'Generics let you write reusable code that works with multiple types. Here is an example...',
      toolsUsed: ['search-knowledge', 'lookup-user'],
    },
    context: {
      customer: {
        email: 'customer@example.com',
        purchases: [
          {
            id: 'pur_1',
            productId: 'tt-pro',
            productName: 'Total TypeScript Pro',
            status: 'valid',
            purchaseDate: '2025-03-15',
          },
          {
            id: 'pur_2',
            productId: 'tt-zod',
            productName: 'Zod Tutorial',
            status: 'valid',
            purchaseDate: '2025-01-10',
          },
        ],
        trustScore: 0.8,
      },
      knowledge: [
        {
          id: 'k1',
          type: 'faq',
          content: 'Generics allow...',
          relevance: 0.95,
        },
        {
          id: 'k2',
          type: 'article',
          content: 'Advanced generics...',
          relevance: 0.78,
        },
      ],
      memories: [{ id: 'm1', content: 'Prior interaction', score: 0.7 }],
      history: [
        {
          body: 'I need help with generics',
          from: 'customer@example.com',
          date: '1706000000',
        },
        {
          body: 'Sure, let me look into that.',
          from: 'agent',
          date: '1706000100',
        },
      ],
      priorConversations: [
        {
          conversationId: 'cnv_prior1',
          subject: 'TypeScript setup help',
          status: 'resolved',
          lastMessageAt: '2025-06-01',
          messageCount: 4,
          tags: ['support_content'],
        },
      ],
    },
    traceId: 'trace-test-001',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function runWorkflow(
    eventDataOverrides: Record<string, unknown> = {},
    validateResult?: Record<string, unknown>
  ) {
    // Configure mock validate result
    mockValidate.mockResolvedValue(
      validateResult ?? {
        valid: true,
        issues: [],
        relevance: 0.95,
        memoryCheckPerformed: true,
        relevanceCheckPerformed: true,
      }
    )

    // Import the workflow (after mocks)
    const { validateWorkflow } = await import('../validate-draft')

    const step = createMockStep()
    const event = {
      data: { ...baseEventData, ...eventDataOverrides },
    }

    // Run the handler
    await (validateWorkflow as unknown as { handler: Function }).handler({
      event,
      step,
    })

    // Find the sendEvent call for emit-validated
    const sendEventCall = step.sendEvent.mock.calls.find(
      (args: unknown[]) => args[0] === 'emit-validated'
    )
    expect(sendEventCall).toBeDefined()

    const emittedEvent = sendEventCall![1] as {
      name: string
      data: Record<string, unknown>
    }
    expect(emittedEvent.name).toBe(SUPPORT_DRAFT_VALIDATED)

    return emittedEvent.data as any
  }

  // ========================================================================
  // Fix 1: draft.toolsUsed forwarded
  // ========================================================================

  describe('draft.toolsUsed forwarding', () => {
    it('forwards toolsUsed from the incoming draft', async () => {
      const data = await runWorkflow()
      expect(data.draft.toolsUsed).toEqual(['search-knowledge', 'lookup-user'])
    })

    it('forwards draft.content unchanged', async () => {
      const data = await runWorkflow()
      expect(data.draft.content).toBe(baseEventData.draft.content)
    })

    it('handles undefined toolsUsed gracefully', async () => {
      const data = await runWorkflow({
        draft: {
          content: 'Some draft content here for testing purposes.',
          toolsUsed: undefined,
        },
      })
      expect(data.draft.content).toBe(
        'Some draft content here for testing purposes.'
      )
      expect(data.draft.toolsUsed).toBeUndefined()
    })

    it('handles empty toolsUsed array', async () => {
      const data = await runWorkflow({
        draft: {
          content: 'Draft with no tools used during generation.',
          toolsUsed: [],
        },
      })
      expect(data.draft.toolsUsed).toEqual([])
    })
  })

  // ========================================================================
  // Fix 2: structured validation issues preserved
  // ========================================================================

  describe('validation.structuredIssues', () => {
    const issuesWithDetails = [
      {
        type: 'internal_leak' as const,
        severity: 'error' as const,
        message: 'Response exposes internal system state',
        match: 'no instructor configured',
        position: 42,
      },
      {
        type: 'banned_phrase' as const,
        severity: 'error' as const,
        message: 'Response contains banned phrase',
        match: 'I hope this helps',
        position: 120,
      },
      {
        type: 'too_long' as const,
        severity: 'warning' as const,
        message: 'Response too long (2500 chars, max 2000)',
        // no match or position
      },
    ]

    it('emits structuredIssues with full ValidationIssue data', async () => {
      const data = await runWorkflow(
        {},
        {
          valid: false,
          issues: issuesWithDetails,
          relevance: 0.3,
          memoryCheckPerformed: false,
          relevanceCheckPerformed: true,
        }
      )

      expect(data.validation.structuredIssues).toBeDefined()
      expect(data.validation.structuredIssues).toHaveLength(3)

      // Check first issue has all fields
      const leak = data.validation.structuredIssues[0]
      expect(leak.type).toBe('internal_leak')
      expect(leak.severity).toBe('error')
      expect(leak.message).toBe('Response exposes internal system state')
      expect(leak.match).toBe('no instructor configured')
      expect(leak.position).toBe(42)

      // Check second issue
      const banned = data.validation.structuredIssues[1]
      expect(banned.type).toBe('banned_phrase')
      expect(banned.match).toBe('I hope this helps')

      // Check third issue (no match/position — should not have those keys)
      const tooLong = data.validation.structuredIssues[2]
      expect(tooLong.type).toBe('too_long')
      expect(tooLong.severity).toBe('warning')
      expect(tooLong).not.toHaveProperty('match')
      expect(tooLong).not.toHaveProperty('position')
    })

    it('still emits flattened string[] issues for backward compat', async () => {
      const data = await runWorkflow(
        {},
        {
          valid: false,
          issues: issuesWithDetails,
          relevance: 0.3,
          memoryCheckPerformed: false,
          relevanceCheckPerformed: true,
        }
      )

      expect(data.validation.issues).toEqual([
        'Response exposes internal system state',
        'Response contains banned phrase',
        'Response too long (2500 chars, max 2000)',
      ])
    })

    it('emits empty structuredIssues when validation passes', async () => {
      const data = await runWorkflow()
      expect(data.validation.structuredIssues).toEqual([])
      expect(data.validation.issues).toEqual([])
    })
  })

  // ========================================================================
  // Fix 3: full gathered context forwarded
  // ========================================================================

  describe('gatheredContext forwarding', () => {
    it('forwards full customer object with purchases', async () => {
      const data = await runWorkflow()
      expect(data.gatheredContext).toBeDefined()
      expect(data.gatheredContext.customer).toEqual(
        baseEventData.context.customer
      )
      expect(data.gatheredContext.customer.purchases).toHaveLength(2)
      expect(data.gatheredContext.customer.purchases[0].productName).toBe(
        'Total TypeScript Pro'
      )
    })

    it('forwards knowledge items', async () => {
      const data = await runWorkflow()
      expect(data.gatheredContext.knowledge).toHaveLength(2)
      expect(data.gatheredContext.knowledge[0].id).toBe('k1')
    })

    it('forwards memories', async () => {
      const data = await runWorkflow()
      expect(data.gatheredContext.memories).toHaveLength(1)
    })

    it('forwards conversation history', async () => {
      const data = await runWorkflow()
      expect(data.gatheredContext.history).toHaveLength(2)
      expect(data.gatheredContext.history[0].from).toBe('customer@example.com')
    })

    it('forwards priorConversations', async () => {
      const data = await runWorkflow()
      expect(data.gatheredContext.priorConversations).toHaveLength(1)
      expect(data.gatheredContext.priorConversations[0].conversationId).toBe(
        'cnv_prior1'
      )
    })

    it('still emits flattened context with counts for backward compat', async () => {
      const data = await runWorkflow()
      expect(data.context).toBeDefined()
      expect(data.context.customerEmail).toBe('customer@example.com')
      expect(data.context.purchaseCount).toBe(2)
      expect(data.context.knowledgeCount).toBe(2)
      expect(data.context.memoryCount).toBe(1)
      expect(data.context.category).toBe('support_content')
      expect(data.context.confidence).toBe(0.92)
    })

    it('handles null customer in context', async () => {
      const data = await runWorkflow({
        context: {
          customer: null,
          knowledge: [],
          memories: [],
          history: [],
        },
      })
      expect(data.gatheredContext.customer).toBeNull()
      expect(data.gatheredContext.knowledge).toEqual([])
      expect(data.context.customerEmail).toBeUndefined()
      expect(data.context.purchaseCount).toBe(0)
    })

    it('handles undefined context gracefully', async () => {
      const data = await runWorkflow({ context: undefined })
      expect(data.gatheredContext).toBeUndefined()
      // Flattened context should still have classification data
      expect(data.context.category).toBe('support_content')
      expect(data.context.purchaseCount).toBe(0)
    })

    it('handles context without priorConversations', async () => {
      const data = await runWorkflow({
        context: {
          customer: {
            email: 'test@test.com',
            purchases: [],
          },
          knowledge: [],
          memories: [],
          history: [],
          // no priorConversations
        },
      })
      expect(data.gatheredContext).toBeDefined()
      expect(data.gatheredContext).not.toHaveProperty('priorConversations')
    })
  })

  // ========================================================================
  // Pass-through fields (unchanged behavior)
  // ========================================================================

  describe('pass-through fields unchanged', () => {
    it('forwards conversationId', async () => {
      const data = await runWorkflow()
      expect(data.conversationId).toBe('cnv_test123')
    })

    it('forwards messageId', async () => {
      const data = await runWorkflow()
      expect(data.messageId).toBe('msg_test456')
    })

    it('forwards appId', async () => {
      const data = await runWorkflow()
      expect(data.appId).toBe('total-typescript')
    })

    it('forwards subject/body/senderEmail with fallbacks', async () => {
      const data = await runWorkflow({
        subject: undefined,
        body: undefined,
        senderEmail: undefined,
      })
      expect(data.subject).toBe('')
      expect(data.body).toBe('')
      expect(data.senderEmail).toBe('')
    })

    it('forwards classification', async () => {
      const data = await runWorkflow()
      expect(data.classification.category).toBe('support_content')
      expect(data.classification.confidence).toBe(0.92)
    })

    it('forwards traceId', async () => {
      const data = await runWorkflow()
      expect(data.traceId).toBe('trace-test-001')
    })

    it('forwards validation.valid and score', async () => {
      const data = await runWorkflow(
        {},
        {
          valid: true,
          issues: [],
          relevance: 0.88,
          memoryCheckPerformed: true,
          relevanceCheckPerformed: true,
        }
      )
      expect(data.validation.valid).toBe(true)
      expect(data.validation.score).toBe(1.0)
    })

    it('sets score to 0 when validation fails', async () => {
      const data = await runWorkflow(
        {},
        {
          valid: false,
          issues: [
            {
              type: 'internal_leak',
              severity: 'error',
              message: 'test',
            },
          ],
          relevance: 0.5,
          memoryCheckPerformed: false,
          relevanceCheckPerformed: true,
        }
      )
      expect(data.validation.valid).toBe(false)
      expect(data.validation.score).toBe(0.0)
    })
  })
})
