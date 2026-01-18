import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from './types'

// Mock Stripe BEFORE imports
vi.mock('stripe', () => {
  const mockStripe = vi.fn()
  return {
    default: mockStripe,
  }
})

import StripeSDK from 'stripe'
import { verifyRefund } from './stripe-verify-refund'

/**
 * Tests for verifyRefund tool.
 *
 * This tool queries Stripe Connect to verify refund status.
 * It does NOT execute financial actions - query only.
 */
describe('verifyRefund', () => {
  const mockContext: ExecutionContext = {
    user: {
      id: 'user-123',
      email: 'customer@example.com',
      name: 'Test Customer',
    },
    purchases: [],
    appConfig: {
      id: 'total-typescript',
      name: 'Total TypeScript',
      stripeAccountId: 'acct_1LFP5yAozSgJZBRP',
    },
    traceId: 'trace-123',
    conversationId: 'conv-123',
    db: {} as any,
  }

  let mockRefundsRetrieve: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockRefundsRetrieve = vi.fn()
    ;(StripeSDK as any).mockImplementation(() => ({
      refunds: {
        retrieve: mockRefundsRetrieve,
      },
    }))
  })

  describe('fetching refund details', () => {
    it('should fetch refund details by ID', async () => {
      const mockRefund: Stripe.Refund = {
        id: 're_1ABC123',
        object: 'refund',
        amount: 9900,
        balance_transaction: null,
        charge: 'ch_123',
        created: 1704067200, // 2024-01-01
        currency: 'usd',
        status: 'succeeded',
        reason: 'requested_by_customer',
        metadata: {},
        payment_intent: null,
        receipt_number: null,
        source_transfer_reversal: null,
        transfer_reversal: null,
      }

      mockRefundsRetrieve.mockResolvedValue(mockRefund)

      const result = await verifyRefund.execute(
        {
          refundId: 're_1ABC123',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({
          id: 're_1ABC123',
          status: 'succeeded',
          amount: 9900,
          chargeId: 'ch_123',
          reason: 'requested_by_customer',
          created: 1704067200,
        })
      }

      // Verify Stripe API called with correct params
      expect(mockRefundsRetrieve).toHaveBeenCalledWith('re_1ABC123', {
        stripeAccount: 'acct_1LFP5yAozSgJZBRP',
      })
    })

    it('should handle pending refunds', async () => {
      const mockRefund: Stripe.Refund = {
        id: 're_pending',
        object: 'refund',
        amount: 29900,
        balance_transaction: null,
        charge: 'ch_456',
        created: 1704153600,
        currency: 'usd',
        status: 'pending',
        reason: null,
        metadata: {},
        payment_intent: null,
        receipt_number: null,
        source_transfer_reversal: null,
        transfer_reversal: null,
      }

      mockRefundsRetrieve.mockResolvedValue(mockRefund)

      const result = await verifyRefund.execute(
        {
          refundId: 're_pending',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('pending')
        expect(result.data.reason).toBeNull()
      }
    })

    it('should handle failed refunds', async () => {
      const mockRefund: Stripe.Refund = {
        id: 're_failed',
        object: 'refund',
        amount: 5000,
        balance_transaction: null,
        charge: 'ch_789',
        created: 1704240000,
        currency: 'usd',
        status: 'failed',
        reason: 'duplicate',
        metadata: {},
        payment_intent: null,
        receipt_number: null,
        source_transfer_reversal: null,
        transfer_reversal: null,
      }

      mockRefundsRetrieve.mockResolvedValue(mockRefund)

      const result = await verifyRefund.execute(
        {
          refundId: 're_failed',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('failed')
        expect(result.data.reason).toBe('duplicate')
      }
    })

    it('should handle refund not found on connected account', async () => {
      mockRefundsRetrieve.mockRejectedValue(
        Object.assign(new Error('No such refund'), {
          type: 'StripeInvalidRequestError',
          code: 'resource_missing',
        })
      )

      const result = await verifyRefund.execute(
        {
          refundId: 're_nonexistent',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('No such refund')
      }
    })

    it('should return error if stripe account not configured', async () => {
      const contextWithoutStripe = {
        ...mockContext,
        appConfig: {
          id: 'total-typescript',
          name: 'Total TypeScript',
        },
      }

      const result = await verifyRefund.execute(
        {
          refundId: 're_1ABC123',
        },
        contextWithoutStripe
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('Stripe account not connected')
      }

      // Should not call Stripe API
      expect(mockRefundsRetrieve).not.toHaveBeenCalled()
    })

    it('should handle Stripe API errors gracefully', async () => {
      mockRefundsRetrieve.mockRejectedValue(new Error('API connection failed'))

      const result = await verifyRefund.execute(
        {
          refundId: 're_1ABC123',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('API connection failed')
      }
    })
  })

  describe('parameter validation', () => {
    it('should reject empty refund ID', async () => {
      const result = await verifyRefund.execute(
        {
          refundId: '',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should accept valid refund ID format', async () => {
      mockRefundsRetrieve.mockResolvedValue({
        id: 're_1ABC123',
        object: 'refund',
        amount: 1000,
        charge: 'ch_123',
        created: 1704067200,
        currency: 'usd',
        status: 'succeeded',
        reason: null,
        metadata: {},
        payment_intent: null,
        receipt_number: null,
        source_transfer_reversal: null,
        transfer_reversal: null,
      })

      const result = await verifyRefund.execute(
        {
          refundId: 're_1ABC123',
        },
        mockContext
      )

      expect(result.success).toBe(true)
    })
  })

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(verifyRefund.name).toBe('verify_refund')
    })

    it('should have description mentioning verify and refund', () => {
      expect(verifyRefund.description).toContain('refund')
      expect(verifyRefund.description.toLowerCase()).toContain('verify')
    })

    it('should not require approval (read-only)', () => {
      expect(verifyRefund.requiresApproval).toBeUndefined()
    })
  })
})
