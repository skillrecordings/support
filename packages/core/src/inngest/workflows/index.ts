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
export { retentionCleanup } from './retention-cleanup'
export { handleMemoryVote } from './memory-vote'
export { routeWorkflow } from './route-message'
export { classifyWorkflow } from './classify'
export { gatherWorkflow } from './gather-context'
export { draftWorkflow } from './draft-response'
export { validateWorkflow } from './validate-draft'
export { handleValidatedDraft } from './handle-validated-draft'

import { classifyWorkflow } from './classify'
import { handleValidatedDraft } from './handle-validated-draft'
import { draftWorkflow } from './draft-response'
import { executeApprovedAction } from './execute-approved-action'
import { gatherWorkflow } from './gather-context'
import { handleInboundMessage } from './handle-inbound-message'
import { indexConversation } from './index-conversation'
import { handleMemoryVote } from './memory-vote'
import { requestApproval } from './request-approval'
import { retentionCleanup } from './retention-cleanup'
import { routeWorkflow } from './route-message'
import { handleStripeEvent } from './stripe-refund'
import { validateWorkflow } from './validate-draft'

/**
 * Array of all workflow functions for the Inngest serve handler.
 *
 * Usage in serve route:
 * ```typescript
 * serve({ client: inngest, functions: allWorkflows })
 * ```
 */
export const allWorkflows = [
  classifyWorkflow,
  draftWorkflow,
  gatherWorkflow,
  handleInboundMessage,
  handleValidatedDraft,
  requestApproval,
  executeApprovedAction,
  handleStripeEvent,
  indexConversation,
  retentionCleanup,
  handleMemoryVote,
  routeWorkflow,
  validateWorkflow,
]
