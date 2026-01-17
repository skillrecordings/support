import type { Customer, Purchase, RefundRequest, RefundResult } from './types';

/**
 * Base adapter interface that apps must implement to integrate with the support platform.
 *
 * Each app (egghead, Total TypeScript, etc.) provides:
 * - Customer lookup by email
 * - Purchase history retrieval
 * - Refund processing capabilities
 */
export interface AppAdapter {
  /**
   * Fetch customer by email address
   * @returns Customer if found, null otherwise
   */
  getCustomer(email: string): Promise<Customer | null>;

  /**
   * Fetch all purchases for a given customer
   * @returns Array of purchases, empty if none found
   */
  getPurchases(customerId: string): Promise<Purchase[]>;

  /**
   * Process a refund for a purchase
   * @returns RefundResult indicating success/failure
   */
  processRefund(request: RefundRequest): Promise<RefundResult>;
}
