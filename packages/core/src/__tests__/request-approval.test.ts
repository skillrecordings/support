// Set environment variables BEFORE any imports
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.SLACK_APPROVAL_CHANNEL = 'C123456789'

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the database module
const mockDb = {
	select: vi.fn().mockReturnThis(),
	from: vi.fn().mockReturnThis(),
	where: vi.fn().mockReturnThis(),
	update: vi.fn().mockReturnThis(),
	set: vi.fn().mockReturnThis(),
	insert: vi.fn().mockReturnThis(),
	values: vi.fn().mockReturnThis(),
}

vi.mock('@skillrecordings/database', () => ({
	getDb: vi.fn(() => mockDb),
	ApprovalRequestsTable: {},
	ActionsTable: {},
	eq: vi.fn((field, value) => ({ field, value })),
}))

// Mock Slack client
vi.mock('@skillrecordings/core/slack/client', () => ({
	postApprovalMessage: vi
		.fn()
		.mockResolvedValue({ ts: '1234567890.123456', channel: 'C123456789' }),
}))

// Mock approval blocks builder
vi.mock('@skillrecordings/core/slack/approval-blocks', () => ({
	buildApprovalBlocks: vi.fn((input) => [
		{ type: 'header', text: { type: 'plain_text', text: 'Test Header' } },
		{ type: 'section', text: { type: 'mrkdwn', text: input.agentReasoning } },
	]),
}))

import { requestApproval } from '../inngest/workflows/request-approval'
import { SUPPORT_APPROVAL_REQUESTED } from '../inngest/events'
import { postApprovalMessage } from '@skillrecordings/core/slack/client'
import { buildApprovalBlocks } from '@skillrecordings/core/slack/approval-blocks'

