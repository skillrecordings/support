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
import { getPaymentHistory } from './stripe-payment-history'

/**
 * Tests for getPaymentHistory tool.
 *
 * This tool queries Stripe Connect for payment/charge history.
 * It does NOT execute financial actions - query only.
 */
describe('getPaymentHistory', () => {
  const mockContext: ExecutionContext = {
    user: {
      id: 'user-123',
      email: '[EMAIL]',
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

  let mockChargesList: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockChargesList = vi.fn()
    ;(StripeSDK as any).mockImplementation(() => ({
      charges: {
        list: mockChargesList,
      },
    }))
  })

  describe('fetching payment history', () => {
    it('should fetch charge history for customer email', async () => {
      const mockCharges: Stripe.Charge[] = [
        {
          id: 'ch_123',
          amount: 9900,
          currency: 'usd',
          status: 'succeeded',
          refunded: false,
          amount_refunded: 0,
          created: 1704067200, // 2024-01-01
          description: 'Total TypeScript - Full Course',
        } as Stripe.Charge,
        {
          id: 'ch_456',
          amount: 29900,
          currency: 'usd',
          status: 'succeeded',
          refunded: true,
          amount_refunded: 29900,
          created: 1704067200, // 2023-12-01
          description: 'Total TypeScript - Pro Bundle',
        } as Stripe.Charge,
      ]

      mockChargesList.mockResolvedValue({
        data: mockCharges,
        has_more: false,
      })

      const result = await getPaymentHistory.execute(
        {
          customerEmail: '[EMAIL]',
          limit: 10,
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.charges).toHaveLength(2)
        expect(result.data.charges[0]).toEqual({
          id: 'ch_123',
          amount: 9900,
          currency: 'usd',
          status: 'succeeded',
          refunded: false,
          created: 1704067200,
          description: 'Total TypeScript - Full Course',
        })
      }

      // Verify Stripe API called with correct params
      expect(mockChargesList).toHaveBeenCalledWith(
        { customer: '[EMAIL]', limit: 10 },
        { stripeAccount: 'acct_1LFP5yAozSgJZBRP' }
      )
    })

    it('should use default limit if not provided', async () => {
      mockChargesList.mockResolvedValue({
        data: [],
        has_more: false,
      })

      await getPaymentHistory.execute(
        {
          customerEmail: '[EMAIL]',
        },
        mockContext
      )

      expect(mockChargesList).toHaveBeenCalledWith(
        { customer: '[EMAIL]', limit: 25 },
        { stripeAccount: 'acct_1LFP5yAozSgJZBRP' }
      )
    })

    it('should return empty array when no charges found', async () => {
      mockChargesList.mockResolvedValue({
        data: [],
        has_more: false,
      })

      const result = await getPaymentHistory.execute(
        {
          customerEmail: '[EMAIL]',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.charges).toEqual([])
      }
    })

    it('should handle customer not found on connected account', async () => {
      mockChargesList.mockRejectedValue(
        Object.assign(new Error('No such customer'), {
          type: 'StripeInvalidRequestError',
          code: 'resource_missing',
        })
      )

      const result = await getPaymentHistory.execute(
        {
          customerEmail: '[EMAIL]',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('No such customer')
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

      const result = await getPaymentHistory.execute(
        {
          customerEmail: '[EMAIL]',
        },
        contextWithoutStripe
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('Stripe account not connected')
      }

      // Should not call Stripe API
      expect(mockChargesList).not.toHaveBeenCalled()
    })

    it('should handle Stripe API errors gracefully', async () => {
      mockChargesList.mockRejectedValue(new Error('API connection failed'))

      const result = await getPaymentHistory.execute(
        {
          customerEmail: '[EMAIL]',
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
    it('should reject invalid email format', async () => {
      const result = await getPaymentHistory.execute(
        {
          customerEmail: 'not-an-email',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should reject negative limit', async () => {
      const result = await getPaymentHistory.execute(
        {
          customerEmail: '[EMAIL]',
          limit: -5,
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should reject limit over 100', async () => {
      const result = await getPaymentHistory.execute(
        {
          customerEmail: '[EMAIL]',
          limit: 150,
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })
  })

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(getPaymentHistory.name).toBe('get_payment_history')
    })

    it('should have description mentioning query', () => {
      expect(getPaymentHistory.description).toContain('payment')
      expect(getPaymentHistory.description).toContain('history')
      expect(getPaymentHistory.description.toLowerCase()).toContain('query')
    })

    it('should not require approval (read-only)', () => {
      expect(getPaymentHistory.requiresApproval).toBeUndefined()
    })
  })
})
