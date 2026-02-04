// Set environment variables BEFORE any imports
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the database module
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
}

vi.mock('@skillrecordings/database', () => ({
  getDb: vi.fn(() => mockDb),
  ActionsTable: {},
  ApprovalRequestsTable: {},
  IdempotencyKeysTable: {},
  eq: vi.fn((field, value) => ({ field, value })),
  gt: vi.fn((field, value) => ({ field, value })),
  and: vi.fn((...conditions) => ({ conditions })),
}))

// Mock Front SDK for audit comments
const mockAddComment = vi.fn().mockResolvedValue({})
const mockFrontSdkClient = {
  conversations: {
    addComment: mockAddComment,
    updateAssignee: vi.fn().mockResolvedValue({}),
  },
}
vi.mock('@skillrecordings/front-sdk', () => ({
  createFrontClient: vi.fn(() => mockFrontSdkClient),
}))

// Mock internal front client
const mockFrontClient = {
  createDraft: vi.fn().mockResolvedValue({ id: 'draft-123' }),
  addComment: vi.fn().mockResolvedValue({}),
  getConversationInbox: vi.fn().mockResolvedValue('inbox-123'),
  getInboxChannel: vi.fn().mockResolvedValue('channel-123'),
}
vi.mock('../front', () => ({
  createFrontClient: vi.fn(() => mockFrontClient),
}))

const mockInstrumentedFrontClient = {
  drafts: {
    delete: vi.fn().mockResolvedValue({}),
  },
  raw: {
    post: vi.fn().mockResolvedValue({ id: 'msg-123' }),
  },
  conversations: {
    addComment: vi.fn().mockResolvedValue({}),
  },
}

vi.mock('../tools', () => ({
  supportTools: {
    processRefund: {
      execute: vi.fn(),
    },
  },
}))

// Mock the idempotency module
vi.mock('../actions', () => ({
  checkIdempotency: vi.fn().mockResolvedValue({
    isDuplicate: false,
    key: 'test-key',
    status: 'pending',
  }),
  completeIdempotencyKey: vi.fn().mockResolvedValue(undefined),
  failIdempotencyKey: vi.fn().mockResolvedValue(undefined),
}))

import * as instrumentedClient from '../front/instrumented-client'
import { SUPPORT_ACTION_APPROVED } from '../inngest/events'
import { executeApprovedAction } from '../inngest/workflows/execute-approved-action'
import { supportTools } from '../tools'

const mockProcessRefund = supportTools.processRefund
  .execute as unknown as ReturnType<typeof vi.fn>

