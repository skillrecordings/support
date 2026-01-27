import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  ActionResult,
  AppInfo,
  ClaimedSeat,
  ContentAccess,
  CouponInfo,
  LicenseInfo,
  Promotion,
  Purchase,
  RefundPolicy,
  Subscription,
  SupportIntegration,
  User,
  UserActivity,
} from '../integration'
import type { ProductState, ProductStatus, ProductType } from '../types'
import {
  AppInfoSchema,
  ContentAccessSchema,
  CouponInfoSchema,
  LicenseInfoSchema,
  ProductStateSchema,
  ProductStatusSchema,
  ProductTypeSchema,
  PromotionSchema,
  RefundPolicySchema,
  UserActivitySchema,
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

  it('SupportIntegration has agent intelligence optional methods', () => {
    const integration: SupportIntegration = {
      lookupUser: async (email: string) => null as User | null,
      getPurchases: async (userId: string) => [] as Purchase[],
      revokeAccess: async (params) => ({ success: true }),
      transferPurchase: async (params) => ({ success: true }),
      generateMagicLink: async (params) => ({ url: '' }),
      // Agent intelligence optional methods
      getActivePromotions: async () => [] as Promotion[],
      getCouponInfo: async (code: string) => null as CouponInfo | null,
      getRefundPolicy: async () => ({
        autoApproveWindowDays: 30,
        manualApproveWindowDays: 45,
      }),
      getContentAccess: async (userId: string) => ({
        userId,
        products: [],
      }),
      getRecentActivity: async (userId: string) => ({
        userId,
        lessonsCompleted: 0,
        totalLessons: 0,
        completionPercent: 0,
        recentItems: [],
      }),
      getLicenseInfo: async (purchaseId: string) => null as LicenseInfo | null,
      getAppInfo: async () => ({
        name: 'Test App',
        instructorName: 'Test Instructor',
        supportEmail: 'support@test.com',
        websiteUrl: 'https://test.com',
      }),
    }

    if (integration.getActivePromotions) {
      expectTypeOf(integration.getActivePromotions).toBeFunction()
    }
    if (integration.getCouponInfo) {
      expectTypeOf(integration.getCouponInfo).toBeFunction()
    }
    if (integration.getRefundPolicy) {
      expectTypeOf(integration.getRefundPolicy).toBeFunction()
    }
    if (integration.getContentAccess) {
      expectTypeOf(integration.getContentAccess).toBeFunction()
    }
    if (integration.getRecentActivity) {
      expectTypeOf(integration.getRecentActivity).toBeFunction()
    }
    if (integration.getLicenseInfo) {
      expectTypeOf(integration.getLicenseInfo).toBeFunction()
    }
    if (integration.getAppInfo) {
      expectTypeOf(integration.getAppInfo).toBeFunction()
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

// ── Agent Intelligence Type Tests ─────────────────────────────────────

describe('Agent Intelligence Types', () => {
  it('Promotion type has required fields', () => {
    const promo: Promotion = {
      id: 'promo_123',
      name: 'Summer Sale',
      code: 'SUMMER2025',
      discountType: 'percent',
      discountAmount: 30,
      validFrom: '2025-06-01T00:00:00Z',
      validUntil: '2025-08-31T23:59:59Z',
      active: true,
      conditions: 'Available to all customers',
    }

    expectTypeOf(promo).toMatchTypeOf<Promotion>()
    expectTypeOf(promo.discountType).toMatchTypeOf<'percent' | 'fixed'>()
  })

  it('CouponInfo type has required fields', () => {
    const coupon: CouponInfo = {
      code: 'SAVE20',
      valid: true,
      discountType: 'percent',
      discountAmount: 20,
      restrictionType: 'ppp',
      usageCount: 150,
      maxUses: 1000,
      expiresAt: '2025-12-31T23:59:59Z',
    }

    expectTypeOf(coupon).toMatchTypeOf<CouponInfo>()
    expectTypeOf(coupon.restrictionType).toMatchTypeOf<
      'ppp' | 'student' | 'bulk' | 'general' | undefined
    >()
  })

  it('RefundPolicy type has required fields', () => {
    const policy: RefundPolicy = {
      autoApproveWindowDays: 30,
      manualApproveWindowDays: 45,
      noRefundAfterDays: 60,
      specialConditions: ['Lifetime access: 60 day window'],
      policyUrl: 'https://example.com/refund-policy',
    }

    expectTypeOf(policy).toMatchTypeOf<RefundPolicy>()
  })

  it('ContentAccess type has products and optional team membership', () => {
    const access: ContentAccess = {
      userId: 'usr_123',
      products: [
        {
          productId: 'prod_123',
          productName: 'TypeScript Pro',
          accessLevel: 'full',
          modules: [
            { id: 'mod_1', title: 'Basics', accessible: true },
            { id: 'mod_2', title: 'Advanced', accessible: true },
          ],
        },
      ],
      teamMembership: {
        teamId: 'team_123',
        teamName: 'Acme Corp',
        role: 'member',
        seatClaimedAt: '2025-01-15T10:00:00Z',
      },
    }

    expectTypeOf(access).toMatchTypeOf<ContentAccess>()
    expectTypeOf(access.products[0]!.accessLevel).toMatchTypeOf<
      'full' | 'partial' | 'preview' | 'expired'
    >()
  })

  it('UserActivity type has progress data', () => {
    const activity: UserActivity = {
      userId: 'usr_123',
      lastLoginAt: '2025-07-27T10:00:00Z',
      lastActiveAt: '2025-07-27T11:30:00Z',
      lessonsCompleted: 42,
      totalLessons: 100,
      completionPercent: 42,
      recentItems: [
        {
          type: 'lesson_completed',
          title: 'Type Guards Deep Dive',
          timestamp: '2025-07-27T11:30:00Z',
        },
      ],
    }

    expectTypeOf(activity).toMatchTypeOf<UserActivity>()
    expectTypeOf(activity.recentItems[0]!.type).toMatchTypeOf<
      'lesson_completed' | 'exercise_submitted' | 'login' | 'download'
    >()
  })

  it('LicenseInfo type has seat allocation data', () => {
    const license: LicenseInfo = {
      purchaseId: 'pur_123',
      licenseType: 'team',
      totalSeats: 10,
      claimedSeats: 7,
      availableSeats: 3,
      expiresAt: '2026-01-15T00:00:00Z',
      claimedBy: [
        {
          email: 'alice@acme.com',
          claimedAt: '2025-01-15T10:00:00Z',
          lastActiveAt: '2025-07-27T10:00:00Z',
        },
      ],
      adminEmail: 'admin@acme.com',
    }

    expectTypeOf(license).toMatchTypeOf<LicenseInfo>()
    expectTypeOf(license.licenseType).toMatchTypeOf<
      'individual' | 'team' | 'enterprise' | 'site'
    >()
  })

  it('AppInfo type has app metadata', () => {
    const appInfo: AppInfo = {
      name: 'Total TypeScript',
      instructorName: 'Matt Pocock',
      supportEmail: 'support@totaltypescript.com',
      websiteUrl: 'https://totaltypescript.com',
      invoicesUrl: 'https://totaltypescript.com/invoices',
      discordUrl: 'https://discord.gg/totaltypescript',
      refundPolicyUrl: 'https://totaltypescript.com/refund',
    }

    expectTypeOf(appInfo).toMatchTypeOf<AppInfo>()
  })
})

describe('Agent Intelligence Zod Schemas', () => {
  it('PromotionSchema validates valid promotion', () => {
    const result = PromotionSchema.safeParse({
      id: 'promo_123',
      name: 'Summer Sale',
      code: 'SUMMER2025',
      discountType: 'percent',
      discountAmount: 30,
      active: true,
    })
    expect(result.success).toBe(true)
  })

  it('PromotionSchema rejects invalid discountType', () => {
    const result = PromotionSchema.safeParse({
      id: 'promo_123',
      name: 'Bad Promo',
      discountType: 'unknown',
      discountAmount: 10,
      active: true,
    })
    expect(result.success).toBe(false)
  })

  it('CouponInfoSchema validates valid coupon', () => {
    const result = CouponInfoSchema.safeParse({
      code: 'SAVE20',
      valid: true,
      discountType: 'percent',
      discountAmount: 20,
      restrictionType: 'ppp',
      usageCount: 100,
      maxUses: 500,
    })
    expect(result.success).toBe(true)
  })

  it('CouponInfoSchema handles optional fields', () => {
    const result = CouponInfoSchema.safeParse({
      code: 'BASIC',
      valid: true,
      discountType: 'fixed',
      discountAmount: 1000,
      usageCount: 0,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.restrictionType).toBeUndefined()
      expect(result.data.maxUses).toBeUndefined()
    }
  })

  it('RefundPolicySchema validates valid policy', () => {
    const result = RefundPolicySchema.safeParse({
      autoApproveWindowDays: 30,
      manualApproveWindowDays: 45,
      noRefundAfterDays: 60,
      specialConditions: ['Lifetime access: 60 day window'],
      policyUrl: 'https://example.com/refund',
    })
    expect(result.success).toBe(true)
  })

  it('RefundPolicySchema handles minimal policy', () => {
    const result = RefundPolicySchema.safeParse({
      autoApproveWindowDays: 30,
      manualApproveWindowDays: 45,
    })
    expect(result.success).toBe(true)
  })

  it('ContentAccessSchema validates full access data', () => {
    const result = ContentAccessSchema.safeParse({
      userId: 'usr_123',
      products: [
        {
          productId: 'prod_123',
          productName: 'TypeScript Pro',
          accessLevel: 'full',
          modules: [{ id: 'mod_1', title: 'Basics', accessible: true }],
        },
      ],
      teamMembership: {
        teamId: 'team_123',
        teamName: 'Acme Corp',
        role: 'admin',
        seatClaimedAt: '2025-01-15T10:00:00Z',
      },
    })
    expect(result.success).toBe(true)
  })

  it('ContentAccessSchema rejects invalid accessLevel', () => {
    const result = ContentAccessSchema.safeParse({
      userId: 'usr_123',
      products: [
        {
          productId: 'prod_123',
          productName: 'Test',
          accessLevel: 'superadmin', // invalid
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('UserActivitySchema validates activity data', () => {
    const result = UserActivitySchema.safeParse({
      userId: 'usr_123',
      lastLoginAt: '2025-07-27T10:00:00Z',
      lessonsCompleted: 42,
      totalLessons: 100,
      completionPercent: 42,
      recentItems: [
        {
          type: 'lesson_completed',
          title: 'Type Guards',
          timestamp: '2025-07-27T11:30:00Z',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('UserActivitySchema rejects invalid item type', () => {
    const result = UserActivitySchema.safeParse({
      userId: 'usr_123',
      lessonsCompleted: 0,
      totalLessons: 0,
      completionPercent: 0,
      recentItems: [
        {
          type: 'video_watched', // invalid
          title: 'Test',
          timestamp: '2025-07-27T10:00:00Z',
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('LicenseInfoSchema validates team license', () => {
    const result = LicenseInfoSchema.safeParse({
      purchaseId: 'pur_123',
      licenseType: 'team',
      totalSeats: 10,
      claimedSeats: 7,
      availableSeats: 3,
      claimedBy: [
        {
          email: 'alice@acme.com',
          claimedAt: '2025-01-15T10:00:00Z',
        },
      ],
      adminEmail: 'admin@acme.com',
    })
    expect(result.success).toBe(true)
  })

  it('LicenseInfoSchema rejects invalid licenseType', () => {
    const result = LicenseInfoSchema.safeParse({
      purchaseId: 'pur_123',
      licenseType: 'unlimited', // invalid
      totalSeats: 1,
      claimedSeats: 0,
      availableSeats: 1,
      claimedBy: [],
    })
    expect(result.success).toBe(false)
  })

  it('AppInfoSchema validates app metadata', () => {
    const result = AppInfoSchema.safeParse({
      name: 'Total TypeScript',
      instructorName: 'Matt Pocock',
      supportEmail: 'support@totaltypescript.com',
      websiteUrl: 'https://totaltypescript.com',
      invoicesUrl: 'https://totaltypescript.com/invoices',
    })
    expect(result.success).toBe(true)
  })

  it('AppInfoSchema handles minimal app info', () => {
    const result = AppInfoSchema.safeParse({
      name: 'Test App',
      instructorName: 'Test',
      supportEmail: 'test@test.com',
      websiteUrl: 'https://test.com',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.invoicesUrl).toBeUndefined()
      expect(result.data.discordUrl).toBeUndefined()
    }
  })
})
