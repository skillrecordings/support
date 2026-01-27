import { z } from 'zod'

/**
 * User entity returned by app integration.
 * Replaces Customer for consistency with SupportIntegration interface.
 */
export interface User {
  id: string
  email: string
  name?: string
  createdAt: Date
}

/**
 * @deprecated Use User instead. Kept for backwards compatibility.
 */
export type Customer = User

/**
 * Purchase record with product and payment details.
 * Used by agent tools to display purchase history.
 */
export interface Purchase {
  id: string
  productId: string
  productName: string
  purchasedAt: Date
  amount: number
  currency: string
  stripeChargeId?: string
  status: 'active' | 'refunded' | 'transferred'
}

/**
 * Subscription entity for recurring billing.
 * Optional method - apps may not support subscriptions.
 */
export interface Subscription {
  id: string
  productId: string
  productName: string
  status: 'active' | 'cancelled' | 'expired' | 'paused'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
}

/**
 * Generic result type for mutations (refund, transfer, updates).
 */
export interface ActionResult {
  success: boolean
  error?: string
}

/**
 * Claimed seat for team/bulk purchases.
 * Used by getClaimedSeats optional method.
 */
export interface ClaimedSeat {
  userId: string
  email: string
  claimedAt: Date
}

/**
 * Refund request payload.
 * @deprecated Use revokeAccess via SupportIntegration instead.
 */
export interface RefundRequest {
  purchaseId: string
  reason: string
  amount?: number
}

/**
 * Refund result.
 * @deprecated Use ActionResult instead.
 */
export interface RefundResult {
  success: boolean
  refundId?: string
  error?: string
}

/**
 * Content search result for agent recommendations.
 * Agent queries products to find relevant resources to share with customers.
 */
export interface ContentSearchResult {
  /** Unique identifier for deduplication */
  id: string

  /** Resource type for filtering/display */
  type:
    | 'course'
    | 'module'
    | 'lesson'
    | 'article'
    | 'exercise'
    | 'resource'
    | 'social'

  /** Human-readable title */
  title: string

  /** Brief description (1-2 sentences) */
  description?: string

  /** Canonical URL to share with customer */
  url: string

  /** Relevance score 0-1 (optional, for ranking) */
  score?: number

  /** Product-specific metadata (agent can reference but doesn't parse) */
  metadata?: {
    /** Duration in minutes (for courses/lessons) */
    duration?: number
    /** Difficulty level */
    difficulty?: 'beginner' | 'intermediate' | 'advanced'
    /** Tags/topics */
    tags?: string[]
    /** Author/instructor name */
    author?: string
    /** Last updated date */
    updatedAt?: string
    /** Free vs paid */
    accessLevel?: 'free' | 'paid' | 'preview'
    /** Arbitrary product-specific data */
    [key: string]: unknown
  }
}

/**
 * Content search request from agent.
 */
export interface ContentSearchRequest {
  /** Natural language query */
  query: string

  /** Filter by content type */
  types?: ContentSearchResult['type'][]

  /** Max results to return */
  limit?: number

  /** Customer context (for personalization) */
  customer?: {
    email?: string
    hasPurchased?: boolean
    purchasedProducts?: string[]
  }
}

/**
 * Content search response to agent.
 */
export interface ContentSearchResponse {
  results: ContentSearchResult[]

  /** Quick links always returned (social, support, etc.) */
  quickLinks?: ContentSearchResult[]

  /** Search metadata */
  meta?: {
    totalResults?: number
    searchTimeMs?: number
  }
}

/**
 * Product type for availability checking.
 * Self-paced is always available, live/cohort have limited seats.
 */
export type ProductType =
  | 'self-paced'
  | 'live'
  | 'cohort'
  | 'membership'
  | 'source-code-access'
  | (string & {})

/**
 * Product state lifecycle.
 */
export type ProductState = 'draft' | 'active' | 'unavailable' | 'archived'

// ── Agent Intelligence Types ─────────────────────────────────────────
// These types support optional SDK methods that give the agent
// data to answer presales, access, refund, and team questions.

/**
 * Active promotion or sale for a product.
 * Used by agent to answer presales questions about current discounts.
 */
