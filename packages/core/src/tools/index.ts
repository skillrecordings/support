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
import { getPaymentHistory } from './stripe-payment-history'
import { getSubscriptionStatus } from './stripe-subscription-status'

// Re-export individual tools for direct import
export { processRefund } from './process-refund'
export { getPaymentHistory } from './stripe-payment-history'
export { getSubscriptionStatus } from './stripe-subscription-status'

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
  getSubscriptionStatus,
}
