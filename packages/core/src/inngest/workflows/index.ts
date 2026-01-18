/**
 * Workflow exports for the support platform.
 *
 * All Inngest workflows are exported here for the serve handler.
 */

export { handleInboundMessage } from './handle-inbound-message'
export { requestApproval } from './request-approval'
export { executeApprovedAction } from './execute-approved-action'

import { handleInboundMessage } from './handle-inbound-message'
import { requestApproval } from './request-approval'
import { executeApprovedAction } from './execute-approved-action'

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
]
