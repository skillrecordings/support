/**
 * Customer entity returned by app adapter
 */
export interface Customer {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
}

/**
 * Purchase record with product and payment details
 */
export interface Purchase {
  id: string;
  customerId: string;
  productId: string;
  productName: string;
  amount: number;
  currency: string;
  status: 'active' | 'cancelled' | 'refunded';
  purchasedAt: Date;
}

/**
 * Refund request payload
 */
export interface RefundRequest {
  purchaseId: string;
  reason: string;
  amount?: number; // partial refund if specified
}

/**
 * Refund result
 */
export interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}
