import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  ActionResult,
  ClaimedSeat,
  Purchase,
  Subscription,
  SupportIntegration,
  User,
} from '../integration'
import type { ProductState, ProductStatus, ProductType } from '../types'
import {
  ProductStateSchema,
  ProductStatusSchema,
  ProductTypeSchema,
} from '../types'

describe('SDK Types', () => {
  it('SupportIntegration has required methods', () => {
    const integration: SupportIntegration = {
      lookupUser: async (email: string) => null as User | null,
      getPurchases: async (userId: string) => [] as Purchase[],
      revokeAccess: async (params) => ({ success: true }),
      transferPurchase: async (params) => ({ success: true }),
      generateMagicLink: async (params) => ({ url: '' }),
    }

    expectTypeOf(integration.lookupUser).toBeFunction()
    expectTypeOf(integration.getPurchases).toBeFunction()
    expectTypeOf(integration.revokeAccess).toBeFunction()
    expectTypeOf(integration.transferPurchase).toBeFunction()
    expectTypeOf(integration.generateMagicLink).toBeFunction()
  })

  it('SupportIntegration has optional methods', () => {
    const integration: SupportIntegration = {
      lookupUser: async (email: string) => null as User | null,
      getPurchases: async (userId: string) => [] as Purchase[],
      revokeAccess: async (params) => ({ success: true }),
      transferPurchase: async (params) => ({ success: true }),
      generateMagicLink: async (params) => ({ url: '' }),
      // Optional methods
      getSubscriptions: async (userId: string) => [] as Subscription[],
      updateEmail: async (params) => ({ success: true }),
      updateName: async (params) => ({ success: true }),
      getClaimedSeats: async (bulkCouponId: string) => [] as ClaimedSeat[],
      getProductStatus: async (productId: string) =>
        null as ProductStatus | null,
    }

    if (integration.getSubscriptions) {
      expectTypeOf(integration.getSubscriptions).toBeFunction()
    }
    if (integration.updateEmail) {
      expectTypeOf(integration.updateEmail).toBeFunction()
    }
    if (integration.updateName) {
      expectTypeOf(integration.updateName).toBeFunction()
    }
    if (integration.getClaimedSeats) {
      expectTypeOf(integration.getClaimedSeats).toBeFunction()
    }
    if (integration.getProductStatus) {
      expectTypeOf(integration.getProductStatus).toBeFunction()
    }
  })

  it('User type has required fields', () => {
    const user: User = {
      id: 'usr_123',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
    }

    expectTypeOf(user).toMatchTypeOf<User>()
  })

  it('Purchase type includes stripeChargeId', () => {
    const purchase: Purchase = {
      id: 'pur_123',
      productId: 'prod_123',
      productName: 'Test Product',
      purchasedAt: new Date(),
      amount: 10000,
      currency: 'usd',
      stripeChargeId: 'ch_123',
      status: 'active',
    }

    expectTypeOf(purchase.stripeChargeId).toMatchTypeOf<string | undefined>()
    expectTypeOf(purchase.status).toMatchTypeOf<
      'active' | 'refunded' | 'transferred'
    >()
  })

  it('ActionResult has success and optional error', () => {
    const success: ActionResult = { success: true }
    const failure: ActionResult = {
      success: false,
      error: 'Something went wrong',
    }

    expectTypeOf(success).toMatchTypeOf<ActionResult>()
    expectTypeOf(failure).toMatchTypeOf<ActionResult>()
  })

  it('Subscription type has all required fields', () => {
    const subscription: Subscription = {
      id: 'sub_123',
      productId: 'prod_123',
      productName: 'Test Subscription',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
    }

    expectTypeOf(subscription.status).toMatchTypeOf<
      'active' | 'cancelled' | 'expired' | 'paused'
    >()
  })

  it('ClaimedSeat has user info and timestamp', () => {
    const seat: ClaimedSeat = {
      userId: 'usr_123',
      email: 'test@example.com',
      claimedAt: new Date(),
    }

    expectTypeOf(seat).toMatchTypeOf<ClaimedSeat>()
  })

  it('ProductStatus has all required fields for availability checking', () => {
    const status: ProductStatus = {
      productId: 'prod_123',
      productType: 'live',
      available: true,
      soldOut: false,
      quantityAvailable: 50,
      quantityRemaining: 12,
      state: 'active',
      startsAt: '2026-02-01T10:00:00Z',
      endsAt: '2026-02-01T14:00:00Z',
    }

    expectTypeOf(status.productId).toBeString()
    expectTypeOf(status.productType).toMatchTypeOf<ProductType>()
    expectTypeOf(status.available).toBeBoolean()
    expectTypeOf(status.soldOut).toBeBoolean()
    expectTypeOf(status.quantityAvailable).toBeNumber()
    expectTypeOf(status.quantityRemaining).toBeNumber()
    expectTypeOf(status.state).toMatchTypeOf<ProductState>()
    expectTypeOf(status.startsAt).toMatchTypeOf<string | undefined>()
    expectTypeOf(status.endsAt).toMatchTypeOf<string | undefined>()
  })

  it('ProductStatus supports unlimited inventory', () => {
    const selfPaced: ProductStatus = {
      productId: 'prod_456',
      productType: 'self-paced',
      available: true,
      soldOut: false,
      quantityAvailable: -1, // unlimited
      quantityRemaining: -1,
      state: 'active',
    }

    expectTypeOf(selfPaced).toMatchTypeOf<ProductStatus>()
  })

  it('ProductStatus supports cohort enrollment windows', () => {
    const cohort: ProductStatus = {
      productId: 'prod_789',
      productType: 'cohort',
      available: true,
      soldOut: false,
      quantityAvailable: 30,
      quantityRemaining: 5,
      state: 'active',
      enrollmentOpen: '2026-01-15T00:00:00Z',
      enrollmentClose: '2026-01-31T23:59:59Z',
      startsAt: '2026-02-05T10:00:00Z',
    }

    expectTypeOf(cohort.enrollmentOpen).toMatchTypeOf<string | undefined>()
    expectTypeOf(cohort.enrollmentClose).toMatchTypeOf<string | undefined>()
  })

  it('ProductType allows custom string types', () => {
    // Custom product types are allowed for flexibility
    const customType: ProductType = 'workshop-bundle'
    expectTypeOf(customType).toMatchTypeOf<ProductType>()
  })
})

