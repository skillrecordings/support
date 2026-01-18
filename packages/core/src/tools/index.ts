/**
 * Tools module - Agent tools for support operations
 */

export type {
  SupportTool,
  ToolContext,
  ExecutionContext,
  ToolResult,
  InferToolParams,
  InferToolResult,
} from './types'

export {
  createTool,
  setAuditHooks,
  type CreateToolConfig,
  type AuditHooks,
} from './create-tool'

export { initializeToolAuditLogging } from './audit-integration'

import { getConversationContext } from './get-conversation-context'
// Import all tool implementations
import { lookupUser } from './lookup-user'
import { processRefund } from './process-refund'
import { searchKnowledge } from './search-knowledge'
import { lookupCharge } from './stripe-lookup-charge'
import { getPaymentHistory } from './stripe-payment-history'
import { getSubscriptionStatus } from './stripe-subscription-status'
import { verifyRefund } from './stripe-verify-refund'

// Re-export individual tools for direct import
export { processRefund } from './process-refund'
export { getPaymentHistory } from './stripe-payment-history'
export { lookupCharge } from './stripe-lookup-charge'
export { getSubscriptionStatus } from './stripe-subscription-status'
export { verifyRefund } from './stripe-verify-refund'

/**
 * Aggregated support tools object
 * Contains all available tools for the support agent
 */
export const supportTools = {
  lookupUser,
  getConversationContext,
  searchKnowledge,
  processRefund,
  getPaymentHistory,
  lookupCharge,
  getSubscriptionStatus,
  verifyRefund,
}
