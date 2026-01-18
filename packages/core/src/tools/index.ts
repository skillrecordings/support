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

// Import all tool implementations
import { lookupUser } from './lookup-user'
import { getConversationContext } from './get-conversation-context'
import { searchKnowledge } from './search-knowledge'
import { processRefund } from './process-refund'

// Re-export individual tools for direct import
export { processRefund } from './process-refund'

/**
 * Aggregated support tools object
 * Contains all available tools for the support agent
 */
export const supportTools = {
  lookupUser,
  getConversationContext,
  searchKnowledge,
  processRefund,
}