describe('executeApprovedAction workflow', () => {
  it('exports a function', () => {
    expect(executeApprovedAction).toBeDefined()
    expect(typeof executeApprovedAction).toBe('object')
  })

  it('has correct id', () => {
    expect(executeApprovedAction.id()).toBe('execute-approved-action')
  })

  it('has correct name', () => {
    expect(executeApprovedAction.name).toBe('Execute Approved Action')
  })

  describe('workflow execution', () => {
    let mockStep: any
    let stepRunHandlers: Map<string, Function>

    beforeEach(() => {
      stepRunHandlers = new Map()

      // Clear all mocks
      vi.clearAllMocks()
      vi.spyOn(
        instrumentedClient,
        'createInstrumentedFrontClient'
      ).mockReturnValue(mockInstrumentedFrontClient as any)

      // Reset mock implementations
      mockDb.select.mockReturnThis()
      mockDb.from.mockReturnThis()
      mockDb.where.mockReturnThis()
      mockDb.update.mockReturnThis()
      mockDb.set.mockReturnThis()

      // Default mock for processRefund - success
      mockProcessRefund.mockResolvedValue({
        success: true,
        refundId: 'refund-123',
      })

      // Mock Inngest step with captured handlers
      mockStep = {
        run: vi.fn((stepName: string, handler: Function) => {
          stepRunHandlers.set(stepName, handler)
          return handler()
        }),
      }
    })

    it('should lookup action from database', async () => {
      const actionId = 'action-123'
      const mockAction = {
        id: actionId,
        type: 'refund_order',
        parameters: { orderId: 'order-456', amount: 100 },
        conversation_id: 'conv-789',
        app_id: 'app-tt',
      }

      // Setup DB mock to return action
      mockDb.where.mockResolvedValueOnce([mockAction])

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: '[EMAIL]',
          approvedAt: new Date().toISOString(),
        },
      }

      // Execute workflow
      await (executeApprovedAction as any).fn({ event, step: mockStep })

      // Verify lookup-action step was called
      expect(mockStep.run).toHaveBeenCalledWith(
        'lookup-action',
        expect.any(Function)
      )

      // Verify DB query
      expect(mockDb.select).toHaveBeenCalled()
      expect(mockDb.from).toHaveBeenCalled()
      expect(mockDb.where).toHaveBeenCalled()
    })

    it('should throw error if action not found', async () => {
      const actionId = 'nonexistent-action'

      // Setup DB mock to return empty array
      mockDb.where.mockResolvedValueOnce([])

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: '[EMAIL]',
          approvedAt: new Date().toISOString(),
        },
      }

      // Execute workflow and expect error
      await expect(
        (executeApprovedAction as any).fn({ event, step: mockStep })
      ).rejects.toThrow(`Action ${actionId} not found`)
    })

    it('should execute tool with action parameters (stub)', async () => {
      const actionId = 'action-123'
      const mockAction = {
        id: actionId,
        type: 'pending-action',
        parameters: {
          toolCalls: [
            {
              name: 'processRefund',
              args: {
                purchaseId: 'order-456',
                appId: 'app-tt',
                reason: 'Customer request',
              },
            },
          ],
        },
        conversation_id: 'conv-789',
        app_id: 'app-tt',
      }

      mockDb.where.mockResolvedValueOnce([mockAction])
      mockDb.where.mockResolvedValueOnce(undefined) // update-action-status
      mockDb.where.mockResolvedValueOnce(undefined) // update approval request

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: '[EMAIL]',
          approvedAt: new Date().toISOString(),
        },
      }

      const result = await (executeApprovedAction as any).fn({
        event,
        step: mockStep,
      })

      // Verify execute-action step was called
      expect(mockStep.run).toHaveBeenCalledWith(
        'execute-action',
        expect.any(Function)
      )

      // Verify stub returns success
      expect(result.executed).toBe(true)
    })

    it('should update action status on success', async () => {
      const actionId = 'action-123'
      const mockAction = {
        id: actionId,
        type: 'refund_order',
        parameters: { orderId: 'order-456' },
        conversation_id: 'conv-789',
        app_id: 'app-tt',
      }

      mockDb.where.mockResolvedValueOnce([mockAction])
      mockDb.where.mockResolvedValueOnce(undefined) // update-action-status
      mockDb.where.mockResolvedValueOnce(undefined) // update approval request

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: '[EMAIL]',
          approvedAt: new Date().toISOString(),
        },
      }

      await (executeApprovedAction as any).fn({ event, step: mockStep })

      // Verify update-action-status step was called
      expect(mockStep.run).toHaveBeenCalledWith(
        'update-action-status',
        expect.any(Function)
      )

      // Verify DB update was called
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.set).toHaveBeenCalled()
    })

    it('should update approval request status on success', async () => {
      const actionId = 'action-123'
      const mockAction = {
        id: actionId,
        type: 'refund_order',
        parameters: { orderId: 'order-456' },
        conversation_id: 'conv-789',
        app_id: 'app-tt',
      }

      mockDb.where.mockResolvedValueOnce([mockAction])
      mockDb.where.mockResolvedValueOnce(undefined) // update-action-status
      mockDb.where.mockResolvedValueOnce(undefined) // update approval request

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: '[EMAIL]',
          approvedAt: new Date().toISOString(),
        },
      }

      await (executeApprovedAction as any).fn({ event, step: mockStep })

      // Verify both updates were called
      expect(mockDb.update).toHaveBeenCalledTimes(2)
    })

    it('should return execution result with metadata', async () => {
      const actionId = 'action-123'
      const approvedBy = '[EMAIL]'
      const mockAction = {
        id: actionId,
        type: 'pending-action',
        parameters: {
          toolCalls: [
            {
              name: 'processRefund',
              args: {
                purchaseId: 'order-456',
                appId: 'app-tt',
                reason: 'Test',
              },
            },
          ],
        },
        conversation_id: 'conv-789',
        app_id: 'app-tt',
      }

      mockDb.where.mockResolvedValueOnce([mockAction])
      mockDb.where.mockResolvedValueOnce(undefined)
      mockDb.where.mockResolvedValueOnce(undefined)

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy,
          approvedAt: new Date().toISOString(),
        },
      }

      const result = await (executeApprovedAction as any).fn({
        event,
        step: mockStep,
      })

      expect(result).toMatchObject({
        actionId,
        executed: true,
        approvedBy,
      })
    })
  })

  describe('audit trail comments', () => {
    let mockStep: any
    const originalEnv = process.env.ENABLE_AUDIT_COMMENTS

    beforeEach(() => {
      vi.clearAllMocks()
      vi.spyOn(
        instrumentedClient,
        'createInstrumentedFrontClient'
      ).mockReturnValue(mockInstrumentedFrontClient as any)
      mockDb.select.mockReturnThis()
      mockDb.from.mockReturnThis()
      mockDb.update.mockReturnThis()
      mockDb.set.mockReturnThis()

      // Reset internal front client mocks
      mockFrontClient.createDraft.mockResolvedValue({ id: 'draft-123' })
      mockFrontClient.addComment.mockResolvedValue({})
      mockFrontClient.getConversationInbox.mockResolvedValue('inbox-123')
      mockFrontClient.getInboxChannel.mockResolvedValue('channel-123')

      // Reset SDK mocks
      mockAddComment.mockResolvedValue({})

      // Reset env var
      delete process.env.ENABLE_AUDIT_COMMENTS

      // Set FRONT_API_TOKEN for audit comment tests
      process.env.FRONT_API_TOKEN = 'test-token'

      mockStep = {
        run: vi.fn((stepName: string, handler: Function) => {
          return handler()
        }),
      }
    })

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.ENABLE_AUDIT_COMMENTS = originalEnv
      } else {
        delete process.env.ENABLE_AUDIT_COMMENTS
      }
    })

    it('should add audit comment for auto-approved send-draft actions', async () => {
      const actionId = 'action-123'
      const mockAction = {
        id: actionId,
        type: 'send-draft',
        parameters: {
          draft: 'Hello, here is your magic link...',
          autoApproved: true,
          validationScore: 0.92,
          context: {
            category: 'support_access',
            customerEmail: '[EMAIL]',
          },
        },
        conversation_id: 'conv-789',
        app_id: 'app-tt',
      }

      // Return array for lookup, then undefined for updates
      mockDb.where
        .mockResolvedValueOnce([mockAction])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: 'auto',
          approvedAt: new Date().toISOString(),
        },
      }

      await (executeApprovedAction as any).fn({ event, step: mockStep })

      // Verify add-audit-comment step was called
      expect(mockStep.run).toHaveBeenCalledWith(
        'add-audit-comment',
        expect.any(Function)
      )

      // Verify Front SDK addComment was called with audit comment
      expect(
        mockInstrumentedFrontClient.conversations.addComment
      ).toHaveBeenCalledWith('conv-789', expect.stringContaining('Auto-sent'))
    })

    it('should not add audit comment when ENABLE_AUDIT_COMMENTS=false', async () => {
      process.env.ENABLE_AUDIT_COMMENTS = 'false'

      const actionId = 'action-123'
      const mockAction = {
        id: actionId,
        type: 'send-draft',
        parameters: {
          draft: 'Hello, here is your magic link...',
          autoApproved: true,
          validationScore: 0.92,
        },
        conversation_id: 'conv-789',
        app_id: 'app-tt',
      }

      mockDb.where
        .mockResolvedValueOnce([mockAction])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: 'auto',
          approvedAt: new Date().toISOString(),
        },
      }

      await (executeApprovedAction as any).fn({ event, step: mockStep })

      // Verify add-audit-comment step was NOT called
      const stepNames = mockStep.run.mock.calls.map((call: any[]) => call[0])
      expect(stepNames).not.toContain('add-audit-comment')

      // Verify Front SDK addComment was NOT called for audit
      expect(
        mockInstrumentedFrontClient.conversations.addComment
      ).not.toHaveBeenCalled()
    })

    it('should not add audit comment for human-approved actions', async () => {
      const actionId = 'action-123'
      const mockAction = {
        id: actionId,
        type: 'send-draft',
        parameters: {
          draft: 'Hello, here is your magic link...',
          validationScore: 0.75,
        },
        conversation_id: 'conv-789',
        app_id: 'app-tt',
      }

      mockDb.where
        .mockResolvedValueOnce([mockAction])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: '[EMAIL]', // Human approval
          approvedAt: new Date().toISOString(),
        },
      }

      await (executeApprovedAction as any).fn({ event, step: mockStep })

      // Verify add-audit-comment step was NOT called
      const stepNames = mockStep.run.mock.calls.map((call: any[]) => call[0])
      expect(stepNames).not.toContain('add-audit-comment')

      // Verify Front SDK addComment was NOT called for audit
      expect(
        mockInstrumentedFrontClient.conversations.addComment
      ).not.toHaveBeenCalled()
    })

    it('should not add audit comment for non-send action types', async () => {
      const actionId = 'action-123'
      const mockAction = {
        id: actionId,
        type: 'pending-action', // Not send-draft
        parameters: {
          toolCalls: [
            {
              name: 'processRefund',
              args: { purchaseId: 'p-1', appId: 'app', reason: 'test' },
            },
          ],
        },
        conversation_id: 'conv-789',
        app_id: 'app-tt',
      }

      mockDb.where
        .mockResolvedValueOnce([mockAction])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)

      const event = {
        name: SUPPORT_ACTION_APPROVED,
        data: {
          actionId,
          approvedBy: 'auto',
          approvedAt: new Date().toISOString(),
        },
      }

      mockProcessRefund.mockResolvedValue({
        success: true,
        data: { refundId: 'ref-123' },
      })

      await (executeApprovedAction as any).fn({ event, step: mockStep })

      // Verify add-audit-comment step was NOT called (not a send-draft action)
      const stepNames = mockStep.run.mock.calls.map((call: any[]) => call[0])
      expect(stepNames).not.toContain('add-audit-comment')

      // Verify Front SDK addComment was NOT called for audit
      expect(
        mockInstrumentedFrontClient.conversations.addComment
      ).not.toHaveBeenCalled()
    })
  })
})
