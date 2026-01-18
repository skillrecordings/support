import type {
  User,
  Purchase,
  Subscription,
  ActionResult,
  ClaimedSeat,
} from './types';

// Re-export types for convenience
export type {
  User,
  Purchase,
  Subscription,
  ActionResult,
  ClaimedSeat,
};

/**
 * SupportIntegration interface that apps must implement.
 *
 * Each app (egghead, Total TypeScript, etc.) implements this interface
 * to provide user lookup, purchase/subscription management, and support actions.
 *
 * The support platform calls these methods via IntegrationClient with HMAC auth.
 *
 * @example
 * ```typescript
 * import type { SupportIntegration } from '@skillrecordings/sdk/integration'
 *
 * const integration: SupportIntegration = {
 *   async lookupUser(email) {
 *     return db.user.findUnique({ where: { email } })
 *   },
 *   async getPurchases(userId) {
 *     return db.purchase.findMany({ where: { userId } })
 *   },
 *   async revokeAccess({ purchaseId, reason, refundId }) {
 *     await db.purchase.update({
 *       where: { id: purchaseId },
 *       data: { status: 'refunded', refundReason: reason, stripeRefundId: refundId }
 *     })
 *     return { success: true }
 *   },
 *   async transferPurchase({ purchaseId, fromUserId, toEmail }) {
 *     const toUser = await db.user.findUnique({ where: { email: toEmail } })
 *     await db.purchase.update({
 *       where: { id: purchaseId },
 *       data: { userId: toUser.id }
 *     })
 *     return { success: true }
 *   },
 *   async generateMagicLink({ email, expiresIn }) {
 *     const token = await createMagicToken(email, expiresIn)
 *     return { url: `${APP_URL}/auth/magic?token=${token}` }
 *   },
 * }
 * ```
 */
export interface SupportIntegration {
  /**
   * Look up user by email address.
   * Called by the agent to fetch user context at conversation start.
   *
   * @param email - User's email address
   * @returns User if found, null otherwise
   */
  lookupUser(email: string): Promise<User | null>;

  /**
   * Fetch all purchases for a given user.
   * Used by agent to display purchase history and validate refund eligibility.
   *
   * @param userId - User's unique identifier
   * @returns Array of purchases, empty if none found
   */
  getPurchases(userId: string): Promise<Purchase[]>;

  /**
   * Fetch active subscriptions for a user.
   * Optional method - only implement if app supports recurring billing.
   *
   * @param userId - User's unique identifier
   * @returns Array of subscriptions, empty if none found
   */
  getSubscriptions?(userId: string): Promise<Subscription[]>;

  /**
   * Revoke access to a product after refund.
   * Called after Stripe refund succeeds to remove product access.
   *
   * @param params.purchaseId - Purchase to revoke
   * @param params.reason - Refund reason for audit trail
   * @param params.refundId - Stripe refund ID
   * @returns ActionResult indicating success/failure
   */
  revokeAccess(params: {
    purchaseId: string;
    reason: string;
    refundId: string;
  }): Promise<ActionResult>;

  /**
   * Transfer purchase to a different user.
   * Updates purchase ownership and moves product access.
   *
   * @param params.purchaseId - Purchase to transfer
   * @param params.fromUserId - Current owner's ID
   * @param params.toEmail - New owner's email address
   * @returns ActionResult indicating success/failure
   */
  transferPurchase(params: {
    purchaseId: string;
    fromUserId: string;
    toEmail: string;
  }): Promise<ActionResult>;

  /**
   * Generate a magic link for passwordless login.
   * Used by agent to send login links during support conversations.
   *
   * @param params.email - User's email address
   * @param params.expiresIn - Expiration time in seconds (default 3600)
   * @returns Object with magic link URL
   */
  generateMagicLink(params: {
    email: string;
    expiresIn: number;
  }): Promise<{ url: string }>;

  /**
   * Update user's email address.
   * Optional method - not all apps support email changes.
   *
   * @param params.userId - User's unique identifier
   * @param params.newEmail - New email address
   * @returns ActionResult indicating success/failure
   */
  updateEmail?(params: {
    userId: string;
    newEmail: string;
  }): Promise<ActionResult>;

  /**
   * Update user's display name.
   * Optional method - not all apps support name changes.
   *
   * @param params.userId - User's unique identifier
   * @param params.newName - New display name
   * @returns ActionResult indicating success/failure
   */
  updateName?(params: {
    userId: string;
    newName: string;
  }): Promise<ActionResult>;

  /**
   * Get all claimed seats for a team/bulk purchase.
   * Optional method - only implement for apps with team features.
   *
   * @param bulkCouponId - Bulk coupon/license identifier
   * @returns Array of claimed seats with user info
   */
  getClaimedSeats?(bulkCouponId: string): Promise<ClaimedSeat[]>;
}
