// Set environment variables BEFORE any imports
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
	eq: vi.fn((field, value) => ({ field, value })),
}))

import { executeApprovedAction } from '../inngest/workflows/execute-approved-action'
import { SUPPORT_ACTION_APPROVED } from '../inngest/events'

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

			// Reset mock implementations
			mockDb.select.mockReturnThis()
			mockDb.from.mockReturnThis()
			mockDb.where.mockReturnThis()
			mockDb.update.mockReturnThis()
			mockDb.set.mockReturnThis()

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
			await executeApprovedAction.fn({ event, step: mockStep } as any)

			// Verify lookup-action step was called
			expect(mockStep.run).toHaveBeenCalledWith('lookup-action', expect.any(Function))

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
				executeApprovedAction.fn({ event, step: mockStep } as any)
			).rejects.toThrow(`Action ${actionId} not found`)
		})

		it('should execute tool with action parameters (stub)', async () => {
			const actionId = 'action-123'
			const mockAction = {
				id: actionId,
				type: 'pending-action',
				parameters: {
					toolCalls: [
						{ name: 'processRefund', args: { purchaseId: 'order-456', appId: 'app-tt', reason: 'Customer request' } },
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

			const result = await executeApprovedAction.fn({ event, step: mockStep } as any)

			// Verify execute-tool step was called
			expect(mockStep.run).toHaveBeenCalledWith('execute-tool', expect.any(Function))

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

			await executeApprovedAction.fn({ event, step: mockStep } as any)

			// Verify update-action-status step was called
			expect(mockStep.run).toHaveBeenCalledWith('update-action-status', expect.any(Function))

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

			await executeApprovedAction.fn({ event, step: mockStep } as any)

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
						{ name: 'processRefund', args: { purchaseId: 'order-456', appId: 'app-tt', reason: 'Test' } },
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

			const result = await executeApprovedAction.fn({ event, step: mockStep } as any)

			expect(result).toMatchObject({
				actionId,
				executed: true,
				approvedBy,
			})
		})
	})
})