export interface Promotion {
  id: string
  name: string
  /** Coupon code if applicable */
  code?: string
  discountType: 'percent' | 'fixed'
  /** Percentage (0-100) or fixed amount in cents */
  discountAmount: number
  /** ISO date — when the promotion starts */
  validFrom?: string
  /** ISO date — when the promotion ends */
  validUntil?: string
  active: boolean
  /** Human-readable conditions (e.g., "PPP — purchasing power parity") */
  conditions?: string
}

/**
 * Coupon/discount code details.
 * Used by agent to validate coupon codes customers ask about.
 */
export interface CouponInfo {
  code: string
  valid: boolean
  discountType: 'percent' | 'fixed'
  /** Percentage (0-100) or fixed amount in cents */
  discountAmount: number
  /** Restriction category for the coupon */
  restrictionType?: 'ppp' | 'student' | 'bulk' | 'general'
  usageCount: number
  maxUses?: number
  /** ISO date — when the coupon expires */
  expiresAt?: string
}

/**
 * App-specific refund policy configuration.
 * Used by agent to give accurate refund window information
 * instead of hardcoded defaults.
 */
export interface RefundPolicy {
  /** Days within which refunds are auto-approved */
  autoApproveWindowDays: number
  /** Days within which refunds can be manually approved */
  manualApproveWindowDays: number
  /** Days after which no refund is possible */
  noRefundAfterDays?: number
  /** Special conditions (e.g., "Lifetime access: 60 day window") */
  specialConditions?: string[]
  /** URL to the full refund policy page */
  policyUrl?: string
}

/**
 * Granular content access information for a user.
 * Used by agent to debug access issues — goes beyond just "has a purchase".
 */
export interface ContentAccess {
  userId: string
  products: Array<{
    productId: string
    productName: string
    accessLevel: 'full' | 'partial' | 'preview' | 'expired'
    modules?: Array<{ id: string; title: string; accessible: boolean }>
    /** ISO date — when access expires (null = lifetime) */
    expiresAt?: string
  }>
  /** Team membership info if user is part of a team */
  teamMembership?: {
    teamId: string
    teamName: string
    role: 'member' | 'admin' | 'owner'
    /** ISO date — when the seat was claimed */
    seatClaimedAt: string
  }
}

/**
 * Recent user activity and progress data.
 * Used by agent to debug access issues and assess product usage.
 */
export interface UserActivity {
  userId: string
  /** ISO date — last login timestamp */
  lastLoginAt?: string
  /** ISO date — last meaningful activity */
  lastActiveAt?: string
  lessonsCompleted: number
  totalLessons: number
  /** 0-100 completion percentage */
  completionPercent: number
  recentItems: Array<{
    type: 'lesson_completed' | 'exercise_submitted' | 'login' | 'download'
    title: string
    /** ISO date */
    timestamp: string
  }>
}

/**
 * Team license and seat management information.
 * Used by agent to answer team/enterprise questions about seat allocation.
 */
export interface LicenseInfo {
  purchaseId: string
  licenseType: 'individual' | 'team' | 'enterprise' | 'site'
  totalSeats: number
  claimedSeats: number
  availableSeats: number
  /** ISO date — when the license expires */
  expiresAt?: string
  claimedBy: Array<{
    email: string
    /** ISO date */
    claimedAt: string
    /** ISO date */
    lastActiveAt?: string
  }>
  /** Email of the license administrator */
  adminEmail?: string
}

/**
 * App metadata for multi-app support.
 * Eliminates hardcoded URLs and product names in agent prompts.
 */
export interface AppInfo {
  name: string
  instructorName: string
  supportEmail: string
  websiteUrl: string
  invoicesUrl?: string
  discordUrl?: string
  refundPolicyUrl?: string
  privacyPolicyUrl?: string
  termsUrl?: string
}

/**
 * Zod schema for ProductType validation
 */
export const ProductTypeSchema = z.union([
  z.literal('self-paced'),
  z.literal('live'),
  z.literal('cohort'),
  z.literal('membership'),
  z.literal('source-code-access'),
  z.string(),
])

/**
 * Zod schema for ProductState validation
 */
export const ProductStateSchema = z.enum([
  'draft',
  'active',
  'unavailable',
  'archived',
])

/**
 * Zod schema for ProductStatus validation
 */
export const ProductStatusSchema = z.object({
  productId: z.string(),
  productType: ProductTypeSchema,
  available: z.boolean(),
  soldOut: z.boolean(),
  quantityAvailable: z.number(),
  quantityRemaining: z.number(),
  state: ProductStateSchema,
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  enrollmentOpen: z.string().optional(),
  enrollmentClose: z.string().optional(),
})

