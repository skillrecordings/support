/**
 * Route step unit tests
 *
 * Tests routing logic and memory integration.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClassifyOutput,
  MessageCategory,
  RouteAction,
  ThreadClassifyOutput,
  ThreadSignals,
} from '../types'
import {
  recordEscalationConfirmed,
  recordRoutingOutcome,
  recordShouldHaveEscalated,
  recordUnnecessaryEscalation,
  route,
  routeThread,
  routeThreadWithMemory,
  routeWithMemory,
  shouldEscalate,
  shouldRespond,
  shouldSilence,
} from './route'

// Create mock functions
const mockStore = vi.fn().mockResolvedValue({ id: 'mem-123' })
const mockRecordCitationOutcome = vi.fn().mockResolvedValue(undefined)
const mockQueryMemoriesForStage = vi.fn().mockResolvedValue([])
const mockFormatMemoriesCompact = vi.fn().mockReturnValue('')
const mockCiteMemories = vi.fn().mockResolvedValue(undefined)

// Mock the memory services
vi.mock('@skillrecordings/memory/support-memory', () => ({
  SupportMemoryService: {
    store: mockStore,
    recordCitationOutcome: mockRecordCitationOutcome,
  },
}))

vi.mock('../../memory/query', () => ({
  queryMemoriesForStage: mockQueryMemoriesForStage,
  formatMemoriesCompact: mockFormatMemoriesCompact,
  citeMemories: mockCiteMemories,
}))

// Import for type checking (the actual implementations are mocked above)
import { SupportMemoryService } from '@skillrecordings/memory/support-memory'

describe('route step', () => {
  const mockSignals = {
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

  const mockAppConfig = {
    appId: 'total-typescript',
    instructorConfigured: true,
    autoSendEnabled: true,
  }

  const mockMessage = {
    subject: 'Help with access',
    body: 'I cannot access my course',
    from: '[EMAIL]',
  }

  const createClassification = (
    category: MessageCategory,
    signals: Partial<typeof mockSignals> = {},
    confidence = 0.9
  ): ClassifyOutput => ({
    category,
    confidence,
    signals: { ...mockSignals, ...signals },
    reasoning: 'Test classification',
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('pure routing (no memory)', () => {
    it('routes support categories to respond', () => {
      const result = route({
        message: mockMessage,
        classification: createClassification('support_access'),
        appConfig: mockAppConfig,
      })

      expect(result.action).toBe('respond')
      expect(result.reason).toContain('Support request')
    })

    it('routes spam to silence', () => {
      const result = route({
        message: mockMessage,
        classification: createClassification('spam'),
        appConfig: mockAppConfig,
      })

      expect(result.action).toBe('silence')
      expect(result.reason).toContain('spam')
    })

    it('escalates angry customers', () => {
      const result = route({
        message: mockMessage,
        classification: createClassification('support_refund', {
          hasAngrySentiment: true,
        }),
        appConfig: mockAppConfig,
      })

      expect(result.action).toBe('escalate_human')
      expect(result.reason).toContain('Frustrated')
    })

    it('escalates legal threats urgently', () => {
      const result = route({
        message: mockMessage,
        classification: createClassification('support_refund', {
          hasLegalThreat: true,
        }),
        appConfig: mockAppConfig,
      })

      expect(result.action).toBe('escalate_urgent')
      expect(result.reason).toContain('Legal threat')
    })

    it('routes fan mail to instructor', () => {
      const result = route({
        message: mockMessage,
        classification: createClassification('fan_mail'),
        appConfig: mockAppConfig,
      })

      expect(result.action).toBe('escalate_instructor')
      expect(result.reason).toContain('Personal message')
    })
  })

  describe('helper functions', () => {
    it('shouldRespond returns true for respond action', () => {
      expect(shouldRespond('respond')).toBe(true)
      expect(shouldRespond('silence')).toBe(false)
      expect(shouldRespond('escalate_human')).toBe(false)
    })

    it('shouldEscalate returns true for escalation actions', () => {
      expect(shouldEscalate('escalate_human')).toBe(true)
      expect(shouldEscalate('escalate_instructor')).toBe(true)
      expect(shouldEscalate('escalate_urgent')).toBe(true)
      expect(shouldEscalate('respond')).toBe(false)
    })

    it('shouldSilence returns true for silence action', () => {
      expect(shouldSilence('silence')).toBe(true)
      expect(shouldSilence('respond')).toBe(false)
    })
  })

  describe('memory-aware routing', () => {
    it('queries memory before routing', async () => {
      const result = await routeWithMemory({
        message: mockMessage,
        classification: createClassification('support_access'),
        appConfig: mockAppConfig,
        conversationId: 'cnv-123',
        runId: 'run-456',
      })

      expect(mockQueryMemoriesForStage).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'total-typescript',
          stage: 'route',
          category: 'support_access',
          limit: 5,
        })
      )

      expect(result.action).toBe('respond')
    })

    it('returns memory context when memories are found', async () => {
      const mockMemories = [
        {
          id: 'mem-1',
          situation: 'Similar access issue',
          decision: 'Routed to: respond',
          score: 0.8,
          rawScore: 0.85,
          ageDays: 5,
          outcome: 'success' as const,
          confidence: 0.9,
        },
      ]

      mockQueryMemoriesForStage.mockResolvedValueOnce(mockMemories)

      const result = await routeWithMemory({
        message: mockMessage,
        classification: createClassification('support_access'),
        appConfig: mockAppConfig,
        conversationId: 'cnv-123',
        runId: 'run-456',
      })

      expect(result.citedMemoryIds).toEqual(['mem-1'])
      expect(mockCiteMemories).toHaveBeenCalledWith(
        ['mem-1'],
        'run-456',
        'total-typescript'
      )
    })

    it('suggests escalation based on corrected memories', async () => {
      const mockMemories = [
        {
          id: 'mem-1',
          situation: 'Complex access issue',
          decision: 'Routed to: respond',
          score: 0.75,
          rawScore: 0.8,
          ageDays: 3,
          outcome: 'corrected' as const,
          correction: 'Should have: escalate_human - Needed human judgment',
          confidence: 0.9,
        },
      ]

      mockQueryMemoriesForStage.mockResolvedValueOnce(mockMemories)

      const result = await routeWithMemory({
        message: mockMessage,
        classification: createClassification('support_access'),
        appConfig: mockAppConfig,
        conversationId: 'cnv-123',
      })

      // Should suggest escalation based on corrected memory
      expect(result.memoryOverride).toBeDefined()
      expect(result.memoryOverride?.suggestedAction).toBe('escalate_human')
    })

    it('handles memory query failures gracefully', async () => {
      mockQueryMemoriesForStage.mockRejectedValueOnce(
        new Error('Memory service down')
      )

      const result = await routeWithMemory({
        message: mockMessage,
        classification: createClassification('support_access'),
        appConfig: mockAppConfig,
        conversationId: 'cnv-123',
      })

      // Should still return valid routing
      expect(result.action).toBe('respond')
      expect(result.citedMemoryIds).toBeUndefined()
    })
  })

  describe('routing outcome recording', () => {
    it('records successful routing outcome', async () => {
      await recordRoutingOutcome({
        appId: 'total-typescript',
        category: 'support_refund',
        issueSummary: 'Customer requested refund after 2 months',
        routedAction: 'escalate_human',
        wasCorrect: true,
        conversationId: 'cnv-123',
      })

      expect(mockStore).toHaveBeenCalledWith(
        expect.objectContaining({
          app_slug: 'total-typescript',
          stage: 'route',
          outcome: 'success',
          category: 'support_refund',
          conversation_id: 'cnv-123',
        })
      )
    })

    it('records routing correction', async () => {
      await recordRoutingOutcome({
        appId: 'total-typescript',
        category: 'support_technical',
        issueSummary: 'Complex TypeScript question',
        routedAction: 'respond',
        wasCorrect: false,
        correctAction: 'escalate_instructor',
        correctionReason: "Required Matt's expertise",
        conversationId: 'cnv-456',
      })

      expect(mockStore).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'corrected',
          correction:
            "Should have: escalate_instructor - Required Matt's expertise",
        })
      )
    })

    it('records citation outcomes when provided', async () => {
      await recordRoutingOutcome({
        appId: 'total-typescript',
        category: 'support_access',
        issueSummary: 'Access issue',
        routedAction: 'respond',
        wasCorrect: false,
        correctAction: 'escalate_human',
        conversationId: 'cnv-789',
        citedMemoryIds: ['mem-1', 'mem-2'],
        runId: 'run-123',
      })

      expect(mockRecordCitationOutcome).toHaveBeenCalledWith(
        ['mem-1', 'mem-2'],
        'run-123',
        'failure',
        'total-typescript'
      )
    })
  })

  describe('convenience outcome recording functions', () => {
    it('recordEscalationConfirmed records success', async () => {
      await recordEscalationConfirmed(
        'total-typescript',
        'support_refund',
        'Refund request outside policy',
        'escalate_human',
        'cnv-123'
      )

      expect(mockStore).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'success',
        })
      )
    })

    it('recordShouldHaveEscalated records correction', async () => {
      await recordShouldHaveEscalated(
        'total-typescript',
        'support_technical',
        'Edge case question',
        'escalate_instructor',
        'cnv-456',
        'Needed instructor expertise'
      )

      expect(mockStore).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'corrected',
          correction:
            'Should have: escalate_instructor - Needed instructor expertise',
        })
      )
    })

    it('recordUnnecessaryEscalation records over-escalation', async () => {
      await recordUnnecessaryEscalation(
        'total-typescript',
        'support_access',
        'Simple access reset',
        'escalate_human',
        'cnv-789',
        'Could have been auto-resolved'
      )

      expect(mockStore).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'corrected',
          correction: 'Should have: respond - Could have been auto-resolved',
        })
      )
    })
  })
})

describe('thread routing', () => {
  const mockThreadSignals: ThreadSignals = {
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
    // Thread-specific signals
    threadLength: 3,
    threadDurationHours: 24,
    customerMessageCount: 2,
    teammateMessageCount: 1,
    agentMessageCount: 0,
    lastMessageDirection: 'in',
    threadPattern: 'in-out-in',
    hasThankYou: false,
    hasResolutionPhrase: false,
    awaitingCustomerReply: false,
    hasTeammateMessage: false,
    hasRecentTeammateResponse: false,
    hasInstructorMessage: false,
    instructorIsAuthor: false,
    isInternalThread: false,
    lastResponderType: 'customer',
  }

  const mockAppConfig = {
    appId: 'total-typescript',
    instructorConfigured: true,
    autoSendEnabled: true,
  }

  const createThreadClassification = (
    category: MessageCategory,
    signals: Partial<ThreadSignals> = {},
    confidence = 0.9
  ): ThreadClassifyOutput => ({
    category,
    confidence,
    signals: { ...mockThreadSignals, ...signals },
    reasoning: 'Test thread classification',
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('pure thread routing', () => {
    it('routes resolved threads to silence', () => {
      const result = routeThread({
        classification: createThreadClassification('resolved', {
          hasResolutionPhrase: true,
        }),
        appConfig: mockAppConfig,
      })

      expect(result.action).toBe('silence')
    })

    it('supports teammate when they are handling and customer replied', () => {
      // shouldSupportTeammate requires: hasTeammateMessage, lastResponderType=customer, !awaitingCustomerReply
      const result = routeThread({
        classification: createThreadClassification('support_access', {
          hasTeammateMessage: true,
          lastResponderType: 'customer',
          awaitingCustomerReply: false,
        }),
        appConfig: mockAppConfig,
      })

      expect(result.action).toBe('support_teammate')
    })
  })

  describe('memory-aware thread routing', () => {
    it('queries memory for thread routing', async () => {
      const result = await routeThreadWithMemory({
        classification: createThreadClassification('support_technical'),
        appConfig: mockAppConfig,
        conversationId: 'cnv-thread-123',
        runId: 'run-789',
      })

      expect(mockQueryMemoriesForStage).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'total-typescript',
          stage: 'route',
          category: 'support_technical',
        })
      )

      expect(result.action).toBe('respond')
    })
  })
})
