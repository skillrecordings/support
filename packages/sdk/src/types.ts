/**
 * User entity returned by app integration.
 * Replaces Customer for consistency with SupportIntegration interface.
 */
export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
}

/**
 * @deprecated Use User instead. Kept for backwards compatibility.
 */
export type Customer = User;

/**
 * Purchase record with product and payment details.
 * Used by agent tools to display purchase history.
 */
export interface Purchase {
  id: string;
  productId: string;
  productName: string;
  purchasedAt: Date;
  amount: number;
  currency: string;
  stripeChargeId?: string;
  status: 'active' | 'refunded' | 'transferred';
}

/**
 * Subscription entity for recurring billing.
 * Optional method - apps may not support subscriptions.
 */
export interface Subscription {
  id: string;
  productId: string;
  productName: string;
  status: 'active' | 'cancelled' | 'expired' | 'paused';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

/**
 * Generic result type for mutations (refund, transfer, updates).
 */
export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Claimed seat for team/bulk purchases.
 * Used by getClaimedSeats optional method.
 */
export interface ClaimedSeat {
  userId: string;
  email: string;
  claimedAt: Date;
}

/**
 * Refund request payload.
 * @deprecated Use revokeAccess via SupportIntegration instead.
 */
export interface RefundRequest {
  purchaseId: string;
  reason: string;
  amount?: number;
}

/**
 * Refund result.
 * @deprecated Use ActionResult instead.
 */
export interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}