describe('ProductStatus Zod Schemas', () => {
  it('ProductStatusSchema validates valid status', () => {
    const status = {
      productId: 'prod_123',
      productType: 'live',
      available: true,
      soldOut: false,
      quantityAvailable: 50,
      quantityRemaining: 12,
      state: 'active',
      startsAt: '2026-02-01T10:00:00Z',
    }

    const result = ProductStatusSchema.safeParse(status)
    expect(result.success).toBe(true)
  })

  it('ProductStatusSchema rejects invalid state', () => {
    const status = {
      productId: 'prod_123',
      productType: 'self-paced',
      available: true,
      soldOut: false,
      quantityAvailable: -1,
      quantityRemaining: -1,
      state: 'invalid-state', // Invalid
    }

    const result = ProductStatusSchema.safeParse(status)
    expect(result.success).toBe(false)
  })

  it('ProductStatusSchema handles optional fields', () => {
    const minimal = {
      productId: 'prod_456',
      productType: 'self-paced',
      available: true,
      soldOut: false,
      quantityAvailable: -1,
      quantityRemaining: -1,
      state: 'active',
    }

    const result = ProductStatusSchema.safeParse(minimal)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.startsAt).toBeUndefined()
      expect(result.data.enrollmentOpen).toBeUndefined()
    }
  })

  it('ProductTypeSchema validates known types', () => {
    expect(ProductTypeSchema.safeParse('live').success).toBe(true)
    expect(ProductTypeSchema.safeParse('cohort').success).toBe(true)
    expect(ProductTypeSchema.safeParse('self-paced').success).toBe(true)
    expect(ProductTypeSchema.safeParse('membership').success).toBe(true)
    expect(ProductTypeSchema.safeParse('source-code-access').success).toBe(true)
  })

  it('ProductTypeSchema allows custom string types', () => {
    expect(ProductTypeSchema.safeParse('workshop-bundle').success).toBe(true)
    expect(ProductTypeSchema.safeParse('premium-tier').success).toBe(true)
  })

  it('ProductStateSchema validates lifecycle states', () => {
    expect(ProductStateSchema.safeParse('draft').success).toBe(true)
    expect(ProductStateSchema.safeParse('active').success).toBe(true)
    expect(ProductStateSchema.safeParse('unavailable').success).toBe(true)
    expect(ProductStateSchema.safeParse('archived').success).toBe(true)
    expect(ProductStateSchema.safeParse('deleted').success).toBe(false)
  })
})
