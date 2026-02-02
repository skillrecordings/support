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
import { lookupCharge } from './stripe-lookup-charge'

/**
 * Tests for lookupCharge tool.
 *
 * This tool queries Stripe Connect for a specific charge.
 * It does NOT execute financial actions - query only.
 */
describe('lookupCharge', () => {
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

  let mockChargesRetrieve: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockChargesRetrieve = vi.fn()
    ;(StripeSDK as any).mockImplementation(() => ({
      charges: {
        retrieve: mockChargesRetrieve,
      },
    }))
  })

  describe('fetching charge', () => {
    it('should retrieve charge by ID', async () => {
      const mockCharge: Stripe.Charge = {
        id: 'ch_123',
        amount: 9900,
        currency: 'usd',
        status: 'succeeded',
        refunded: false,
        amount_refunded: 0,
        created: 1704067200, // 2024-01-01
        description: 'Total TypeScript - Full Course',
        customer: 'cus_123',
      } as Stripe.Charge

      mockChargesRetrieve.mockResolvedValue(mockCharge)

      const result = await lookupCharge.execute(
        {
          chargeId: 'ch_123',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({
          id: 'ch_123',
          amount: 9900,
          currency: 'usd',
          status: 'succeeded',
          refunded: false,
          customer: 'cus_123',
          description: 'Total TypeScript - Full Course',
          created: 1704067200,
        })
      }

      // Verify Stripe API called with correct params
      expect(mockChargesRetrieve).toHaveBeenCalledWith('ch_123', {
        stripeAccount: 'acct_1LFP5yAozSgJZBRP',
      })
    })

    it('should handle refunded charges', async () => {
      const mockCharge: Stripe.Charge = {
        id: 'ch_456',
        amount: 29900,
        currency: 'usd',
        status: 'succeeded',
        refunded: true,
        amount_refunded: 29900,
        created: 1704067200, // 2023-12-01
        description: 'Total TypeScript - Pro Bundle',
        customer: 'cus_456',
      } as Stripe.Charge

      mockChargesRetrieve.mockResolvedValue(mockCharge)

      const result = await lookupCharge.execute(
        {
          chargeId: 'ch_456',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.refunded).toBe(true)
      }
    })

    it('should handle charge not found', async () => {
      mockChargesRetrieve.mockRejectedValue(
        Object.assign(new Error('No such charge'), {
          type: 'StripeInvalidRequestError',
          code: 'resource_missing',
        })
      )

      const result = await lookupCharge.execute(
        {
          chargeId: 'ch_nonexistent',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('No such charge')
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

      const result = await lookupCharge.execute(
        {
          chargeId: 'ch_123',
        },
        contextWithoutStripe
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('Stripe account not connected')
      }

      // Should not call Stripe API
      expect(mockChargesRetrieve).not.toHaveBeenCalled()
    })

    it('should handle Stripe API errors gracefully', async () => {
      mockChargesRetrieve.mockRejectedValue(new Error('API connection failed'))

      const result = await lookupCharge.execute(
        {
          chargeId: 'ch_123',
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
    it('should reject empty charge ID', async () => {
      const result = await lookupCharge.execute(
        {
          chargeId: '',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should reject invalid charge ID format', async () => {
      const result = await lookupCharge.execute(
        {
          chargeId: 'invalid-id',
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
      expect(lookupCharge.name).toBe('lookup_charge')
    })

    it('should have description mentioning lookup', () => {
      expect(lookupCharge.description).toContain('charge')
      expect(lookupCharge.description.toLowerCase()).toContain('lookup')
    })

    it('should not require approval (read-only)', () => {
      expect(lookupCharge.requiresApproval).toBeUndefined()
    })
  })
})
