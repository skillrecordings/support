import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExecutionContext } from './types'
import Stripe from 'stripe'

// Mock dependencies BEFORE imports
vi.mock('@skillrecordings/core/services/app-registry', () => ({
	getApp: vi.fn(),
}))

vi.mock('@skillrecordings/sdk/client', () => ({
	IntegrationClient: vi.fn(),
}))

// Mock Stripe
vi.mock('stripe', () => {
	const mockRefundsCreate = vi.fn()
	const mockChargesRetrieve = vi.fn()
	return {
		default: vi.fn().mockImplementation(() => ({
			refunds: {
				create: mockRefundsCreate,
			},
			charges: {
				retrieve: mockChargesRetrieve,
			},
		})),
	}
})

import { processRefund } from './process-refund'
import { getApp } from '@skillrecordings/core/services/app-registry'
import { IntegrationClient } from '@skillrecordings/sdk/client'

describe('processRefund', () => {
	const mockContext: ExecutionContext = {
		user: {
			id: 'user-123',
			email: 'customer@example.com',
			name: 'Test Customer',
		},
		purchases: [
			{
				id: 'pur_123',
				productId: 'prod_typescript',
				status: 'active',
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
				stripe_account_id: 'acct_test123',
				capabilities: ['refund'],
			} as any)

			// Mock Stripe
			const mockStripe = new Stripe('sk_test_123')
			vi.spyOn(mockStripe.refunds, 'create').mockResolvedValue({
				id: 're_test123',
				amount: 9900,
				lastResponse: {
					headers: {},
					requestId: 'req_123',
					statusCode: 200,
				},
			} as any)
			;(Stripe as any).mockImplementation(() => mockStripe)

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
				expect(result.data.refundId).toBe('re_test123')
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
				refundId: 're_test123',
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
				stripe_account_id: 'acct_test123',
				capabilities: ['refund'],
			} as any)

			// Mock Stripe
			const mockStripe = new Stripe('sk_test_123')
			vi.spyOn(mockStripe.refunds, 'create').mockResolvedValue({
				id: 're_test456',
				amount: 9900,
				lastResponse: {
					headers: {},
					requestId: 'req_456',
					statusCode: 200,
				},
			} as any)
			;(Stripe as any).mockImplementation(() => mockStripe)

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
						
						productId: 'prod_typescript',
						status: 'active' as const,
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
						
						productId: 'prod_typescript',
						status: 'active' as const,
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

	describe('Stripe Connect refund', () => {
		it('should throw if app has no stripe_account_id', async () => {
			;(getApp as any).mockResolvedValue({
				id: 'total-typescript',
				slug: 'total-typescript',
				name: 'Total TypeScript',
				integration_base_url: 'https://totaltypescript.com',
				webhook_secret: 'whsec_test_123',
				// no stripe_account_id
			})

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
				expect(result.error.message).toContain('not connected to Stripe')
			}
		})

		it('should throw if purchase not found', async () => {
			;(getApp as any).mockResolvedValue({
				id: 'total-typescript',
				stripe_account_id: 'acct_test123',
				integration_base_url: 'https://totaltypescript.com',
				webhook_secret: 'whsec_test_123',
			})

			const result = await processRefund.execute(
				{
					purchaseId: 'pur_missing',
					appId: 'total-typescript',
					reason: 'Customer request',
				},
				mockContext,
			)

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.message).toContain('Purchase not found')
			}
		})

		it('should throw if purchase has no stripeChargeId', async () => {
			;(getApp as any).mockResolvedValue({
				id: 'total-typescript',
				stripe_account_id: 'acct_test123',
				integration_base_url: 'https://totaltypescript.com',
				webhook_secret: 'whsec_test_123',
			})

			const contextWithoutCharge = {
				...mockContext,
				purchases: [
					{
						id: 'pur_123',
						
						productId: 'prod_typescript',
						status: 'active' as const,
						purchasedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
						// no stripeChargeId
					},
				],
			}

			const result = await processRefund.execute(
				{
					purchaseId: 'pur_123',
					appId: 'total-typescript',
					reason: 'Customer request',
				},
				contextWithoutCharge,
			)

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.message).toContain('no Stripe charge ID')
			}
		})

		it('should generate deterministic idempotency key', async () => {
			const mockRevokeAccess = vi.fn().mockResolvedValue({
				success: true,
			})

			;(IntegrationClient as any).mockImplementation(
				() =>
					({
						revokeAccess: mockRevokeAccess,
					}) as any,
			)

			;(getApp as any).mockResolvedValue({
				id: 'total-typescript',
				stripe_account_id: 'acct_test123',
				integration_base_url: 'https://totaltypescript.com',
				webhook_secret: 'whsec_test_123',
			})

			// Mock Stripe instance
			const mockStripe = new Stripe('sk_test_123')
			const mockRefundsCreate = vi
				.spyOn(mockStripe.refunds, 'create')
				.mockResolvedValue({
					id: 're_test123',
					amount: 9900,
					lastResponse: {
						headers: {},
						requestId: 'req_789',
						statusCode: 200,
					},
				} as any)

			;(Stripe as any).mockImplementation(() => mockStripe)

			await processRefund.execute(
				{
					purchaseId: 'pur_123',
					appId: 'total-typescript',
					reason: 'Customer request',
				},
				mockContext,
			)

			// Verify idempotency key
			expect(mockRefundsCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					charge: 'ch_stripe_123',
					reason: 'requested_by_customer',
				}),
				expect.objectContaining({
					stripeAccount: 'acct_test123',
					idempotencyKey: 'refund:pur_123:approval-456',
				}),
			)
		})

		it('should treat charge_already_refunded as idempotent success', async () => {
			const mockRevokeAccess = vi.fn().mockResolvedValue({
				success: true,
			})

			;(IntegrationClient as any).mockImplementation(
				() =>
					({
						revokeAccess: mockRevokeAccess,
					}) as any,
			)

			;(getApp as any).mockResolvedValue({
				id: 'total-typescript',
				stripe_account_id: 'acct_test123',
				integration_base_url: 'https://totaltypescript.com',
				webhook_secret: 'whsec_test_123',
			})

			// Mock Stripe to throw charge_already_refunded, then retrieve charge
			const mockStripe = new Stripe('sk_test_123')
			const error = Object.assign(
				new Error('Charge ch_stripe_123 has already been refunded.'),
				{
					type: 'StripeInvalidRequestError',
					code: 'charge_already_refunded',
				},
			)

			const mockRefundsCreate = vi
				.spyOn(mockStripe.refunds, 'create')
				.mockRejectedValue(error)

			const mockChargesRetrieve = mockStripe.charges.retrieve as any
			mockChargesRetrieve.mockResolvedValue({
				id: 'ch_stripe_123',
				amount_refunded: 9900,
			} as Stripe.Charge)

			;(Stripe as any).mockImplementation(() => mockStripe)

			const result = await processRefund.execute(
				{
					purchaseId: 'pur_123',
					appId: 'total-typescript',
					reason: 'Customer request',
				},
				mockContext,
			)

			// Should succeed (idempotent)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.refundId).toContain('re_already_')
			}
		})

		it('should throw on Stripe permission error', async () => {
			;(getApp as any).mockResolvedValue({
				id: 'total-typescript',
				stripe_account_id: 'acct_test123',
				integration_base_url: 'https://totaltypescript.com',
				webhook_secret: 'whsec_test_123',
			})

			// Mock Stripe permission error
			const mockStripe = new Stripe('sk_test_123')
			const error = Object.assign(new Error('Not authorized'), {
				type: 'StripePermissionError',
			})

			vi.spyOn(mockStripe.refunds, 'create').mockRejectedValue(error)
			;(Stripe as any).mockImplementation(() => mockStripe)

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
				expect(result.error.message).toContain('Not authorized to refund')
			}
		})

		it('should throw on other Stripe errors', async () => {
			;(getApp as any).mockResolvedValue({
				id: 'total-typescript',
				stripe_account_id: 'acct_test123',
				integration_base_url: 'https://totaltypescript.com',
				webhook_secret: 'whsec_test_123',
			})

			// Mock other Stripe error
			const mockStripe = new Stripe('sk_test_123')
			const error = Object.assign(new Error('Charge has been disputed'), {
				type: 'StripeInvalidRequestError',
				code: 'charge_disputed',
			})

			vi.spyOn(mockStripe.refunds, 'create').mockRejectedValue(error)
			;(Stripe as any).mockImplementation(() => mockStripe)

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
				expect(result.error.message).toContain('Stripe refund failed')
			}
		})
	})
})
