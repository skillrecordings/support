import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExecutionContext } from './types'

// Mock dependencies BEFORE imports
vi.mock('@skillrecordings/core/services/app-registry', () => ({
	getApp: vi.fn(),
}))

vi.mock('@skillrecordings/sdk/client', () => ({
	IntegrationClient: vi.fn(),
}))

import { processRefund } from './process-refund'
import { getApp } from '@skillrecordings/core/services/app-registry'
import { IntegrationClient } from '@skillrecordings/sdk/client'

describe('processRefund', () => {
	const mockContext: ExecutionContext = {
		user: {
			id: 'user-123',
			email: '[EMAIL]',
			name: 'Test Customer',
		},
		purchases: [
			{
				id: 'pur_123',
				userId: 'user-123',
				productId: 'prod_typescript',
				status: 'valid',
				purchasedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
				stripeChargeId: 'ch_stripe_123',
			},
		],
		appConfig: {
			id: 'total-typescript',
			name: 'Total TypeScript',
		},
		traceId: 'trace-123',
		conversationId: 'conv-123',
		approvalId: 'approval-456',
		db: {} as any,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset specific mocks to default behavior
		;(getApp as any).mockReset()
		;(IntegrationClient as any).mockReset()
	})

	describe('revokeAccess integration', () => {
		it('should call revokeAccess on IntegrationClient after successful refund', async () => {
			// Setup mocks
			const mockRevokeAccess = vi.fn().mockResolvedValue({
				success: true,
				message: 'Access revoked successfully',
			})

			const mockClient = {
				revokeAccess: mockRevokeAccess,
			}

			;(IntegrationClient as any).mockImplementation(() => mockClient as any)
			;(getApp as any).mockResolvedValue({
				id: 'total-typescript',
				slug: 'total-typescript',
				name: 'Total TypeScript',
				integration_base_url: 'https://totaltypescript.com',
				webhook_secret: 'whsec_test_123',
				capabilities: ['refund'],
			} as any)

			// Execute
			const result = await processRefund.execute(
				{
					purchaseId: 'pur_123',
					appId: 'total-typescript',
					reason: 'Customer request',
				},
				mockContext,
			)

			// Assertions
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.refundId).toContain('re_stub_')
				expect(result.data.amountRefunded).toBe(9900)
			}

			// Verify getApp was called with correct slug
			expect(getApp).toHaveBeenCalledWith('total-typescript')

			// Verify IntegrationClient was instantiated with correct config
			expect(IntegrationClient).toHaveBeenCalledWith({
				baseUrl: 'https://totaltypescript.com',
				webhookSecret: 'whsec_test_123',
			})

			// Verify revokeAccess was called with correct params
			expect(mockRevokeAccess).toHaveBeenCalledWith({
				purchaseId: 'pur_123',
				reason: 'Customer request',
				refundId: expect.stringContaining('re_'),
			})
		})

		it('should return error if app not found', async () => {
			;(getApp as any).mockResolvedValueOnce(null)

			const result = await processRefund.execute(
				{
					purchaseId: 'pur_123',
					appId: 'nonexistent-app',
					reason: 'Customer request',
				},
				mockContext,
			)

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.code).toBe('EXECUTION_ERROR')
				expect(result.error.message).toContain('App not found')
			}
		})

		it('should handle revokeAccess errors gracefully', async () => {
			const mockRevokeAccess = vi
				.fn()
				.mockRejectedValue(new Error('Network error'))

			const mockClient = {
				revokeAccess: mockRevokeAccess,
			}

			;(IntegrationClient as any).mockImplementationOnce(() => mockClient as any)
			;(getApp as any).mockResolvedValueOnce({
				id: 'total-typescript',
				slug: 'total-typescript',
				name: 'Total TypeScript',
				integration_base_url: 'https://totaltypescript.com',
				webhook_secret: 'whsec_test_123',
				capabilities: ['refund'],
			} as any)

			const result = await processRefund.execute(
				{
					purchaseId: 'pur_123',
					appId: 'total-typescript',
					reason: 'Customer request',
				},
				mockContext,
			)

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.code).toBe('EXECUTION_ERROR')
				expect(result.error.message).toContain('Network error')
			}
		})
	})

	describe('approval gate', () => {
		it('should auto-approve refunds within 30 days', () => {
			const params = {
				purchaseId: 'pur_123',
				appId: 'total-typescript',
				reason: 'Customer request',
			}

			const contextWithRecentPurchase = {
				...mockContext,
				purchases: [
					{
						id: 'pur_123',
						userId: 'user-123',
						productId: 'prod_typescript',
						status: 'valid' as const,
						purchasedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
					},
				],
			}

			const requiresApproval = processRefund.requiresApproval?.(
				params,
				contextWithRecentPurchase,
			)

			expect(requiresApproval).toBe(false)
		})

		it('should require approval for refunds older than 30 days', () => {
			const params = {
				purchaseId: 'pur_123',
				appId: 'total-typescript',
				reason: 'Customer request',
			}

			const contextWithOldPurchase = {
				...mockContext,
				purchases: [
					{
						id: 'pur_123',
						userId: 'user-123',
						productId: 'prod_typescript',
						status: 'valid' as const,
						purchasedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
					},
				],
			}

			const requiresApproval = processRefund.requiresApproval?.(
				params,
				contextWithOldPurchase,
			)

			expect(requiresApproval).toBe(true)
		})
	})
})