describe('requestApproval workflow', () => {
	it('exports a function', () => {
		expect(requestApproval).toBeDefined()
		expect(typeof requestApproval).toBe('object')
	})

	it('has correct id', () => {
		expect(requestApproval.id()).toBe('request-approval')
	})

	it('has correct name', () => {
		expect(requestApproval.name).toBe('Request Human Approval')
	})

	describe('workflow execution', () => {
		let mockStep: any
		let stepRunHandlers: Map<string, Function>

		beforeEach(() => {
			stepRunHandlers = new Map()

			// Clear all mocks
			vi.clearAllMocks()

			// Reset mock implementations
			mockDb.select.mockReturnThis()
			mockDb.from.mockReturnThis()
			mockDb.where.mockReturnThis()
			mockDb.update.mockReturnThis()
			mockDb.set.mockReturnThis()
			mockDb.insert.mockReturnThis()
			mockDb.values.mockReturnThis()

			// Mock Inngest step with captured handlers
			mockStep = {
				run: vi.fn((stepName: string, handler: Function) => {
					stepRunHandlers.set(stepName, handler)
					return handler()
				}),
				waitForEvent: vi.fn(),
			}
		})

		it('should create approval request in database', async () => {
			const actionId = 'action-123'
			const conversationId = 'conv-456'
			const appId = 'app-tt'
			const agentReasoning = 'Customer requested refund within policy window'

			// Mock DB insert
			mockDb.values.mockResolvedValueOnce(undefined)

			// Mock waitForEvent to return approval decision
			mockStep.waitForEvent.mockResolvedValueOnce({
				name: 'support/approval.decided',
				data: {
					approvalId: actionId,
					decision: 'approved',
					decidedBy: 'admin@example.com',
					decidedAt: new Date().toISOString(),
				},
			})

			const event = {
				name: SUPPORT_APPROVAL_REQUESTED,
				data: {
					actionId,
					conversationId,
					appId,
					action: {
						type: 'refund_order',
						parameters: { orderId: 'order-789', amount: 100 },
					},
					agentReasoning,
				},
			}

			await requestApproval.fn({ event, step: mockStep } as any)

			// Verify create-approval-request step was called
			expect(mockStep.run).toHaveBeenCalledWith(
				'create-approval-request',
				expect.any(Function)
			)

			// Verify DB insert
			expect(mockDb.insert).toHaveBeenCalled()
			expect(mockDb.values).toHaveBeenCalled()
		})

		it('should send Slack notification with approval blocks', async () => {
			const actionId = 'action-123'
			const conversationId = 'conv-456'
			const appId = 'app-tt'
			const agentReasoning = 'Customer requested refund within policy window'
			const action = {
				type: 'refund_order',
				parameters: { orderId: 'order-789', amount: 100 },
			}

			mockDb.values.mockResolvedValueOnce(undefined)
			mockDb.where.mockResolvedValueOnce(undefined)

			mockStep.waitForEvent.mockResolvedValueOnce({
				name: 'support/approval.decided',
				data: {
					approvalId: actionId,
					decision: 'approved',
					decidedBy: 'admin@example.com',
					decidedAt: new Date().toISOString(),
				},
			})

			const event = {
				name: SUPPORT_APPROVAL_REQUESTED,
				data: {
					actionId,
					conversationId,
					appId,
					action,
					agentReasoning,
				},
			}

			await requestApproval.fn({ event, step: mockStep } as any)

			// Verify send-slack-notification step was called
			expect(mockStep.run).toHaveBeenCalledWith(
				'send-slack-notification',
				expect.any(Function)
			)

			// Verify buildApprovalBlocks was called with correct input
			expect(buildApprovalBlocks).toHaveBeenCalledWith({
				actionId,
				conversationId,
				appId,
				actionType: action.type,
				parameters: action.parameters,
				agentReasoning,
			})

			// Verify postApprovalMessage was called
			expect(postApprovalMessage).toHaveBeenCalledWith(
				'C123456789',
				expect.any(Array),
				expect.stringContaining('Refund Order')
			)
		})

		it('should update approval request with Slack message timestamp', async () => {
			const actionId = 'action-123'

			mockDb.values.mockResolvedValueOnce(undefined)
			mockDb.where.mockResolvedValueOnce(undefined)

			mockStep.waitForEvent.mockResolvedValueOnce({
				name: 'support/approval.decided',
				data: {
					approvalId: actionId,
					decision: 'approved',
					decidedBy: 'admin@example.com',
					decidedAt: new Date().toISOString(),
				},
			})

			const event = {
				name: SUPPORT_APPROVAL_REQUESTED,
				data: {
					actionId,
					conversationId: 'conv-456',
					appId: 'app-tt',
					action: {
						type: 'refund_order',
						parameters: { orderId: 'order-789' },
					},
					agentReasoning: 'Test reasoning',
				},
			}

			await requestApproval.fn({ event, step: mockStep } as any)

			// Verify DB update with Slack message ts
			expect(mockDb.update).toHaveBeenCalled()
			expect(mockDb.set).toHaveBeenCalled()
		})

		it('should wait for approval decision event', async () => {
			const actionId = 'action-123'

			mockDb.values.mockResolvedValueOnce(undefined)
			mockDb.where.mockResolvedValueOnce(undefined)

			mockStep.waitForEvent.mockResolvedValueOnce({
				name: 'support/approval.decided',
				data: {
					approvalId: actionId,
					decision: 'approved',
					decidedBy: 'admin@example.com',
					decidedAt: new Date().toISOString(),
				},
			})

			const event = {
				name: SUPPORT_APPROVAL_REQUESTED,
				data: {
					actionId,
					conversationId: 'conv-456',
					appId: 'app-tt',
					action: {
						type: 'refund_order',
						parameters: { orderId: 'order-789' },
					},
					agentReasoning: 'Test reasoning',
				},
			}

			await requestApproval.fn({ event, step: mockStep } as any)

			// Verify waitForEvent was called with correct config
			expect(mockStep.waitForEvent).toHaveBeenCalledWith(
				'wait-for-approval-decision',
				{
					event: 'support/approval.decided',
					timeout: '24h',
					match: 'data.approvalId',
				}
			)
		})

		it('should handle timeout by marking approval as expired', async () => {
			const actionId = 'action-123'

			mockDb.values.mockResolvedValueOnce(undefined)
			mockDb.where.mockResolvedValueOnce(undefined)
			mockDb.where.mockResolvedValueOnce(undefined) // handle-timeout update

			// Mock waitForEvent to return null (timeout)
			mockStep.waitForEvent.mockResolvedValueOnce(null)

			const event = {
				name: SUPPORT_APPROVAL_REQUESTED,
				data: {
					actionId,
					conversationId: 'conv-456',
					appId: 'app-tt',
					action: {
						type: 'refund_order',
						parameters: { orderId: 'order-789' },
					},
					agentReasoning: 'Test reasoning',
				},
			}

			const result = await requestApproval.fn({ event, step: mockStep } as any)

			// Verify handle-timeout step was called
			expect(mockStep.run).toHaveBeenCalledWith('handle-timeout', expect.any(Function))

			// Verify DB update for expired status
			expect(mockDb.update).toHaveBeenCalled()

			// Verify result indicates timeout
			expect(result).toMatchObject({
				result: 'timeout',
				actionId,
			})
		})

		it('should update approval status on approved decision', async () => {
			const actionId = 'action-123'
			const decidedBy = 'admin@example.com'
			const decidedAt = new Date().toISOString()

			mockDb.values.mockResolvedValueOnce(undefined)
			mockDb.where.mockResolvedValueOnce(undefined) // send-slack-notification
			mockDb.where.mockResolvedValueOnce(undefined) // update-approval-status

			mockStep.waitForEvent.mockResolvedValueOnce({
				name: 'support/approval.decided',
				data: {
					approvalId: actionId,
					decision: 'approved',
					decidedBy,
					decidedAt,
				},
			})

			const event = {
				name: SUPPORT_APPROVAL_REQUESTED,
				data: {
					actionId,
					conversationId: 'conv-456',
					appId: 'app-tt',
					action: {
						type: 'refund_order',
						parameters: { orderId: 'order-789' },
					},
					agentReasoning: 'Test reasoning',
				},
			}

			await requestApproval.fn({ event, step: mockStep } as any)

			// Verify update-approval-status step was called
			expect(mockStep.run).toHaveBeenCalledWith(
				'update-approval-status',
				expect.any(Function)
			)

			// Verify DB update
			expect(mockDb.update).toHaveBeenCalled()
		})

		it('should update approval status on rejected decision', async () => {
			const actionId = 'action-123'
			const decidedBy = 'admin@example.com'
			const decidedAt = new Date().toISOString()
			const reason = 'Not eligible for refund'

			mockDb.values.mockResolvedValueOnce(undefined)
			mockDb.where.mockResolvedValueOnce(undefined) // send-slack-notification
			mockDb.where.mockResolvedValueOnce(undefined) // update-approval-status

			mockStep.waitForEvent.mockResolvedValueOnce({
				name: 'support/approval.decided',
				data: {
					approvalId: actionId,
					decision: 'rejected',
					decidedBy,
					decidedAt,
					reason,
				},
			})

			const event = {
				name: SUPPORT_APPROVAL_REQUESTED,
				data: {
					actionId,
					conversationId: 'conv-456',
					appId: 'app-tt',
					action: {
						type: 'refund_order',
						parameters: { orderId: 'order-789' },
					},
					agentReasoning: 'Test reasoning',
				},
			}

			const result = await requestApproval.fn({ event, step: mockStep } as any)

			// Verify result indicates rejection
			expect(result).toMatchObject({
				result: 'rejected',
				actionId,
				decision: {
					decision: 'rejected',
					decidedBy,
					decidedAt,
					reason,
				},
			})
		})

		it('should return decision metadata on completion', async () => {
			const actionId = 'action-123'
			const decidedBy = 'admin@example.com'
			const decidedAt = new Date().toISOString()

			mockDb.values.mockResolvedValueOnce(undefined)
			mockDb.where.mockResolvedValueOnce(undefined)
			mockDb.where.mockResolvedValueOnce(undefined)

			const decisionData = {
				approvalId: actionId,
				decision: 'approved',
				decidedBy,
				decidedAt,
			}

			mockStep.waitForEvent.mockResolvedValueOnce({
				name: 'support/approval.decided',
				data: decisionData,
			})

			const event = {
				name: SUPPORT_APPROVAL_REQUESTED,
				data: {
					actionId,
					conversationId: 'conv-456',
					appId: 'app-tt',
					action: {
						type: 'refund_order',
						parameters: { orderId: 'order-789' },
					},
					agentReasoning: 'Test reasoning',
				},
			}

			const result = await requestApproval.fn({ event, step: mockStep } as any)

			expect(result).toMatchObject({
				result: 'approved',
				actionId,
				decision: decisionData,
			})
		})
	})
})
