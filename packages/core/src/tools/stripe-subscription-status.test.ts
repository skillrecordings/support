import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from './types'

// Mock Stripe
vi.mock('stripe', () => {
  const mockStripe = vi.fn()
  mockStripe.prototype.subscriptions = {
    list: vi.fn(),
  }
  return { default: mockStripe }
})

import { getSubscriptionStatus } from './stripe-subscription-status'

/**
 * Tests for getSubscriptionStatus
 *
 * Queries connected Stripe account for customer subscription status.
 */
describe('getSubscriptionStatus', () => {
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

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('successful queries', () => {
    it('should return active subscription details', async () => {
      const mockSubscription = {
        id: 'sub_123',
        status: 'active',
        current_period_end: [PHONE], // Unix timestamp
        cancel_at_period_end: false,
        items: {
          data: [
            {
              plan: {
                nickname: 'Total TypeScript Pro',
              },
            },
          ],
        },
      }

      const mockStripe = new Stripe('sk_test_123', {
        apiVersion: '2025-02-24.acacia',
      })
      vi.mocked(mockStripe.subscriptions.list).mockResolvedValue({
        data: [mockSubscription],
      } as any)

      const result = await getSubscriptionStatus.execute(
        {
          customerId: 'cus_123',
          stripeAccountId: 'acct_1LFP5yAozSgJZBRP',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({
          id: 'sub_123',
          status: 'active',
          currentPeriodEnd: [PHONE],
          cancelAtPeriodEnd: false,
          planName: 'Total TypeScript Pro',
        })
      }

      expect(mockStripe.subscriptions.list).toHaveBeenCalledWith(
        { customer: 'cus_123', status: 'all' },
        { stripeAccount: 'acct_1LFP5yAozSgJZBRP' }
      )
    })

    it('should handle subscriptions without plan nickname', async () => {
      const mockSubscription = {
        id: 'sub_456',
        status: 'active',
        current_period_end: [PHONE],
        cancel_at_period_end: false,
        items: {
          data: [
            {
              plan: {},
            },
          ],
        },
      }

      const mockStripe = new Stripe('sk_test_123', {
        apiVersion: '2025-02-24.acacia',
      })
      vi.mocked(mockStripe.subscriptions.list).mockResolvedValue({
        data: [mockSubscription],
      } as any)

      const result = await getSubscriptionStatus.execute(
        {
          customerId: 'cus_456',
          stripeAccountId: 'acct_1LFP5yAozSgJZBRP',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success && result.data) {
        expect(result.data.planName).toBe('Unknown')
      }
    })

    it('should handle customer with no subscriptions', async () => {
      const mockStripe = new Stripe('sk_test_123', {
        apiVersion: '2025-02-24.acacia',
      })
      vi.mocked(mockStripe.subscriptions.list).mockResolvedValue({
        data: [],
      } as any)

      const result = await getSubscriptionStatus.execute(
        {
          customerId: 'cus_no_sub',
          stripeAccountId: 'acct_1LFP5yAozSgJZBRP',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBeNull()
      }
    })

    it('should handle canceled subscriptions', async () => {
      const mockSubscription = {
        id: 'sub_789',
        status: 'canceled',
        current_period_end: [PHONE],
        cancel_at_period_end: true,
        items: {
          data: [
            {
              plan: {
                nickname: 'Total TypeScript Pro',
              },
            },
          ],
        },
      }

      const mockStripe = new Stripe('sk_test_123', {
        apiVersion: '2025-02-24.acacia',
      })
      vi.mocked(mockStripe.subscriptions.list).mockResolvedValue({
        data: [mockSubscription],
      } as any)

      const result = await getSubscriptionStatus.execute(
        {
          customerId: 'cus_789',
          stripeAccountId: 'acct_1LFP5yAozSgJZBRP',
        },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data?.status).toBe('canceled')
        expect(result.data?.cancelAtPeriodEnd).toBe(true)
      }
    })
  })

  describe('error handling', () => {
    it('should handle Stripe API errors', async () => {
      const mockStripe = new Stripe('sk_test_123', {
        apiVersion: '2025-02-24.acacia',
      })
      vi.mocked(mockStripe.subscriptions.list).mockRejectedValue(
        new Error('Stripe API error: Invalid customer')
      )

      const result = await getSubscriptionStatus.execute(
        {
          customerId: 'cus_invalid',
          stripeAccountId: 'acct_1LFP5yAozSgJZBRP',
        },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('Stripe API error')
      }
    })
  })

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(getSubscriptionStatus.name).toBe('get_subscription_status')
    })

    it('should have description mentioning Stripe Connect', () => {
      expect(getSubscriptionStatus.description).toContain('subscription')
      expect(getSubscriptionStatus.description).toContain('status')
    })

    it('should not require approval', () => {
      expect(getSubscriptionStatus.requiresApproval).toBeUndefined()
    })
  })
})