// ── Zod Schemas for Agent Intelligence Types ─────────────────────────

/**
 * Zod schema for Promotion validation
 */
export const PromotionSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().optional(),
  discountType: z.enum(['percent', 'fixed']),
  discountAmount: z.number(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  active: z.boolean(),
  conditions: z.string().optional(),
})

/**
 * Zod schema for CouponInfo validation
 */
export const CouponInfoSchema = z.object({
  code: z.string(),
  valid: z.boolean(),
  discountType: z.enum(['percent', 'fixed']),
  discountAmount: z.number(),
  restrictionType: z.enum(['ppp', 'student', 'bulk', 'general']).optional(),
  usageCount: z.number(),
  maxUses: z.number().optional(),
  expiresAt: z.string().optional(),
})

/**
 * Zod schema for RefundPolicy validation
 */
export const RefundPolicySchema = z.object({
  autoApproveWindowDays: z.number(),
  manualApproveWindowDays: z.number(),
  noRefundAfterDays: z.number().optional(),
  specialConditions: z.array(z.string()).optional(),
  policyUrl: z.string().optional(),
})

/**
 * Zod schema for ContentAccess validation
 */
export const ContentAccessSchema = z.object({
  userId: z.string(),
  products: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      accessLevel: z.enum(['full', 'partial', 'preview', 'expired']),
      modules: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            accessible: z.boolean(),
          })
        )
        .optional(),
      expiresAt: z.string().optional(),
    })
  ),
  teamMembership: z
    .object({
      teamId: z.string(),
      teamName: z.string(),
      role: z.enum(['member', 'admin', 'owner']),
      seatClaimedAt: z.string(),
    })
    .optional(),
})

/**
 * Zod schema for UserActivity validation
 */
export const UserActivitySchema = z.object({
  userId: z.string(),
  lastLoginAt: z.string().optional(),
  lastActiveAt: z.string().optional(),
  lessonsCompleted: z.number(),
  totalLessons: z.number(),
  completionPercent: z.number(),
  recentItems: z.array(
    z.object({
      type: z.enum([
        'lesson_completed',
        'exercise_submitted',
        'login',
        'download',
      ]),
      title: z.string(),
      timestamp: z.string(),
    })
  ),
})

/**
 * Zod schema for LicenseInfo validation
 */
export const LicenseInfoSchema = z.object({
  purchaseId: z.string(),
  licenseType: z.enum(['individual', 'team', 'enterprise', 'site']),
  totalSeats: z.number(),
  claimedSeats: z.number(),
  availableSeats: z.number(),
  expiresAt: z.string().optional(),
  claimedBy: z.array(
    z.object({
      email: z.string(),
      claimedAt: z.string(),
      lastActiveAt: z.string().optional(),
    })
  ),
  adminEmail: z.string().optional(),
})

/**
 * Zod schema for AppInfo validation
 */
export const AppInfoSchema = z.object({
  name: z.string(),
  instructorName: z.string(),
  supportEmail: z.string(),
  websiteUrl: z.string(),
  invoicesUrl: z.string().optional(),
  discordUrl: z.string().optional(),
  refundPolicyUrl: z.string().optional(),
  privacyPolicyUrl: z.string().optional(),
  termsUrl: z.string().optional(),
})

/**
 * Product availability/inventory status.
 * Used by agent to accurately report whether products can be purchased.
 *
 * For live events/cohorts: check soldOut and quantityRemaining
 * For self-paced: typically available=true, quantityAvailable=-1 (unlimited)
 */
export interface ProductStatus {
  /** Product identifier */
  productId: string

  /** Type of product determines availability semantics */
  productType: ProductType

  /** Whether the product can currently be purchased */
  available: boolean

  /** Whether all seats/inventory are sold */
  soldOut: boolean

  /** Total quantity available for sale (-1 = unlimited) */
  quantityAvailable: number

  /** Remaining quantity not yet sold */
  quantityRemaining: number

  /** Product lifecycle state */
  state: ProductState

  /** For live events: when the event starts */
  startsAt?: string

  /** For live events: when the event ends */
  endsAt?: string

  /** For cohorts: when enrollment opens */
  enrollmentOpen?: string

  /** For cohorts: when enrollment closes */
  enrollmentClose?: string
}
