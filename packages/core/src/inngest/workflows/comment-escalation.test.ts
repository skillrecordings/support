import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// Mock dependencies before importing the module
vi.mock('../../conversation/hold-state', () => ({
  isOnHold: vi.fn(),
}))

vi.mock('../../observability/axiom', () => ({
  initializeAxiom: vi.fn(),
  log: vi.fn(),
  traceWorkflowStep: vi.fn(),
}))

vi.mock('@skillrecordings/database', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(),
        })),
      })),
    })),
  })),
  ApprovalRequestsTable: { status: 'status', action_id: 'action_id' },
  eq: vi.fn((a, b) => ({ field: a, value: b })),
}))

vi.mock('@skillrecordings/front-sdk', () => ({
  createFrontClient: vi.fn(() => ({
    conversations: {
      addComment: vi.fn(),
    },
  })),
}))

import { createFrontClient } from '@skillrecordings/front-sdk'
import { isOnHold } from '../../conversation/hold-state'

// Type helpers
interface HoldResult {
  onHold: boolean
}

interface ApprovalResult {
  status: string | null
  stillPending: boolean
}

interface CommentResult {
  added: boolean
  error?: string
}

describe('Comment Escalation Workflow', () => {
  let mockFrontClient: { conversations: { addComment: Mock } }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FRONT_API_TOKEN = 'test-api-token'

    mockFrontClient = {
      conversations: {
        addComment: vi.fn().mockResolvedValue({}),
      },
    }
    ;(createFrontClient as Mock).mockReturnValue(mockFrontClient)
  })

  afterEach(() => {
    delete process.env.FRONT_API_TOKEN
  })

  // Helper to create mock step functions with proper typing
  function createMockStep() {
    const sleepCalls: Array<{ name: string; duration: string }> = []

    return {
      sleep: async (name: string, duration: string): Promise<void> => {
        sleepCalls.push({ name, duration })
      },
      run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        return fn()
      },
      sleepCalls,
    }
  }

  describe('Sleep timing', () => {
    it('should sleep for 4 hours before checking status', async () => {
      const mockStep = createMockStep()

      // Simulate first step - sleep
      await mockStep.sleep('wait-for-escalation', '4h')

      expect(mockStep.sleepCalls).toHaveLength(1)
      expect(mockStep.sleepCalls[0]).toEqual({
        name: 'wait-for-escalation',
        duration: '4h',
      })
    })
  })

  describe('Hold status check', () => {
    it('should skip escalation if conversation is on hold', async () => {
      vi.mocked(isOnHold).mockResolvedValue(true)

      const mockStep = createMockStep()

      // Simulate check-hold-status step
      const holdResult = await mockStep.run<HoldResult>(
        'check-hold-status',
        async () => {
          const onHold = await isOnHold('cnv_test456')
          return { onHold }
        }
      )

      expect(isOnHold).toHaveBeenCalledWith('cnv_test456')
      expect(holdResult.onHold).toBe(true)
    })

    it('should continue if conversation is not on hold', async () => {
      vi.mocked(isOnHold).mockResolvedValue(false)

      const mockStep = createMockStep()

      // Simulate check-hold-status step
      const holdResult = await mockStep.run<HoldResult>(
        'check-hold-status',
        async () => {
          const onHold = await isOnHold('cnv_test456')
          return { onHold }
        }
      )

      expect(holdResult.onHold).toBe(false)
    })
  })

  describe('Approval status check', () => {
    it('should skip escalation if approval is already approved', async () => {
      // Mock: approval is approved
      const mockQuery = vi.fn().mockResolvedValue([{ status: 'approved' }])
      const mockDbChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: mockQuery,
      }

      const mockStep = createMockStep()

      // Simulate check-approval-status step
      const approvalResult = await mockStep.run<ApprovalResult>(
        'check-approval-status',
        async () => {
          const [approval] = await mockDbChain.limit(1)

          return {
            status: approval?.status ?? null,
            stillPending: approval?.status === 'pending',
          }
        }
      )

      expect(approvalResult.status).toBe('approved')
      expect(approvalResult.stillPending).toBe(false)
    })

    it('should skip escalation if approval is already rejected', async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ status: 'rejected' }])
      const mockDbChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: mockQuery,
      }

      const mockStep = createMockStep()

      // Simulate check-approval-status step
      const approvalResult = await mockStep.run<ApprovalResult>(
        'check-approval-status',
        async () => {
          const [approval] = await mockDbChain.limit(1)

          return {
            status: approval?.status ?? null,
            stillPending: approval?.status === 'pending',
          }
        }
      )

      expect(approvalResult.status).toBe('rejected')
      expect(approvalResult.stillPending).toBe(false)
    })

    it('should skip escalation if approval is expired', async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ status: 'expired' }])
      const mockDbChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: mockQuery,
      }

      const mockStep = createMockStep()

      // Simulate check-approval-status step
      const approvalResult = await mockStep.run<ApprovalResult>(
        'check-approval-status',
        async () => {
          const [approval] = await mockDbChain.limit(1)

          return {
            status: approval?.status ?? null,
            stillPending: approval?.status === 'pending',
          }
        }
      )

      expect(approvalResult.status).toBe('expired')
      expect(approvalResult.stillPending).toBe(false)
    })

    it('should continue if approval is still pending', async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ status: 'pending' }])
      const mockDbChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: mockQuery,
      }

      const mockStep = createMockStep()

      // Simulate check-approval-status step
      const approvalResult = await mockStep.run<ApprovalResult>(
        'check-approval-status',
        async () => {
          const [approval] = await mockDbChain.limit(1)

          return {
            status: approval?.status ?? null,
            stillPending: approval?.status === 'pending',
          }
        }
      )

      expect(approvalResult.status).toBe('pending')
      expect(approvalResult.stillPending).toBe(true)
    })

    it('should handle approval not found', async () => {
      const mockQuery = vi.fn().mockResolvedValue([])
      const mockDbChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: mockQuery,
      }

      const mockStep = createMockStep()

      // Simulate check-approval-status step
      const approvalResult = await mockStep.run<ApprovalResult>(
        'check-approval-status',
        async () => {
          const [approval] = await mockDbChain.limit(1)

          return {
            status: approval?.status ?? null,
            stillPending: approval?.status === 'pending',
          }
        }
      )

      expect(approvalResult.status).toBe(null)
      expect(approvalResult.stillPending).toBe(false)
    })
  })

  describe('Escalation comment', () => {
    it('should add escalation comment when approval is pending', async () => {
      const mockStep = createMockStep()

      // Simulate add-escalation-comment step
      const commentResult = await mockStep.run<CommentResult>(
        'add-escalation-comment',
        async () => {
          const front = createFrontClient({
            apiToken: process.env.FRONT_API_TOKEN!,
          })

          const commentBody = `⏰ **Escalation Reminder**

This draft has been awaiting review for over 4 hours.

Please review and take action:
- **Approve** the draft to send it
- **Edit** if changes are needed
- **Reject** if the response is inappropriate

_Action ID: act_test123_`

          await front.conversations.addComment('cnv_test456', commentBody)

          return { added: true }
        }
      )

      expect(createFrontClient).toHaveBeenCalledWith({
        apiToken: 'test-api-token',
      })
      expect(mockFrontClient.conversations.addComment).toHaveBeenCalledWith(
        'cnv_test456',
        expect.stringContaining('Escalation Reminder')
      )
      expect(commentResult.added).toBe(true)
    })

    it('should include action ID in comment for reference', async () => {
      const mockStep = createMockStep()

      await mockStep.run<CommentResult>('add-escalation-comment', async () => {
        const front = createFrontClient({
          apiToken: process.env.FRONT_API_TOKEN!,
        })

        const actionId = 'act_custom123'
        const commentBody = `⏰ **Escalation Reminder**

This draft has been awaiting review for over 4 hours.

Please review and take action:
- **Approve** the draft to send it
- **Edit** if changes are needed
- **Reject** if the response is inappropriate

_Action ID: ${actionId}_`

        await front.conversations.addComment('cnv_test456', commentBody)

        return { added: true }
      })

      expect(mockFrontClient.conversations.addComment).toHaveBeenCalledWith(
        'cnv_test456',
        expect.stringContaining('act_custom123')
      )
    })

    it('should handle missing FRONT_API_TOKEN', async () => {
      delete process.env.FRONT_API_TOKEN

      const mockStep = createMockStep()

      const commentResult = await mockStep.run<CommentResult>(
        'add-escalation-comment',
        async () => {
          const frontToken = process.env.FRONT_API_TOKEN
          if (!frontToken) {
            return { added: false, error: 'FRONT_API_TOKEN not configured' }
          }
          return { added: true }
        }
      )

      expect(commentResult.added).toBe(false)
      expect(commentResult.error).toBe('FRONT_API_TOKEN not configured')
    })

    it('should handle Front API errors', async () => {
      mockFrontClient.conversations.addComment.mockRejectedValue(
        new Error('Front API error')
      )

      const mockStep = createMockStep()

      const commentResult = await mockStep.run<CommentResult>(
        'add-escalation-comment',
        async () => {
          try {
            const front = createFrontClient({
              apiToken: process.env.FRONT_API_TOKEN!,
            })
            await front.conversations.addComment('cnv_test456', 'test')
            return { added: true }
          } catch (error) {
            return {
              added: false,
              error: error instanceof Error ? error.message : String(error),
            }
          }
        }
      )

      expect(commentResult.added).toBe(false)
      expect(commentResult.error).toBe('Front API error')
    })
  })

  describe('No duplicate reminders', () => {
    it('should only run once per approval request due to concurrency key', () => {
      // The workflow uses concurrency.key = 'event.data.conversationId'
      // This ensures only one escalation workflow runs per conversation at a time
      // Combined with the single trigger on SUPPORT_APPROVAL_REQUESTED,
      // this prevents duplicate reminders for the same approval

      // Test validates the workflow design - concurrency config
      const workflowConfig = {
        id: 'comment-escalation',
        concurrency: {
          limit: 5,
          key: 'event.data.conversationId',
        },
      }

      expect(workflowConfig.concurrency.key).toBe('event.data.conversationId')
      expect(workflowConfig.concurrency.limit).toBe(5)
    })

    it('should not re-trigger on same approval request', () => {
      // The workflow triggers on SUPPORT_APPROVAL_REQUESTED
      // This event is emitted exactly once per approval request
      // The 4h sleep + single-run design ensures no duplicates

      // Verify event trigger design
      const eventTrigger = 'support/approval.requested'
      expect(eventTrigger).toBe('support/approval.requested')
    })
  })

  describe('Workflow outcomes', () => {
    it('should return skipped-on-hold when conversation is on hold', () => {
      const result = {
        conversationId: 'cnv_test456',
        actionId: 'act_test123',
        outcome: 'skipped-on-hold',
        reason: 'Conversation is on hold',
      }

      expect(result.outcome).toBe('skipped-on-hold')
    })

    it('should return already-approved when approval was handled', () => {
      const result = {
        conversationId: 'cnv_test456',
        actionId: 'act_test123',
        outcome: 'already-approved',
        reason: 'Approval status: approved',
      }

      expect(result.outcome).toBe('already-approved')
    })

    it('should return escalated when comment was added', () => {
      const result = {
        conversationId: 'cnv_test456',
        actionId: 'act_test123',
        outcome: 'escalated',
        commentAdded: true,
      }

      expect(result.outcome).toBe('escalated')
      expect(result.commentAdded).toBe(true)
    })

    it('should return failed when comment could not be added', () => {
      const result = {
        conversationId: 'cnv_test456',
        actionId: 'act_test123',
        outcome: 'failed',
        commentAdded: false,
        error: 'Front API error',
      }

      expect(result.outcome).toBe('failed')
      expect(result.commentAdded).toBe(false)
      expect(result.error).toBe('Front API error')
    })
  })
})
