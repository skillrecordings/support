/**
 * Workflow exports for the support platform.
 *
 * All Inngest workflows are exported here for the serve handler.
 */

export { handleInboundMessage } from './handle-inbound-message'
export { requestApproval } from './request-approval'
export { executeApprovedAction } from './execute-approved-action'
export { handleStripeEvent } from './stripe-refund'
export { indexConversation } from './index-conversation'

import { executeApprovedAction } from './execute-approved-action'
import { handleInboundMessage } from './handle-inbound-message'
import { indexConversation } from './index-conversation'
import { requestApproval } from './request-approval'
import { handleStripeEvent } from './stripe-refund'

/**
 * Array of all workflow functions for the Inngest serve handler.
 *
 * Usage in serve route:
 * ```typescript
 * serve({ client: inngest, functions: allWorkflows })
 * ```
 */
export const allWorkflows = [
  handleInboundMessage,
  requestApproval,
  executeApprovedAction,
  handleStripeEvent,
  indexConversation,
]
