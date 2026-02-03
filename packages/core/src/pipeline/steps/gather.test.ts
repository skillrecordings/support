import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RelevantMemory } from '../../memory/query'
import type {
  ClassifyOutput,
  GatherInput,
  KnowledgeItem,
  MessageCategory,
  MessageSignals,
  PriorConversation,
  Purchase,
  User,
} from '../types'
import {
  type GatherOptions,
  type GatherResultWithMemory,
  type GatherTools,
  determineCustomerEmail,
  extractEmail,
  extractGatherPriorities,
  formatContextForPrompt,
  gather,
} from './gather'

// Mock the memory and observability modules
vi.mock('@skillrecordings/memory/support-memory', () => ({
  SupportMemoryService: {
    store: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../memory/query', () => ({
  queryMemoriesForStage: vi.fn().mockResolvedValue([]),
  formatMemoriesCompact: vi.fn().mockReturnValue(''),
}))

vi.mock('../../observability/axiom', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

describe('gather step', () => {
  const mockUser: User = {
    id: 'usr_123',
    email: 'customer@example.com',
    name: 'Test Customer',
    createdAt: '2025-01-01T00:00:00Z',
  }

  const mockPurchases: Purchase[] = [
    {
      id: 'pur_123',
      productId: 'prod_ts',
      productName: 'Total TypeScript',
      purchasedAt: '2025-01-10T00:00:00Z',
      amount: 29900,
      status: 'active',
    },
  ]

  const mockSignals: MessageSignals = {
    hasEmailInBody: false,
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
    isPresalesFaq: false,
    isPresalesTeam: false,
  }

  const createClassifyOutput = (): ClassifyOutput => ({
    category: 'support_access' as MessageCategory,
    confidence: 0.95,
    signals: mockSignals,
    reasoning: 'Login/access problem',
  })

  const createGatherInput = (
    overrides: Partial<GatherInput> = {}
  ): GatherInput => ({
    message: {
      subject: 'Need help with access',
      body: 'I purchased the course but cannot login',
      from: 'customer@example.com',
      conversationId: 'cnv_123',
    },
    classification: createClassifyOutput(),
    appId: 'total-typescript',
    ...overrides,
  })

  describe('extractEmail', () => {
    it('extracts valid email from text', () => {
      const text = 'Please contact me at customer@example.com for help'
      expect(extractEmail(text)).toBe('customer@example.com')
    })

    it('returns first email if multiple present', () => {
      const text = 'From customer@example.com to other@example.com'
      expect(extractEmail(text)).toBe('customer@example.com')
    })

    it('returns null for no email', () => {
      const text = 'No email here'
      expect(extractEmail(text)).toBeNull()
    })

    it('filters out noreply addresses', () => {
      const text = 'noreply@company.com and customer@example.com'
      expect(extractEmail(text)).toBe('customer@example.com')
    })

    it('filters out internal support emails', () => {
      const text =
        'support@totaltypescript.com forwarded from customer@example.com'
      expect(extractEmail(text)).toBe('customer@example.com')
    })
  })

  describe('determineCustomerEmail', () => {
    it('prioritizes sender email over body extraction', () => {
      const result = determineCustomerEmail(
        'primary@example.com',
        'Contact me at secondary@example.com'
      )
      expect(result.email).toBe('primary@example.com')
      expect(result.source).toBe('sender')
    })

    it('falls back to body when sender is missing', () => {
      const result = determineCustomerEmail(
        undefined,
        'My email is fallback@example.com'
      )
      expect(result.email).toBe('fallback@example.com')
      expect(result.source).toBe('body')
    })

    it('returns none when no email found', () => {
      const result = determineCustomerEmail(undefined, 'No email here')
      expect(result.email).toBeNull()
      expect(result.source).toBe('none')
    })

    it('handles empty sender string', () => {
      const result = determineCustomerEmail(
        '',
        'Contact me at body@example.com'
      )
      expect(result.email).toBe('body@example.com')
      expect(result.source).toBe('body')
    })
  })

  describe('extractGatherPriorities', () => {
    it('extracts must-gather priorities from high-confidence corrections', () => {
      const memories: RelevantMemory[] = [
        {
          id: 'mem_1',
          situation: 'refund request',
          decision: 'Gathered user info',
          outcome: 'corrected',
          correction: 'Should have also gathered: refund history',
          score: 0.85,
          rawScore: 0.9,
          ageDays: 5,
          confidence: 0.85,
        },
      ]

      const priorities = extractGatherPriorities(memories)

      expect(priorities.mustGather.length).toBeGreaterThan(0)
      expect(priorities.mustGather[0]?.dataType).toBe('refund_history')
    })

    it('extracts may-gather priorities from lower-confidence corrections', () => {
      const memories: RelevantMemory[] = [
        {
          id: 'mem_1',
          situation: 'access issue',
          decision: 'Gathered user info',
          outcome: 'corrected',
          correction: 'Could have checked purchase history',
          score: 0.55,
          rawScore: 0.6,
          ageDays: 10,
          confidence: 0.55,
        },
      ]

      const priorities = extractGatherPriorities(memories)

      expect(priorities.mayGather.length).toBeGreaterThan(0)
    })

    it('ignores non-corrected memories', () => {
      const memories: RelevantMemory[] = [
        {
          id: 'mem_1',
          situation: 'refund request',
          decision: 'Good decision',
          outcome: 'success',
          score: 0.95,
          rawScore: 0.95,
          ageDays: 2,
          confidence: 0.95,
        },
      ]

      const priorities = extractGatherPriorities(memories)

      expect(priorities.mustGather.length).toBe(0)
      expect(priorities.mayGather.length).toBe(0)
    })
  })

  describe('gather function', () => {
    it('gathers user and purchases when tools provided', async () => {
      const tools: GatherTools = {
        lookupUser: vi.fn().mockResolvedValue({
          user: mockUser,
          purchases: mockPurchases,
        }),
      }

      const result = await gather(createGatherInput(), {
        tools,
        skipMemory: true,
      })

      expect(result.user).toEqual(mockUser)
      expect(result.purchases).toEqual(mockPurchases)
      expect(result.gatheredSources).toContain('user')
      expect(result.gatheredSources).toContain('purchases')
    })

    it('gathers knowledge when tool provided', async () => {
      const knowledge: KnowledgeItem[] = [
        {
          id: 'kb_1',
          type: 'faq',
          content: 'How to login...',
          relevance: 0.9,
        },
      ]

      const tools: GatherTools = {
        searchKnowledge: vi.fn().mockResolvedValue(knowledge),
      }

      const result = await gather(createGatherInput(), {
        tools,
        skipMemory: true,
      })

      expect(result.knowledge).toEqual(knowledge)
      expect(result.gatheredSources).toContain('knowledge')
    })

    it('gathers prior conversations', async () => {
      const priorConvos: PriorConversation[] = [
        {
          conversationId: 'cnv_old',
          subject: 'Previous issue',
          status: 'resolved',
          lastMessageAt: new Date().toISOString(),
          messageCount: 5,
          tags: ['refund'],
        },
      ]

      const tools: GatherTools = {
        getPriorConversations: vi.fn().mockResolvedValue(priorConvos),
      }

      const result = await gather(createGatherInput(), {
        tools,
        skipMemory: true,
      })

      expect(result.priorConversations).toEqual(priorConvos)
      expect(result.gatheredSources).toContain('priorConversations')
    })

    it('handles tool errors gracefully', async () => {
      const tools: GatherTools = {
        lookupUser: vi
          .fn()
          .mockRejectedValue(new Error('DB connection failed')),
        searchKnowledge: vi
          .fn()
          .mockResolvedValue([
            { id: 'kb_1', type: 'faq', content: 'Test', relevance: 0.9 },
          ]),
      }

      const result = await gather(createGatherInput(), {
        tools,
        skipMemory: true,
      })

      // Should still have knowledge despite user lookup failure
      expect(result.knowledge.length).toBeGreaterThan(0)
      expect(result.gatherErrors.some((e) => e.step === 'user')).toBe(true)
    })

    it('handles timeout gracefully', async () => {
      const tools: GatherTools = {
        lookupUser: vi
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 10000))
          ),
      }

      const result = await gather(createGatherInput(), {
        tools,
        timeout: 100, // 100ms timeout
        skipMemory: true,
      })

      expect(
        result.gatherErrors.some((e) => e.error.includes('timed out'))
      ).toBe(true)
    })

    it('records email resolution metadata', async () => {
      const input = createGatherInput({
        message: {
          subject: 'Help',
          body: 'My email is body@example.com',
          from: 'sender@example.com',
        },
      })

      const result = await gather(input, { skipMemory: true })

      expect(result.emailResolution).toBeDefined()
      expect(result.emailResolution?.email).toBe('sender@example.com')
      expect(result.emailResolution?.source).toBe('sender')
      expect(result.emailResolution?.bodyExtractedEmail).toBe(
        'body@example.com'
      )
    })

    it('returns empty result when no tools provided', async () => {
      const result = await gather(createGatherInput(), { skipMemory: true })

      expect(result.user).toBeNull()
      expect(result.purchases).toEqual([])
      expect(result.knowledge).toEqual([])
      expect(result.gatheredSources).toEqual([])
    })
  })

  describe('formatContextForPrompt', () => {
    it('formats user and purchases for prompt', () => {
      const context: GatherResultWithMemory = {
        user: mockUser,
        purchases: mockPurchases,
        knowledge: [],
        history: [],
        priorMemory: [],
        priorConversations: [],
        gatherErrors: [],
        gatheredSources: ['user', 'purchases'],
      }

      const formatted = formatContextForPrompt(context)

      expect(formatted).toContain('customer@example.com')
      expect(formatted).toContain('Test Customer')
      expect(formatted).toContain('Total TypeScript')
      expect(formatted).toContain('active')
    })

    it('shows no account message when user is null', () => {
      const context: GatherResultWithMemory = {
        user: null,
        purchases: [],
        knowledge: [],
        history: [],
        priorMemory: [],
        priorConversations: [],
        gatherErrors: [],
        gatheredSources: [],
      }

      const formatted = formatContextForPrompt(context)

      expect(formatted).toContain('No account found')
    })

    it('formats refund policy when present', () => {
      const context: GatherResultWithMemory = {
        user: null,
        purchases: [],
        knowledge: [],
        history: [],
        priorMemory: [],
        priorConversations: [],
        gatherErrors: [],
        gatheredSources: [],
        refundPolicy: {
          autoApproveWindowDays: 30,
          manualApproveWindowDays: 45,
        },
      }

      const formatted = formatContextForPrompt(context)

      expect(formatted).toContain('Refund Policy')
      expect(formatted).toContain('30 days')
    })

    it('formats active promotions when present', () => {
      const context: GatherResultWithMemory = {
        user: null,
        purchases: [],
        knowledge: [],
        history: [],
        priorMemory: [],
        priorConversations: [],
        gatherErrors: [],
        gatheredSources: [],
        activePromotions: [
          {
            id: 'promo_1',
            name: 'Summer Sale',
            discountType: 'percent',
            discountAmount: 30,
            active: true,
            code: 'SUMMER30',
          },
        ],
      }

      const formatted = formatContextForPrompt(context)

      expect(formatted).toContain('Active Promotions')
      expect(formatted).toContain('Summer Sale')
      expect(formatted).toContain('30% off')
      expect(formatted).toContain('SUMMER30')
    })

    it('formats license info when present', () => {
      const context: GatherResultWithMemory = {
        user: null,
        purchases: [],
        knowledge: [],
        history: [],
        priorMemory: [],
        priorConversations: [],
        gatherErrors: [],
        gatheredSources: [],
        licenseInfo: [
          {
            purchaseId: 'pur_team',
            licenseType: 'team',
            totalSeats: 10,
            claimedSeats: 7,
            availableSeats: 3,
            claimedBy: [
              { email: 'seat-holder@example.com', claimedAt: '2025-01-15' },
            ],
          },
        ],
      }

      const formatted = formatContextForPrompt(context)

      expect(formatted).toContain('Team Licenses')
      expect(formatted).toContain('7/10 seats claimed')
      expect(formatted).toContain('3 available')
    })

    it('formats multi-product VIP customer', () => {
      const context: GatherResultWithMemory = {
        user: mockUser,
        purchases: mockPurchases,
        knowledge: [],
        history: [],
        priorMemory: [],
        priorConversations: [
          {
            conversationId: 'cnv_1',
            subject: 'TS Question',
            status: 'resolved',
            lastMessageAt: '2025-01-20',
            messageCount: 3,
            tags: ['total-typescript'],
          },
          {
            conversationId: 'cnv_2',
            subject: 'React Question',
            status: 'resolved',
            lastMessageAt: '2025-01-21',
            messageCount: 4,
            tags: ['react-essentials'],
          },
        ],
        gatherErrors: [],
        gatheredSources: ['user', 'purchases', 'priorConversations'],
      }

      const formatted = formatContextForPrompt(context)

      expect(formatted).toContain('Multi-product customer')
      expect(formatted).toContain('VIP')
    })

    it('includes memory priorities from past corrections', () => {
      const context: GatherResultWithMemory = {
        user: null,
        purchases: [],
        knowledge: [],
        history: [],
        priorMemory: [],
        priorConversations: [],
        gatherErrors: [],
        gatheredSources: [],
        gatherPriorities: {
          mustGather: [
            {
              dataType: 'refund_history',
              reason: 'Should have checked previous refunds',
              confidence: 0.9,
            },
          ],
          mayGather: [],
          sourceMemories: [],
        },
      }

      const formatted = formatContextForPrompt(context)

      expect(formatted).toContain('Past Corrections')
      expect(formatted).toContain('refund_history')
    })

    it('never includes gather errors in prompt (security)', () => {
      const context: GatherResultWithMemory = {
        user: null,
        purchases: [],
        knowledge: [],
        history: [],
        priorMemory: [],
        priorConversations: [],
        gatherErrors: [
          {
            step: 'user',
            error: 'Database connection failed with password xyz',
          },
        ],
        gatheredSources: [],
      }

      const formatted = formatContextForPrompt(context)

      expect(formatted).not.toContain('error')
      expect(formatted).not.toContain('Database')
      expect(formatted).not.toContain('password')
    })
  })
})
