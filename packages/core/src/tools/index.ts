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

import { checkProductAvailability } from './check-product-availability'
import { getContentAccess } from './get-content-access'
import { getConversationContext } from './get-conversation-context'
import { getLicenseInfo } from './get-license-info'
import { getRecentActivity } from './get-recent-activity'
// Import all tool implementations
import { lookupUser } from './lookup-user'
import { memoryCite, memorySearch, memoryStore, memoryVote } from './memory'
import { processRefund } from './process-refund'
import { searchKnowledge } from './search-knowledge'
import { lookupCharge } from './stripe-lookup-charge'
import { getPaymentHistory } from './stripe-payment-history'
import { getSubscriptionStatus } from './stripe-subscription-status'
import { verifyRefund } from './stripe-verify-refund'

// Re-export individual tools for direct import
export { memoryCite, memorySearch, memoryStore, memoryVote } from './memory'
export { processRefund } from './process-refund'
export { getPaymentHistory } from './stripe-payment-history'
export { lookupCharge } from './stripe-lookup-charge'
export { getSubscriptionStatus } from './stripe-subscription-status'
export { verifyRefund } from './stripe-verify-refund'
export { checkProductAvailability } from './check-product-availability'
export { getContentAccess } from './get-content-access'
export { getRecentActivity } from './get-recent-activity'
export { getLicenseInfo } from './get-license-info'

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
  memorySearch,
  memoryStore,
  memoryVote,
  memoryCite,
  checkProductAvailability,
  getContentAccess,
  getRecentActivity,
  getLicenseInfo,
}
