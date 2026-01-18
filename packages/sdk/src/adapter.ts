import type { Customer, Purchase, RefundRequest, RefundResult } from './types';

/**
 * Base adapter interface that apps must implement to integrate with the support platform.
 *
 * @deprecated Use SupportIntegration interface from './integration' instead.
 * This interface is kept for backwards compatibility during migration.
 *
 * Migration path:
 * - Replace AppAdapter with SupportIntegration
 * - Rename getCustomer to lookupUser
 * - Replace processRefund with revokeAccess
 * - Add required methods: transferPurchase, generateMagicLink
 *
 * @see {@link SupportIntegration} for the new interface
 *
 * Each app (egghead, Total TypeScript, etc.) provides:
 * - Customer lookup by email
 * - Purchase history retrieval
 * - Refund processing capabilities
 */
export interface AppAdapter {
  /**
   * Fetch customer by email address
   * @deprecated Use lookupUser from SupportIntegration
   * @returns Customer if found, null otherwise
   */
  getCustomer(email: string): Promise<Customer | null>;

  /**
   * Fetch all purchases for a given customer
   * @deprecated Use getPurchases from SupportIntegration (same signature)
   * @returns Array of purchases, empty if none found
   */
  getPurchases(customerId: string): Promise<Purchase[]>;

  /**
   * Process a refund for a purchase
   * @deprecated Use revokeAccess from SupportIntegration instead
   * @returns RefundResult indicating success/failure
   */
  processRefund(request: RefundRequest): Promise<RefundResult>;
}
