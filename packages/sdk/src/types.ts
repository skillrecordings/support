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
